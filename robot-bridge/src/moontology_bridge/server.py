from __future__ import annotations

import asyncio
import math
import os
import time
from threading import Lock, Thread, Timer
from typing import Any

import uvicorn
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.robot.unitree.go2.connection import GO2Connection
from dimos.utils.logging_config import setup_logger
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import Field
from reactivex.disposable import Disposable

from .protocol import (
    CommandValidationError,
    SafetyLimits,
    StopCommand,
    VelocityCommand,
    parse_command,
)

logger = setup_logger()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


class MoontologyBridgeConfig(ModuleConfig):
    host: str = Field(
        default_factory=lambda: os.getenv("MOONTOLOGY_BRIDGE_HOST", "0.0.0.0")
    )
    port: int = Field(
        default_factory=lambda: int(os.getenv("MOONTOLOGY_BRIDGE_PORT", "8765"))
    )
    telemetry_hz: float = 10.0
    commands_enabled: bool = Field(
        default_factory=lambda: _env_flag("MOONTOLOGY_COMMANDS_ENABLED")
    )
    allowed_origins: str = Field(
        default_factory=lambda: os.getenv(
            "MOONTOLOGY_ALLOWED_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        )
    )
    command_token: str | None = Field(
        default_factory=lambda: os.getenv("MOONTOLOGY_BRIDGE_TOKEN") or None
    )


class MoontologyBridge(Module):
    """Expose normalized Go2 odometry and bounded high-level commands over WebSocket."""

    config: MoontologyBridgeConfig
    odom: In[PoseStamped]
    cmd_vel: Out[Twist]
    connection: GO2Connection | None = None

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._app = FastAPI()
        self._server: uvicorn.Server | None = None
        self._server_thread: Thread | None = None
        self._server_loop: asyncio.AbstractEventLoop | None = None
        self._clients: set[WebSocket] = set()
        self._last_odom_monotonic = 0.0
        self._last_pose: tuple[float, float, float] | None = None
        self._last_pose_monotonic = 0.0
        self._last_emit_monotonic = 0.0
        self._last_battery_query_monotonic = 0.0
        self._battery_soc: int | None = None
        self._motion_timer: Timer | None = None
        self._motion_generation = 0
        self._motion_lock = Lock()
        self._limits = SafetyLimits()
        self._register_routes()

    @rpc
    def start(self) -> None:
        super().start()
        unsubscribe = self.odom.subscribe(self._on_odom)
        self.register_disposable(Disposable(unsubscribe))
        self._server_thread = Thread(
            target=self._run_server,
            name="moontology-bridge",
            daemon=True,
        )
        self._server_thread.start()
        logger.info(
            "[ORIN] telemetry bridge starting",
            host=self.config.host,
            port=self.config.port,
            commands_enabled=self.config.commands_enabled,
        )

    @rpc
    def stop(self) -> None:
        self._priority_stop()
        if self._server is not None:
            self._server.should_exit = True
        if self._server_loop is not None:
            self._server_loop.call_soon_threadsafe(lambda: None)
        if self._server_thread and self._server_thread.is_alive():
            self._server_thread.join(timeout=3.0)
        super().stop()

    def _register_routes(self) -> None:
        @self._app.get("/health")
        async def health() -> dict[str, Any]:
            return {
                "service": "moontology-bridge",
                "robotConnected": self._robot_connected(),
                "commandsEnabled": self.config.commands_enabled,
                "clients": len(self._clients),
            }

        @self._app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket) -> None:
            if not self._origin_allowed(websocket):
                await websocket.close(code=1008, reason="origin not allowed")
                return
            if not self._token_allowed(websocket):
                await websocket.close(code=1008, reason="invalid token")
                return

            await websocket.accept()
            self._clients.add(websocket)
            logger.info("[ORIN] Moontology client connected")
            try:
                await websocket.send_json(
                    {
                        "type": "status",
                        "connected": self._robot_connected(),
                        "commandsEnabled": self.config.commands_enabled,
                    }
                )
                while True:
                    payload = await websocket.receive_json()
                    await self._handle_command(websocket, payload)
            except WebSocketDisconnect:
                pass
            finally:
                self._clients.discard(websocket)
                logger.info("[ORIN] Moontology client disconnected")

    def _origin_allowed(self, websocket: WebSocket) -> bool:
        configured = {
            value.strip()
            for value in self.config.allowed_origins.split(",")
            if value.strip()
        }
        origin = websocket.headers.get("origin")
        return "*" in configured or origin in configured

    def _token_allowed(self, websocket: WebSocket) -> bool:
        expected = self.config.command_token
        return expected is None or websocket.query_params.get("token") == expected

    async def _handle_command(
        self,
        websocket: WebSocket,
        payload: Any,
    ) -> None:
        try:
            command = parse_command(payload, self._limits)
            if isinstance(command, StopCommand):
                self._priority_stop()
                await websocket.send_json({"type": "command_ack", "command": "stop"})
                return
            if not self.config.commands_enabled:
                raise CommandValidationError(
                    "physical commands are disabled; set MOONTOLOGY_COMMANDS_ENABLED=1 "
                    "only after GARAGE READY"
                )
            self._run_velocity(command)
            await websocket.send_json(
                {
                    "type": "command_ack",
                    "command": "velocity",
                    "accepted": {
                        "forward": command.forward,
                        "lateral": command.lateral,
                        "yaw": command.yaw,
                        "durationMs": command.duration_ms,
                    },
                }
            )
        except CommandValidationError as error:
            await websocket.send_json(
                {"type": "command_rejected", "reason": str(error)}
            )

    def _run_velocity(self, command: VelocityCommand) -> None:
        with self._motion_lock:
            self._motion_generation += 1
            generation = self._motion_generation
            if self._motion_timer is not None:
                self._motion_timer.cancel()
            self.cmd_vel.publish(
                Twist(
                    linear=Vector3(command.forward, command.lateral, 0.0),
                    angular=Vector3(0.0, 0.0, command.yaw),
                )
            )
            self._motion_timer = Timer(
                command.duration_ms / 1000.0,
                self._stop_if_current,
                args=(generation,),
            )
            self._motion_timer.daemon = True
            self._motion_timer.start()
        logger.info(
            "[COMMAND] accepted",
            command="velocity",
            forward=command.forward,
            lateral=command.lateral,
            yaw=command.yaw,
            duration_ms=command.duration_ms,
        )

    def _stop_if_current(self, generation: int) -> None:
        with self._motion_lock:
            if generation != self._motion_generation:
                return
        self._priority_stop()

    def _priority_stop(self) -> None:
        with self._motion_lock:
            self._motion_generation += 1
            if self._motion_timer is not None:
                self._motion_timer.cancel()
                self._motion_timer = None
            self.cmd_vel.publish(Twist(linear=Vector3(), angular=Vector3()))
        logger.info("[SAFETY] STOP")

    def _on_odom(self, pose: PoseStamped) -> None:
        now = time.monotonic()
        self._last_odom_monotonic = now
        interval = 1.0 / max(self.config.telemetry_hz, 1.0)
        if now - self._last_emit_monotonic < interval:
            return

        yaw = self._yaw(pose.orientation)
        velocity = self._velocity(pose, yaw, now)
        self._last_emit_monotonic = now
        self._refresh_battery(now)
        payload: dict[str, Any] = {
            "type": "telemetry",
            "timestamp": round(time.time() * 1000),
            "connected": True,
            "pose": {
                "x": pose.position.x,
                "y": pose.position.y,
                "z": pose.position.z,
            },
            "orientation": {
                "x": pose.orientation.x,
                "y": pose.orientation.y,
                "z": pose.orientation.z,
                "w": pose.orientation.w,
            },
            "velocity": velocity,
        }
        if self._battery_soc is not None:
            payload["battery"] = self._battery_soc
        self._schedule_broadcast(payload)

    def _refresh_battery(self, now: float) -> None:
        if self.connection is None or now - self._last_battery_query_monotonic < 5.0:
            return
        self._last_battery_query_monotonic = now
        try:
            self._battery_soc = self.connection.get_battery_soc()
        except Exception:
            logger.debug("battery telemetry unavailable", exc_info=True)

    def _velocity(
        self,
        pose: PoseStamped,
        yaw: float,
        now: float,
    ) -> dict[str, float]:
        current = (pose.position.x, pose.position.y, yaw)
        if self._last_pose is None or self._last_pose_monotonic <= 0:
            velocity = {"x": 0.0, "y": 0.0, "yaw": 0.0}
        else:
            dt = max(now - self._last_pose_monotonic, 1e-6)
            yaw_delta = math.atan2(
                math.sin(yaw - self._last_pose[2]),
                math.cos(yaw - self._last_pose[2]),
            )
            velocity = {
                "x": (current[0] - self._last_pose[0]) / dt,
                "y": (current[1] - self._last_pose[1]) / dt,
                "yaw": yaw_delta / dt,
            }
        self._last_pose = current
        self._last_pose_monotonic = now
        return velocity

    @staticmethod
    def _yaw(orientation: Quaternion) -> float:
        return math.atan2(
            2.0 * (orientation.w * orientation.z + orientation.x * orientation.y),
            1.0 - 2.0 * (orientation.y * orientation.y + orientation.z * orientation.z),
        )

    def _robot_connected(self) -> bool:
        return (
            self._last_odom_monotonic > 0
            and time.monotonic() - self._last_odom_monotonic < 2.0
        )

    def _schedule_broadcast(self, payload: dict[str, Any]) -> None:
        if self._server_loop is None or not self._clients:
            return
        asyncio.run_coroutine_threadsafe(
            self._broadcast(payload),
            self._server_loop,
        )

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for client in tuple(self._clients):
            try:
                await client.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                stale.append(client)
        for client in stale:
            self._clients.discard(client)

    def _run_server(self) -> None:
        async def serve() -> None:
            self._server_loop = asyncio.get_running_loop()
            self._server = uvicorn.Server(
                uvicorn.Config(
                    self._app,
                    host=self.config.host,
                    port=self.config.port,
                    log_level="warning",
                    access_log=False,
                )
            )
            logger.info(
                "[ORIN] telemetry bridge listening",
                host=self.config.host,
                port=self.config.port,
            )
            await self._server.serve()

        asyncio.run(serve())


moontology_bridge = MoontologyBridge.blueprint()

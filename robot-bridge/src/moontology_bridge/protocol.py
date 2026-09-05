from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal


class CommandValidationError(ValueError):
    pass


@dataclass(frozen=True)
class SafetyLimits:
    max_forward_mps: float = 0.20
    max_lateral_mps: float = 0.10
    max_yaw_rps: float = 0.50
    min_duration_ms: int = 50
    max_duration_ms: int = 500


DEFAULT_SAFETY_LIMITS = SafetyLimits()


@dataclass(frozen=True)
class StopCommand:
    type: Literal["stop"] = "stop"


@dataclass(frozen=True)
class VelocityCommand:
    forward: float
    lateral: float
    yaw: float
    duration_ms: int
    type: Literal["velocity"] = "velocity"


RobotCommand = StopCommand | VelocityCommand


def _finite_number(payload: dict[str, Any], name: str) -> float:
    value = payload.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CommandValidationError(f"{name} must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise CommandValidationError(f"{name} must be a finite number")
    return value


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


def parse_command(
    payload: Any,
    limits: SafetyLimits = DEFAULT_SAFETY_LIMITS,
) -> RobotCommand:
    if not isinstance(payload, dict):
        raise CommandValidationError("command must be a JSON object")

    command_type = payload.get("type")
    if command_type == "stop":
        return StopCommand()
    if command_type == "local_goal":
        raise CommandValidationError(
            "local_goal is disabled until the planner is validated on this robot"
        )
    if command_type != "velocity":
        raise CommandValidationError(f"unsupported command type: {command_type!r}")

    duration = _finite_number(payload, "durationMs")
    duration_ms = max(
        limits.min_duration_ms,
        min(limits.max_duration_ms, round(duration)),
    )
    return VelocityCommand(
        forward=_clamp(
            _finite_number(payload, "forward"),
            limits.max_forward_mps,
        ),
        lateral=_clamp(
            _finite_number(payload, "lateral"),
            limits.max_lateral_mps,
        ),
        yaw=_clamp(
            _finite_number(payload, "yaw"),
            limits.max_yaw_rps,
        ),
        duration_ms=duration_ms,
    )

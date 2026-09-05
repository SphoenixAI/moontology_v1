"""Local map client, measured-pose transform and bounded mission capability."""
from __future__ import annotations
import json
import math
import threading
import time
import uuid
from dataclasses import dataclass
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlparse

MISSION = 'Go inspect the lunar excavator and ready it for operations.'


class GateError(RuntimeError):
    pass


def angle(value):
    return math.atan2(math.sin(value), math.cos(value))


@dataclass(frozen=True)
class Sample:
    x: float
    y: float
    z: float
    yaw: float
    sequence: int
    received: float
    timestamp: float
    source: str


@dataclass(frozen=True)
class Alignment:
    physical: Sample
    virtual_x: float
    virtual_y: float
    virtual_z: float
    virtual_yaw: float
    scale: float = 40.

    def map(self, sample):
        dx, dy = sample.x - self.physical.x, sample.y - self.physical.y
        c, s = math.cos(self.physical.yaw), math.sin(self.physical.yaw)
        forward, left = c * dx + s * dy, -s * dx + c * dy
        vc, vs = math.cos(self.virtual_yaw), math.sin(self.virtual_yaw)
        return {'x': self.virtual_x + self.scale * (forward * vc - left * vs),
                'y': self.virtual_y,
                'z': self.virtual_z - self.scale * (forward * vs + left * vc)}, angle(self.virtual_yaw + sample.yaw - self.physical.yaw)


class MapClient:
    def __init__(self, base='http://127.0.0.1:5173/api/map'):
        u = urlparse(base)
        if u.scheme != 'http' or u.hostname not in ('127.0.0.1', 'localhost'):
            raise GateError('Map must be this Air loopback runtime')
        self.base = base.rstrip('/')
        self.lock = threading.RLock()
        self.response = None
        self.latencies = []
        self.last_success = 0.

    def _call(self, path, body=None):
        start = time.monotonic()
        data = None if body is None else json.dumps(body).encode()
        req = Request(self.base + '/' + path, data=data, headers={'Content-Type':'application/json'})
        try:
            with urlopen(req, timeout=1.4) as response:
                result = json.load(response)
        except HTTPError as error:
            result = json.load(error)
            if 'observation' in result:
                self.response = result
            raise GateError(result.get('error', str(error))) from error
        except Exception as error:
            raise GateError(f'map_unavailable: {type(error).__name__}') from error
        obs = result.get('observation')
        if not result.get('ok') or not isinstance(obs, dict):
            raise GateError('Map returned no live observation')
        self.response = result
        self.last_success = time.monotonic()
        self.latencies.append(self.last_success - start)
        return result

    def read(self):
        with self.lock:
            return self._call('observation')['observation']

    def post(self, path, **body):
        with self.lock:
            if self.response is None or time.monotonic() - self.last_success > 1:
                self._call('observation')
            body.update(command_id=str(uuid.uuid4()), read_token=self.response['read_token'])
            return self._call(path, body)

    def current(self):
        with self.lock:
            if not self.response:
                raise GateError('Observe first')
            return self.response['observation']


class BoundedCapability:
    """Only this capability can issue high-level Move; never exposes joints/motors.

    STOP bypasses the map/mission lock. A dedicated 50Hz watchdog expires the
    short movement lease even if map I/O or the mission thread stalls.
    """
    # Go2 gait facts (Unitree sport API + legion1581/go2_webrtc_connect MCF
    # examples, unitree_sdk2 go2_sport_client.cpp): the controller stays in
    # stance for tiny velocities and ramps over several hundred ms. Every
    # community example drives Move at 0.3 m/s; 0.04 m/s for 0.35 s produced
    # 0.05 mm here (runs/forward-test-1788586917546490000.json). Pulses are
    # still short leases renewed at 50 Hz, so a lost link stops the robot.
    MAX_FORWARD = .25
    MAX_YAW = .50
    MAX_PULSE = .80
    MIN_PULSE = .30          # Shorter Sport Move leases never leave stance (measured 0.17-0.23 s pulses: 0 rad).
    HEADING_TOLERANCE = .30  # rad; a quadruped cannot hold a 0.08 rad heading with discrete pulses.
    MAX_ACTIONS = 120
    MAX_TRAVEL = .60
    MAX_RADIUS = .45
    MAX_YAW_TRAVEL = 4.0
    MAX_RUN_SECONDS = 90.
    # Two Wi-Fi hops (Air -> router -> Go2 STA-L) show odometry receipt jitter
    # of 0.5-1.05 s. The deadman lease bounds motion independent of odometry,
    # so freshness gates tolerate that jitter rather than latching mid-walk.
    STALE_SECONDS = 1.5
    JUMP_STEP = .05        # metres beyond commanded travel between samples
    JUMP_TURN = .20        # radians beyond commanded turn between samples

    @classmethod
    def jump_limits(cls, dt):
        """Largest plausible odometry change for one gap of dt seconds."""
        dt = max(0., dt)
        return cls.JUMP_STEP + 2*cls.MAX_FORWARD*dt, cls.JUMP_TURN + 2*cls.MAX_YAW*dt

    def __init__(self, runtime):
        self.runtime = runtime
        self.lock = threading.RLock()
        self.armed = False
        self.command = (0., 0.)
        self.expiry = 0.
        self.actions = 0
        self.armed_at = 0.
        self.stop_reason = 'not_armed'
        self.travel = 0.
        self.yaw_travel = 0.
        self.last_sample = None
        self.origin = None
        self.closed = threading.Event()
        self.worker = threading.Thread(target=self._watch, daemon=True, name='bounded-stop-watchdog')
        self.worker.start()

    def arm(self):
        with self.lock:
            r = self.runtime
            sample = r.fresh_sample()
            if not r.backend or not r.backend.ready() or not r.alignment or not r.feedback_valid():
                raise GateError('Controller, calibration and measured map feedback must be ready')
            if r.mode == 'live':
                r.backend.require_clear()
            self.armed = True
            self.origin = sample
            self.last_sample = sample
            self.travel = self.yaw_travel = 0.
            self.actions = 0
            self.armed_at = time.monotonic()
            self.stop_reason = None

    def pulse(self, forward, yaw, duration):
        with self.lock:
            if not self.armed:
                raise GateError(self.stop_reason or 'Not armed')
            if not all(math.isfinite(x) for x in (forward,yaw,duration)):
                raise GateError('Nonfinite movement')
            if not (0 <= forward <= self.MAX_FORWARD and abs(yaw) <= self.MAX_YAW and 0 < duration <= self.MAX_PULSE):
                raise GateError('Movement outside bounded capability')
            if forward and yaw:
                raise GateError('Translate and rotate separately')
            if self.actions >= self.MAX_ACTIONS:
                self.stop('action_limit')
                raise GateError('action_limit')
            self.runtime.fresh_sample()
            if not self.runtime.feedback_valid():
                raise GateError('map_feedback_stale_or_held')
            if self.runtime.mode == 'live':
                self.runtime.backend.require_clear(forward,yaw)
            self.actions += 1
            self.command = (forward,yaw)
            self.expiry = time.monotonic() + duration

    def stop(self, reason='operator_stop', disarm=True):
        with self.lock:
            self.command = (0.,0.)
            self.expiry = 0.
            if disarm:
                self.armed = False
                self.stop_reason = reason
            backend = self.runtime.backend
            if backend:
                backend.stop()

    def _watch(self):
        while not self.closed.wait(.02):
            try:
                with self.lock:
                    if not self.armed:
                        continue
                    r = self.runtime
                    s = r.fresh_sample()
                    if not r.feedback_valid() or not r.backend.ready():
                        self.stop('feedback_or_controller_lost'); continue
                    if r.mode == 'live':
                        r.backend.require_clear(*self.command)
                    if time.monotonic() - self.armed_at > self.MAX_RUN_SECONDS:
                        self.stop('run_timeout'); continue
                    if s.sequence != self.last_sample.sequence:
                        step = math.hypot(s.x-self.last_sample.x,s.y-self.last_sample.y)
                        turn = abs(angle(s.yaw-self.last_sample.yaw))
                        max_step, max_turn = self.jump_limits(s.received-self.last_sample.received)
                        if step > max_step or turn > max_turn:
                            self.stop('odometry_jump'); continue
                        self.travel += step; self.yaw_travel += turn; self.last_sample = s
                    if self.travel > self.MAX_TRAVEL or math.hypot(s.x-self.origin.x,s.y-self.origin.y) > self.MAX_RADIUS or self.yaw_travel > self.MAX_YAW_TRAVEL:
                        self.stop('physical_envelope'); continue
                    if self.expiry and time.monotonic() >= self.expiry:
                        self.stop('deadman', disarm=False)
                    elif self.expiry:
                        r.backend.move(*self.command)
            except Exception as error:
                self.stop(f'watchdog: {error}')

    def close(self):
        self.stop('shutdown'); self.closed.set(); self.worker.join(1)

"""Development odometry plant. This module cannot import/connect to live hardware.

Only the plant's independently sampled pose is passed to the map. Commands change
plant velocity, never a Three.js position. This is synthetic development telemetry,
not evidence of physical robot movement.
"""
from __future__ import annotations
import math
import threading
import time


class ReplayRobot:
    source = 'replay'
    physical_channel = False

    def __init__(self, on_sample):
        self.on_sample = on_sample
        self.closed = threading.Event()
        self.lock = threading.Lock()
        self.command = (0.0, 0.0, 0.0)
        self.pose = [0.0, 0.0, 0.0]
        self.seq = 0
        self.thread = threading.Thread(target=self._sample, daemon=True, name='isolated-replay-odom')
        self.thread.start()

    def ready(self):
        return not self.closed.is_set()

    def move(self, forward, yaw):
        with self.lock:
            self.command = (forward, yaw, time.monotonic() + .15)

    def stop(self):
        with self.lock:
            self.command = (0.0, 0.0, 0.0)

    def _sample(self):
        last = time.monotonic()
        while not self.closed.wait(.025):
            now = time.monotonic()
            dt = min(now - last, .05)
            last = now
            with self.lock:
                forward, yaw, expiry = self.command
                if now >= expiry:
                    forward = yaw = 0
                # A deliberately imperfect plant: actual displacement is 96% of demand.
                self.pose[2] += yaw * dt * .96
                self.pose[0] += forward * math.cos(self.pose[2]) * dt * .96
                self.pose[1] += forward * math.sin(self.pose[2]) * dt * .96
                self.seq += 1
                pose = tuple(self.pose)
            self.on_sample(pose[0], pose[1], 0., pose[2], self.seq, now, time.time(), self.source)

    def close(self):
        self.stop()
        self.closed.set()
        self.thread.join(1)

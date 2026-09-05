"""Robot-reported hardware faults must be visible and must gate posture/arming. No hardware."""
import importlib
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from moontology_bridge.air_core import GateError
from moontology_bridge.air_runtime import AirDemo


def air_live():
    # Imported lazily: other suites assert this transport module is never loaded
    # by replay/hold code paths, so it must not leak into sys.modules at import time.
    return importlib.import_module('moontology_bridge.air_live')


def decode_robot_error(source, code):
    return air_live().decode_robot_error(source, code)


def bare_live_robot():
    """LiveRobot state only; never builds the WebRTC transport."""
    robot = object.__new__(air_live().LiveRobot)
    robot.robot_errors = {}; robot.errors_received = 0.; robot.error_events = []
    robot.faults = []; robot.on_fault = robot.faults.append
    robot.closed = False; robot.controller_mode = 'mcf'
    robot.sport_received = time.monotonic(); robot.sport_state = {'body_height': .31, 'imu_state': {'rpy': [0., 0., 0.]}}
    robot.telemetry_only = False; robot.posture_only = True; robot.stand_attempted = False
    robot.sensors = SimpleNamespace(camera_received=time.monotonic())
    robot.connection = SimpleNamespace(conn=SimpleNamespace(datachannel=SimpleNamespace(pub_sub=SimpleNamespace(channel=SimpleNamespace(readyState='open')))))
    return robot


class RobotErrors(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        sys.modules.pop('moontology_bridge.air_live', None)

    def test_decode_motor_overheat_matches_observed_incident(self):
        entry = decode_robot_error(309, 4)
        self.assertEqual(entry['label'], '309-4')
        self.assertEqual(entry['motor_index'], 9)
        self.assertIn('Motor malfunction', entry['description'])
        self.assertIn('Driver overheating', entry['description'])
        self.assertTrue(entry['blocking'])

    def test_fan_and_radar_faults_are_reported_but_not_blocking(self):
        self.assertFalse(decode_robot_error(200, 4)['blocking'])
        self.assertFalse(decode_robot_error(400, 2)['blocking'])
        self.assertIn('unknown code', decode_robot_error(400, 0x77)['description'])

    def test_snapshot_add_and_remove_frames_track_active_faults(self):
        robot = bare_live_robot()
        robot._robot_errors('errors', [[1788586363, 309, 4], [1788586363, 200, 1]])
        self.assertEqual([e['label'] for e in robot.active_errors()], ['200-1', '309-4'])
        self.assertTrue(robot.blocking_errors())
        self.assertFalse(robot.ready(), 'standing height alone must not report ready during a motor fault')
        robot._robot_errors('rm_error', [1788586400, 309, 4])
        self.assertEqual([e['label'] for e in robot.active_errors()], ['200-1'])
        self.assertFalse(robot.blocking_errors())
        self.assertTrue(robot.ready())
        robot._robot_errors('add_error', [1788586500, 100, 1])
        self.assertTrue(robot.blocking_errors())
        status = robot.error_status()
        self.assertTrue(status['blocking'])
        self.assertEqual(len(status['recent_events']), 4)
        self.assertEqual(robot.faults, [])

    def test_malformed_frame_becomes_latched_fault_not_crash(self):
        robot = bare_live_robot()
        robot._robot_errors('errors', [['bad']])
        self.assertEqual(robot.faults, ['invalid_robot_error_frame'])

    def test_stand_refused_while_motor_fault_active_without_sending_anything(self):
        robot = bare_live_robot()
        robot.sport_state = {'body_height': .095, 'imu_state': {'rpy': [0.02, -0.07, 0.06]}}
        robot._robot_errors('errors', [[1788586363, 309, 4]])
        with self.assertRaisesRegex(RuntimeError, r'hardware fault.*309-4.*Driver overheating'):
            robot.stand_in_place()
        self.assertFalse(robot.stand_attempted)

    def test_arm_refuses_on_robot_hardware_fault_before_other_gates(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = AirDemo('live', 'http://127.0.0.1:1/api/map', Path(directory) / 'runs')
            fault = decode_robot_error(309, 4)
            runtime.backend = SimpleNamespace(posture_only=False, telemetry_only=False, ready=lambda: True,
                                              blocking_errors=lambda: [fault], stop=lambda: None)
            runtime.receive(0, 0, .3, 0, 1, time.monotonic(), time.time(), 'physical_odometry')
            runtime.feedback_valid = lambda: True
            try:
                with self.assertRaisesRegex(GateError, 'robot_hardware_fault: 309-4'):
                    runtime.arm(True, True)
                self.assertFalse(runtime.capability.armed)
            finally:
                runtime.closed.set(); runtime.feedback_thread.join(1); runtime.capability.close()

    def test_status_exposes_robot_errors_and_posture(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = AirDemo('live', 'http://127.0.0.1:1/api/map', Path(directory) / 'runs')
            robot = bare_live_robot(); robot._robot_errors('errors', [[1, 309, 4]])
            robot.odometry_timing = {}; robot.sensors = SimpleNamespace(status=lambda: {}, camera_received=0.)
            robot.stop = lambda: None  # teardown STOP path; no transport in this test
            runtime.backend = robot
            try:
                status = runtime.status()
                self.assertEqual(status['robot_errors']['active'][0]['label'], '309-4')
                self.assertEqual(status['body_height_m'], .31)
                self.assertEqual(status['controller_mode'], 'mcf')
                self.assertFalse(status['controller_ready'])
            finally:
                runtime.closed.set(); runtime.feedback_thread.join(1); runtime.capability.close()


if __name__ == '__main__':
    unittest.main()

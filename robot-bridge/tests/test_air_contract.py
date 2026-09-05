"""Safety/interface checks only; no robot connection or locomotion skill tests."""
import math
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
from moontology_bridge.air_core import Alignment, GateError, Sample
from moontology_bridge.air_runtime import AirDemo

class AirContract(unittest.TestCase):
    def test_forward_test_refuses_unarmed_live_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=AirDemo('live','http://127.0.0.1:1/api/map',directory)
            try:
                with self.assertRaisesRegex(GateError,'explicit live safety arming'):
                    runtime.forward_test()
                self.assertEqual(runtime.capability.actions,0)
            finally:
                runtime.closed.set();runtime.feedback_thread.join(1);runtime.capability.close()

    def test_bounded_capability_is_a_realizable_go2_gait_with_time_aware_jump_envelope(self):
        from moontology_bridge.air_core import BoundedCapability as B
        # Community Go2 practice (Unitree sport examples, go2_webrtc_connect MCF
        # example) drives Move at 0.3 m/s; below ~0.1 m/s the controller holds
        # stance. The lease must be long enough for the trot to ramp yet short
        # enough that the 50 Hz deadman bounds travel per pulse to ~0.2 m.
        self.assertGreaterEqual(B.MAX_FORWARD,.2);self.assertLessEqual(B.MAX_FORWARD,.4)
        self.assertLessEqual(B.MAX_FORWARD*B.MAX_PULSE,.25)
        self.assertLessEqual(B.MAX_RADIUS,.5);self.assertLessEqual(B.MAX_TRAVEL,.6)
        step,turn=B.jump_limits(0.)
        self.assertAlmostEqual(step,B.JUMP_STEP);self.assertAlmostEqual(turn,B.JUMP_TURN)
        step,turn=B.jump_limits(1.0)  # A one-second Wi-Fi gap at full speed is not a jump.
        self.assertGreater(step,B.MAX_FORWARD);self.assertGreater(turn,B.MAX_YAW)
        self.assertEqual(B.jump_limits(-5.),B.jump_limits(0.))  # Reordered clocks never widen the gate.

    def test_repeated_stale_packets_latch_one_stop_until_recalibration(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=AirDemo('live','http://127.0.0.1:1/api/map',directory)
            calls=[];runtime.backend=SimpleNamespace(stop=lambda:calls.append('stop'))
            try:
                for _ in range(100):runtime._fault('delayed_source_odometry')
                self.assertEqual(calls,['stop'])
                self.assertFalse(runtime.capability.armed)
                self.assertTrue(runtime.stop_event.is_set())
                self.assertEqual(runtime.pending_fault,'delayed_source_odometry')
            finally:
                runtime.closed.set();runtime.feedback_thread.join(1);runtime.capability.close()

    def test_recovery_cannot_release_hold_when_sensor_gate_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            hold=Path(directory,'hardware-hold.json');hold.write_text('{}')
            runtime=AirDemo('live','http://127.0.0.1:1/api/map',Path(directory)/'runs')
            def reject(*args):raise GateError('stationary_obstacle_check_required')
            runtime.backend=SimpleNamespace(posture_only=True,telemetry_only=False,ready=lambda:True,
                check_avoidance=lambda:None,require_clear=reject,stop=lambda:None)
            runtime.receive(0,0,.3,0,1,time.monotonic(),time.time(),'physical_odometry')
            runtime.feedback_valid=lambda:True
            try:
                with self.assertRaisesRegex(GateError,'stationary_obstacle_check_required'):
                    runtime.arm(True,True,recover=True)
                self.assertTrue(hold.exists())
                self.assertTrue(runtime.backend.posture_only)
                self.assertFalse(runtime.capability.armed)
            finally:
                runtime.closed.set();runtime.feedback_thread.join(1);runtime.capability.close()

    def test_telemetry_recovery_preserves_hold_and_rejects_arming(self):
        with tempfile.TemporaryDirectory() as directory:
            hold=Path(directory,'hardware-hold.json'); hold.write_text('{}')
            runtime=AirDemo('live','http://127.0.0.1:1/api/map',Path(directory)/'runs')
            backend=SimpleNamespace(telemetry_only=True,ready=lambda:False,stop=lambda:None,sensors=SimpleNamespace(status=lambda:{}))
            def sensor_adapter(*args,**kwargs):
                self.assertTrue(kwargs['telemetry_only'])
                return backend
            try:
                with patch.dict(sys.modules,{'moontology_bridge.air_live':SimpleNamespace(LiveRobot=sensor_adapter)}):
                    status=runtime.connect('192.168.8.115',True,telemetry_only=True)
                self.assertTrue(status['telemetry_only'])
                self.assertTrue(status['hardware_hold'])
                self.assertFalse(status['physical_execution_available'])
                with self.assertRaisesRegex(GateError,'cannot arm'):
                    runtime.arm(True,True)
                self.assertTrue(hold.exists())
            finally:
                runtime.closed.set(); runtime.feedback_thread.join(1); runtime.capability.close()

    def test_incident_hold_prevents_transport_import_and_reconnection(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory,'hardware-hold.json').write_text('{"reason":"operator recovery required"}')
            runtime=AirDemo('live','http://127.0.0.1:1/api/map',Path(directory)/'runs')
            try:
                with self.assertRaisesRegex(GateError,'operator_recovery_required'):
                    runtime.connect('192.168.8.115',True)
                self.assertIsNone(runtime.backend)
                self.assertNotIn('moontology_bridge.air_live',sys.modules)
            finally:
                runtime.closed.set(); runtime.feedback_thread.join(1); runtime.capability.close()

    def test_replay_has_no_physical_transport_and_rejects_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=AirDemo('replay','http://127.0.0.1:1/api/map',directory)
            try:
                self.assertFalse(runtime.backend.physical_channel)
                self.assertNotIn('moontology_bridge.air_live',sys.modules)
                with self.assertRaisesRegex(GateError,'no live transport'):
                    runtime.connect('10.0.0.71',True)
                self.assertNotIn('moontology_bridge.air_live',sys.modules)
                time.sleep(.06)
                runtime.receive(0,0,0,0,999,time.monotonic(),time.time(),'physical_odometry')
                with self.assertRaisesRegex(GateError,'source_or_value_invalid'):
                    runtime.fresh_sample()
            finally:
                runtime.closed.set(); runtime.feedback_thread.join(1)
                runtime.capability.close(); runtime.backend.close()

    def test_transform_scales_only_measured_delta_and_preserves_raw_pose(self):
        origin=Sample(10,20,.3,math.pi/2,1,0,0,'physical_odometry')
        measured=Sample(10,20.01,.3,math.pi/2,2,0,0,'physical_odometry')
        transformed,yaw=Alignment(origin,1.5,-.35,5,0,40).map(measured)
        self.assertAlmostEqual(transformed['x'],1.9)
        self.assertEqual(transformed['z'],5)
        self.assertEqual(measured.y,20.01)
        self.assertEqual(yaw,0)

    def test_live_rejects_replay_and_requires_explicit_sole_controller(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=AirDemo('live','http://127.0.0.1:1/api/map',directory)
            try:
                with self.assertRaisesRegex(GateError,'sole physical controller'):
                    runtime.connect('10.0.0.71',False)
                self.assertIsNone(runtime.backend)
                runtime.receive(0,0,0,0,1,time.monotonic(),time.time(),'replay')
                self.assertIsNone(runtime.sample)
                self.assertEqual(runtime.pending_fault,'telemetry_source_or_value_invalid')
            finally:
                runtime.closed.set(); runtime.feedback_thread.join(1); runtime.capability.close()

    def test_hidden_renderer_and_replaced_scene_hold_execution(self):
        runtime=object.__new__(AirDemo); runtime.session='session';runtime.run_id='run'
        obs={'map_ready':True,'scene_session_id':'session','performance':{'visible':False,'render_age_ms':10},'mission_state':{'run_id':'run','phase':'RUNNING','map_armed':True}}
        with self.assertRaisesRegex(GateError,'hidden_or_render_stale'):runtime._validate(obs,True)
        obs['performance']['visible']=True;obs['performance']['render_age_ms']=800
        with self.assertRaisesRegex(GateError,'hidden_or_render_stale'):runtime._validate(obs,True)
        obs['performance']['render_age_ms']=10;obs['scene_session_id']='reloaded'
        with self.assertRaisesRegex(GateError,'scene_changed'):runtime._validate(obs,True)

if __name__=='__main__':unittest.main()

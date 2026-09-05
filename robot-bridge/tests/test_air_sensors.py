"""Synthetic safety inputs only. Never imports or connects the live transport."""
import time
import unittest
import numpy as np
from moontology_bridge.air_core import GateError
from moontology_bridge.air_sensors import PhysicalSensors


class Sensors(unittest.TestCase):
    def fixture(self, obstructed=False, yaw=0.):
        s=PhysicalSensors();now=time.monotonic()
        s.odometry(10,20,.3,yaw,'odom',now)
        points=np.tile([12,20,0],(120,1)).astype(float)
        if obstructed:
            points[:5]=[10+.6*np.cos(yaw),20+.6*np.sin(yaw),.3]
        s.lidar({'data':{'stamp':100.,'frame_id':'odom','data':{'points':points}}})
        s.camera_error=None;s.camera_received=now;s.avoidance(True)
        return s,points

    def test_rotated_physical_obstacle_and_two_stage_validation(self):
        s,points=self.fixture(True,np.pi/2)
        self.assertTrue(s.status()['obstacles']['forward_blocked'])
        with self.assertRaisesRegex(GateError,'check_required'):s.require_clear(.04,0)
        s.check('obstructed')
        s.lidar({'data':{'stamp':100.05,'frame_id':'odom','data':{'points':points}}})
        with self.assertRaisesRegex(GateError,'still_detected'):s.check('clear')
        points[:5]=[12,20,0]
        s.lidar({'data':{'stamp':100.1,'frame_id':'odom','data':{'points':points}}})
        s.check('clear');s.require_clear(.04,0)
        points[:5]=[10,20.6,.3]
        s.lidar({'data':{'stamp':100.2,'frame_id':'odom','data':{'points':points}}})
        with self.assertRaisesRegex(GateError,'obstacle_detected'):s.require_clear(.04,0)

    def test_turn_halo_and_room_sectors(self):
        # An object 0.67 m dead ahead is outside the 0.40 m corner sweep: forward stays
        # allowed (corridor 0.65) and yaw is not vetoed; at 0.55 m yaw is vetoed.
        s,points=self.fixture(False,0.)
        points[:4]=[10.67,20,.3]
        s.lidar({'data':{'stamp':100.05,'frame_id':'odom','data':{'points':points}}})
        o=s.status()['obstacles']
        self.assertFalse(o['turn_blocked']);self.assertFalse(o['forward_blocked'])
        self.assertAlmostEqual(o['sectors_m']['front'],.67,places=2);self.assertIsNone(o['sectors_m']['left'])
        points[:4]=[10.55,20,.3]
        s.lidar({'data':{'stamp':100.1,'frame_id':'odom','data':{'points':points}}})
        o=s.status()['obstacles']
        self.assertTrue(o['turn_blocked']);self.assertTrue(o['forward_blocked'])
        self.assertAlmostEqual(o['nearest_turn_m'],.55,places=2);self.assertAlmostEqual(o['nearest_turn_bearing_rad'],0.,places=3)
        with self.assertRaisesRegex(GateError,'check_required'):s.require_clear(0,.5)
        s.manual_check_required=False
        with self.assertRaisesRegex(GateError,'obstacle_detected'):s.require_clear(0,.5)

    def test_explicit_manual_check_waiver_keeps_obstacle_and_stale_gates(self):
        s,points=self.fixture(True)
        s.manual_check_required=False
        with self.assertRaisesRegex(GateError,'obstacle_detected'):s.require_clear(.04,0)
        points[:5]=[12,20,0]
        s.lidar({'data':{'stamp':100.1,'frame_id':'odom','data':{'points':points}}})
        s.require_clear(.04,0)
        self.assertFalse(s.check_completed)
        s.lidar_received-=PhysicalSensors.MAX_AGE+.5
        with self.assertRaisesRegex(GateError,'lidar_stale'):s.require_clear(.04,0)

    def test_frozen_timestamp_cannot_refresh_freshness(self):
        s,points=self.fixture();s.lidar_received-=PhysicalSensors.MAX_AGE+.5
        s.lidar({'data':{'stamp':100.,'frame_id':'odom','data':{'points':points}}})
        with self.assertRaisesRegex(GateError,'lidar_stale'):s.require_clear()
        self.assertFalse(s.check_completed)

    def test_unknown_frame_camera_and_avoidance_fail_closed(self):
        s,_=self.fixture();s.lidar_frame='unverified'
        with self.assertRaisesRegex(GateError,'frame_unverified'):s.require_clear()
        s.lidar_frame='odom';s.camera_received-=2
        with self.assertRaisesRegex(GateError,'camera_stale'):s.require_clear()
        s.camera_received=time.monotonic();s.avoidance(False)
        with self.assertRaisesRegex(GateError,'avoidance_not_confirmed'):s.require_clear()

    def test_coarse_clock_requires_distinct_data_health_and_object_validation(self):
        s,points=self.fixture(True)
        s.lidar_stamp=None
        s.health({'error_state':0,'cloud_frequency':12,'sys_rotation_speed':10000})
        for index in range(15):
            points[-1,0]=12+index*.05
            s.lidar({'data':{'stamp':1788581000.,'frame_id':'odom','data':{'points':points}}})
        self.assertEqual(s.freshness_basis,'distinct_cloud_plus_fresh_odometry')
        self.assertEqual(s.lidar_stamp,1788581000.)
        with self.assertRaisesRegex(GateError,'check_required'):s.require_clear(.04,0)
        s.check('obstructed')
        points[:5]=[12,20,0]
        s.lidar({'data':{'stamp':1788581000.,'frame_id':'odom','data':{'points':points}}})
        s.check('clear');s.require_clear(.04,0)
        s.lidar_health_received-=3
        with self.assertRaisesRegex(GateError,'liveness_unverified'):s.require_clear(.04,0)
        self.assertFalse(s.check_completed)
        s.lidar_received-=PhysicalSensors.MAX_AGE+.5
        s.lidar({'data':{'stamp':1788581000.,'frame_id':'odom','data':{'points':points}}})
        with self.assertRaisesRegex(GateError,'lidar_stale'):s.require_clear(.04,0)


if __name__=='__main__':unittest.main()

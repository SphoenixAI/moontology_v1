"""Physical-only camera/voxel diagnostics and conservative obstacle veto.

This is not a physical path planner or a proof of free space. The operator must
still clear the lane. Missing returns, low objects, drops and unmapped obstacles
are not certified safe. No simulated points or repaired sensor clocks accepted.
"""
from __future__ import annotations
import io
import hashlib
import math
import threading
import time
import numpy as np
from PIL import Image
from .air_core import GateError


TURN_HALO = .60 # metres from body centre that vetoes in-place yaw


class PhysicalSensors:
    MAX_AGE = 1.5   # matches BoundedCapability.STALE_SECONDS; Wi-Fi jitter tolerance

    def __init__(self):
        self.lock = threading.RLock()
        self.points = None
        self.lidar_stamp = None
        self.lidar_received = 0.
        self.lidar_offset = None
        self.lidar_frame = None
        self.lidar_sequence = 0
        self.lidar_error = 'no_lidar'
        self.lidar_packets = 0
        self.lidar_packet_received = 0.
        self.lidar_metadata = None
        self.lidar_device_state = None
        self.avoidance_enable_reply = None
        self.avoidance_service_reply = None
        self.cloud_digest = None
        self.distinct_clouds = 0
        self.cloud_changed_at = 0.
        self.latest_cloud_points = 0
        self.same_stamp_packets = 0
        self.freshness_basis = 'source_timestamp'
        self.lidar_health_received = 0.
        self.odom = None
        self.jpeg = None
        self.camera_received = 0.
        self.camera_pts = None
        self.camera_error = 'no_camera'
        self.avoidance_enabled = None
        self.avoidance_received = 0.
        self.obstruction_proof = None
        self.check_completed = False
        self.manual_check_required = True

    def odometry(self, x,y,z,yaw,frame,received):
        with self.lock:
            if self.odom and self.odom[4] != frame:
                self.check_completed = False
            self.odom = (x,y,z,yaw,frame,received)

    def lidar(self, raw):
        try:
            data = raw['data']; stamp = float(data['stamp']); now = time.monotonic()
            with self.lock:
                self.lidar_packets += 1
                self.lidar_packet_received = now
                self.lidar_metadata = {k:v for k,v in data.items() if k != 'data'}
            points = np.asarray(data['data']['points'])
            frame = data.get('frame_id')
            if not math.isfinite(stamp) or points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
                raise ValueError('invalid_lidar_values')
            digest = hashlib.blake2s(points.tobytes(),digest_size=16).hexdigest()
            with self.lock:
                self.latest_cloud_points = len(points)
                changed = digest != self.cloud_digest
                if changed:
                    self.cloud_digest = digest
                    self.distinct_clouds += 1
                    self.cloud_changed_at = now
                if self.lidar_stamp is not None and stamp < self.lidar_stamp:
                    raise ValueError('lidar_source_clock_regressed')
                if stamp == self.lidar_stamp:
                    self.same_stamp_packets += 1
                else:
                    self.same_stamp_packets = 0
                # Verified firmware reports epoch seconds rounded to 1000 s.
                # Preserve that raw value. Compatibility never refreshes from
                # packet arrival alone: a distinct cloud, fresh raw odometry,
                # healthy sensor and object-in/out validation are also required.
                if self.same_stamp_packets >= 10 and stamp >= 1e9 and stamp % 1000 == 0:
                    self.freshness_basis = 'distinct_cloud_plus_fresh_odometry'
                coarse = self.freshness_basis != 'source_timestamp'
                if coarse and not changed:
                    return
                if not coarse and stamp == self.lidar_stamp:
                    return
                offset = now-stamp
                self.lidar_offset = offset if self.lidar_offset is None else min(offset,self.lidar_offset)
                if not coarse and offset-self.lidar_offset > self.MAX_AGE:
                    raise ValueError('delayed_lidar_source')
                if self.lidar_frame and frame != self.lidar_frame:
                    self.check_completed = False
                self.points = points.copy()
                self.lidar_stamp, self.lidar_received, self.lidar_frame = stamp,now,frame
                self.lidar_sequence += 1
                self.lidar_error = None
        except Exception as error:
            with self.lock:
                self.lidar_error = str(error)
                self.check_completed = False
                self.obstruction_proof = None

    def health(self, data):
        with self.lock:
            self.lidar_device_state = data
            self.lidar_health_received = time.monotonic()

    def camera(self, frame):
        # Encode at most 2 thumbnails per second; keep heavy work off the control loop.
        now = time.monotonic()
        if now-self.camera_received < .5:
            return
        try:
            if frame.pts is None or (self.camera_pts is not None and frame.pts <= self.camera_pts):
                return
            im = Image.fromarray(frame.data); im.thumbnail((640,360))
            output = io.BytesIO(); im.save(output,format='JPEG',quality=65)
            with self.lock:
                self.jpeg, self.camera_received, self.camera_pts = output.getvalue(),now,frame.pts
                self.camera_error = None
        except Exception:
            self.camera_error = 'camera_decode_failed'

    def avoidance(self, enabled):
        with self.lock:
            self.avoidance_enabled = enabled if isinstance(enabled,bool) else None
            self.avoidance_received = time.monotonic()

    def _geometry(self):
        if self.points is None or self.odom is None:
            return None
        x,y,z,yaw,frame,_ = self.odom
        # Never silently assume differently named coordinate frames are aligned.
        if not frame or frame != self.lidar_frame:
            return None
        points = self.points
        dx,dy,dz = points[:,0]-x,points[:,1]-y,points[:,2]-z
        c,s = math.cos(yaw),math.sin(yaw)
        f,l = c*dx+s*dy,-s*dx+c*dy
        # Conservatively exclude only the existing body footprint and floor-height
        # returns. This limited slab has blind spots, stated in the public status.
        slab = (dz > -.15)&(dz < .8)
        outside_body = (np.abs(f) > .43)|(np.abs(l) > .27)
        obstacles = slab&outside_body
        # Lookahead = one max lease (0.2 m) + Go2 stopping distance (~0.1 m) + margin.
        corridor = obstacles&(f > 0)&(f < .65)&(np.abs(l) < .38)
        # In-place yaw sweeps the body corners at ~0.40 m (0.70 x 0.31 m body plus leg
        # splay); 0.60 m keeps a 50% margin over that sweep plus turn drift, the same
        # ratio the corridor keeps over one lease + stopping distance.
        turn_halo = obstacles&(np.hypot(f,l) < TURN_HALO)
        forward = f[slab&(f > .43)&(np.abs(l) < .38)]
        # Room awareness for the reasoning layer: nearest return per 45° sector
        # (robot frame, 'front' = +f, 'left' = +l) within 2 m, plus the closest
        # return inside the turn halo and its bearing.
        rng = np.hypot(f[obstacles],l[obstacles]); ang = np.arctan2(l[obstacles],f[obstacles])
        names = ['front','front_left','left','rear_left','rear','rear_right','right','front_right']
        sectors = {}
        for i,name in enumerate(names):
            centre = i*math.pi/4 if i <= 4 else (i-8)*math.pi/4
            diff = np.abs(np.arctan2(np.sin(ang-centre),np.cos(ang-centre)))
            sel = (diff <= math.pi/8)&(rng < 2.)
            sectors[name] = round(float(rng[sel].min()),2) if np.any(sel) else None
        halo = rng[rng < TURN_HALO]
        nearest_turn = float(halo.min()) if len(halo) else None
        nearest_turn_bearing = float(ang[rng < TURN_HALO][np.argmin(halo)]) if len(halo) else None
        return {'forward_blocked':bool(np.any(corridor)), 'turn_blocked':bool(np.any(turn_halo)),
                'forward_obstacle_points':int(np.count_nonzero(corridor)),
                'turn_obstacle_points':int(np.count_nonzero(turn_halo)),
                'nearest_forward_m':float(forward.min()) if len(forward) else None,
                'nearest_turn_m':nearest_turn,'nearest_turn_bearing_rad':nearest_turn_bearing,
                'sectors_m':sectors}

    def status(self):
        with self.lock:
            now = time.monotonic()
            return {'source':'physical_go2_sensors','lidar_age_ms':(now-self.lidar_received)*1000 if self.lidar_received else None,
                    'lidar_source_stamp':self.lidar_stamp,'lidar_frame':self.lidar_frame,
                    'odometry_frame':self.odom[4] if self.odom else None,
                    'lidar_points':len(self.points) if self.points is not None else 0,
                    'lidar_sequence':self.lidar_sequence,'lidar_error':self.lidar_error,
                    'lidar_received_packets':self.lidar_packets,'lidar_metadata':self.lidar_metadata,
                    'lidar_device_state':self.lidar_device_state,'avoidance_enable_reply':self.avoidance_enable_reply,
                    'avoidance_service_reply':self.avoidance_service_reply,
                    'distinct_clouds':self.distinct_clouds,'latest_cloud_points':self.latest_cloud_points,
                    'cloud_change_age_ms':(now-self.cloud_changed_at)*1000 if self.cloud_changed_at else None,
                    'lidar_freshness_basis':self.freshness_basis,
                    'lidar_source_latency_verified':self.freshness_basis=='source_timestamp',
                    'lidar_health_age_ms':(now-self.lidar_health_received)*1000 if self.lidar_health_received else None,
                    'lidar_packet_age_ms':(now-self.lidar_packet_received)*1000 if self.lidar_packet_received else None,
                    'camera_age_ms':(now-self.camera_received)*1000 if self.camera_received else None,
                    'camera_error':self.camera_error,'camera_url':'http://127.0.0.1:8766/camera.jpg',
                    'onboard_avoidance_enabled':self.avoidance_enabled,
                    'onboard_avoidance_age_ms':(now-self.avoidance_received)*1000 if self.avoidance_received else None,
                    'stationary_obstacle_check_passed':self.check_completed,'manual_obstacle_check_required':self.manual_check_required,'obstacles':self._geometry(),
                    'scope':'conservative_obstacle_veto_operator_clear_lane_required',
                    'limitations':['no_physical_path_planner','no_drop_or_low_object_guarantee','voxel_absence_is_not_free_space']}

    def _fresh(self):
        now = time.monotonic()
        if self.lidar_error or now-self.lidar_received > self.MAX_AGE:
            raise GateError('physical_lidar_stale_or_invalid')
        if self.odom is None or now-self.odom[5] > self.MAX_AGE:
            raise GateError('physical_sensor_odometry_stale')
        if self.freshness_basis != 'source_timestamp':
            health = self.lidar_device_state or {}
            if (now-self.cloud_changed_at > self.MAX_AGE or now-self.lidar_packet_received > self.MAX_AGE or
                now-self.lidar_health_received > 2 or health.get('error_state') != 0 or
                health.get('cloud_frequency',0) < 5 or health.get('sys_rotation_speed',0) < 100):
                raise GateError('physical_lidar_liveness_unverified')
        if self.points is None or len(self.points) < 100:
            raise GateError('physical_lidar_coverage_unknown')
        if self._geometry() is None:
            raise GateError('physical_lidar_odometry_frame_unverified')
        if self.camera_error or now-self.camera_received > 1.5:
            raise GateError('physical_camera_stale_or_invalid')
        if self.avoidance_enabled is not True or now-self.avoidance_received > 5:
            raise GateError('onboard_obstacle_avoidance_not_confirmed')

    def check(self, stage):
        with self.lock:
            self._fresh(); geometry = self._geometry()
            if stage == 'obstructed':
                if geometry['forward_obstacle_points'] < 3:
                    raise GateError('stationary_test_obstacle_not_detected')
                self.obstruction_proof = (time.monotonic(),self.lidar_sequence)
                self.check_completed = False
            elif stage == 'clear':
                proof = self.obstruction_proof
                if not proof or time.monotonic()-proof[0] > 120 or self.lidar_sequence <= proof[1]:
                    raise GateError('stationary_obstructed_stage_required_first')
                if geometry['forward_blocked'] or geometry['turn_blocked']:
                    raise GateError('physical_obstacle_still_detected')
                self.check_completed = True
            else:
                raise GateError('sensor_check_stage_must_be_obstructed_or_clear')
            return self.status()

    def require_clear(self, forward=0.,yaw=0.):
        with self.lock:
            try:
                self._fresh()
            except GateError:
                self.check_completed = False
                self.obstruction_proof = None
                raise
            if self.manual_check_required and not self.check_completed:
                raise GateError('stationary_physical_obstacle_check_required')
            geometry = self._geometry()
            if (forward and geometry['forward_blocked']) or (yaw and geometry['turn_blocked']):
                raise GateError('physical_obstacle_detected')

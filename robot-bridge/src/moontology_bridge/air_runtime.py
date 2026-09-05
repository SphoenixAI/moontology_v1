from __future__ import annotations
from dataclasses import asdict
import ipaddress
import math
import os
from pathlib import Path
import json
import threading
import time
from dimos.agents.annotation import skill
from dimos.agents.skill_result import SkillResult
from .air_core import Alignment, BoundedCapability, GateError, MapClient, MISSION, Sample, angle
from .air_atlas import SceneAtlas

# Bounded in-place turn toward a reached target so the camera and the next leg start facing it.
FACE_PULSES = 3
# A close-in pulse is checked this many map units beyond its predicted end point.
CLOSE_IN_MARGIN = .5
# Mirrors WorldLayout.footprint()/constrain() radius: the map denies poses closer than this to a footprint.
ROBOT_FOOTPRINT_RADIUS = .4
# A planner waypoint this close to the robot means "you are inside the standoff ring" (approachWaypoint returns start).
PLANNER_HERE_UNITS = .25
# Mirrors approach.ts CLEARANCE: straight planner lanes need this much room, so a discrete step must end with it.
LANE_CLEARANCE = 1.2
# A forward pulse is shortened so heading error x distance cannot carry the robot more than this off the lane.
LATERAL_TOLERANCE = .6


def _ray_polygon_entry(start, end, polygon):
    """Distance along start→end (planar x,z) to the first crossing of the polygon boundary, or None."""
    (x0,z0),(x1,z1)=start,end; dx,dz=x1-x0,z1-z0; length=math.hypot(dx,dz)
    if length==0:
        return None
    best=None
    for i in range(len(polygon)):
        (ax,az),(bx,bz)=polygon[i],polygon[(i+1)%len(polygon)]
        ex,ez=bx-ax,bz-az; denominator=dx*ez-dz*ex
        if abs(denominator)<1e-12:
            continue
        t=((ax-x0)*ez-(az-z0)*ex)/denominator; u=((ax-x0)*dz-(az-z0)*dx)/denominator
        if 0<=t<=1 and 0<=u<=1:
            best=t if best is None else min(best,t)
    return None if best is None else best*length


def _point_segment_distance(point, a, b):
    (px,pz),(ax,az),(bx,bz)=point,a,b; dx,dz=bx-ax,bz-az; den=dx*dx+dz*dz or 1e-12
    t=max(0.,min(1.,((px-ax)*dx+(pz-az)*dz)/den))
    return math.hypot(px-ax-t*dx,pz-az-t*dz)


def _segment_polygon_clearance(start, end, polygon):
    """Minimum planar distance between the segment start→end and the polygon boundary; 0 when crossing or inside."""
    if _ray_polygon_entry(start,end,polygon) is not None or _point_in_polygon(start,polygon) or _point_in_polygon(end,polygon):
        return 0.
    best=math.inf
    for i in range(len(polygon)):
        a,b=polygon[i],polygon[(i+1)%len(polygon)]
        best=min(best,_point_segment_distance(start,a,b),_point_segment_distance(end,a,b),
                 _point_segment_distance(a,start,end),_point_segment_distance(b,start,end))
    return best


def _point_polygon_clearance(point, polygon):
    if _point_in_polygon(point,polygon):
        return 0.
    return min(_point_segment_distance(point,polygon[i],polygon[(i+1)%len(polygon)]) for i in range(len(polygon)))


def _point_traversable(point, regions, obstacles):
    """Mirror of WorldLayout.sample(): the region under the point decides (doorway beats building beats
    the last matching region); no region, or a building without a doorway, or an obstacle footprint → denied."""
    matching=[r for r in regions if _point_in_polygon(point,r['polygon'])]
    if not matching:
        return False
    portal=any(r.get('kind')=='doorway' for r in matching)
    building=any(r.get('kind')=='building' for r in matching)
    if building and not portal:
        return False
    return not any(_point_in_polygon(point,o['polygon']) for o in obstacles)


def _footprint_traversable(point, regions, obstacles, radius=ROBOT_FOOTPRINT_RADIUS):
    """Mirror of WorldLayout.footprint(): centre plus twelve samples on the footprint circle."""
    if not _point_traversable(point,regions,obstacles):
        return False
    return all(_point_traversable((point[0]+math.cos(i*math.pi/6)*radius,point[1]+math.sin(i*math.pi/6)*radius),regions,obstacles)
               for i in range(12))


# Swept footprint spacing: discs of radius 0.4 every 0.35 units overlap, so no thin boundary can be tunnelled.
SWEEP_INTERVAL = .35
# A residual smaller than this fraction of one physical step is arrival: the robot cannot take a shorter
# step, and a full step would overshoot by more than it closes (0.4 x 3 units = 3 cm physical at scale 40).
ARRIVAL_STEP_FRACTION = .4


def _swept_path_traversable(start, end, regions, obstacles):
    """Mirror of WorldLayout.constrain(): every footprint along start→end must be traversable."""
    length=math.hypot(end[0]-start[0],end[1]-start[1]); steps=max(1,math.ceil(length/SWEEP_INTERVAL))
    return all(_footprint_traversable((start[0]+(end[0]-start[0])*i/steps,start[1]+(end[1]-start[1])*i/steps),regions,obstacles)
               for i in range(1,steps+1))


def _step_is_clear(start, heading, step_units, obstacles, regions, end_clearance=LANE_CLEARANCE):
    """One physical step from `start` along `heading` (map yaw convention: +X forward, +yaw toward -Z).

    Path: keeps the map's own pose rule (ROBOT_FOOTPRINT_RADIUS, WorldLayout.footprint/constrain) from every
    footprint over the step plus CLOSE_IN_MARGIN, and every swept footprint stays on traversable layout
    (regions: doorway > building > terrain/walkway; NO_ENTRY building shells and unregistered areas deny).
    End: keeps `end_clearance` (default LANE_CLEARANCE, the planner's straight-lane constant) from every
    footprint so the continuous planner can resume from where the discrete robot stops. A step that is
    legal but parks the robot against a footprint is rejected."""
    ux,uz=math.cos(heading),-math.sin(heading)
    end=(start[0]+ux*step_units,start[1]+uz*step_units)
    reach=(start[0]+ux*(step_units+CLOSE_IN_MARGIN),start[1]+uz*(step_units+CLOSE_IN_MARGIN))
    for o in obstacles:
        if _segment_polygon_clearance(start,reach,o['polygon'])<ROBOT_FOOTPRINT_RADIUS+.05:
            return False
        if _point_polygon_clearance(end,o['polygon'])<end_clearance:
            return False
    if not regions:
        return True  # no layout published: nothing to mirror
    return _footprint_traversable(reach,regions,obstacles) and _swept_path_traversable(start,reach,regions,obstacles)


def _layout_geometry(obs):
    layout=obs.get('layout') or {}
    return (layout.get('obstacles') or []),(layout.get('regions') or [])


def _driveable(start, heading, actual_yaw, step_units, obstacles, regions, heading_tolerance, end_clearance=LANE_CLEARANCE):
    """A candidate heading is usable only if the step is clear across the whole heading band the robot may
    actually drive it at: the forward pulse is issued once |heading - yaw| <= tolerance, so the true drive
    heading can be anywhere in [heading - tol, heading + tol]. Rehearsal: a step validated at 0.46 rad but
    driven at the tolerated 0.66 rad clipped H01's corner; checking only the current yaw made the choice
    flip between two candidates on alternate turn pulses."""
    rays=[heading+k*heading_tolerance/2 for k in (-2,-1,0,1,2)] if heading_tolerance>0 else [heading]
    if abs(angle(heading-actual_yaw))<=heading_tolerance:
        rays.append(actual_yaw)
    return all(_step_is_clear(start,ray,step_units,obstacles,regions,end_clearance) for ray in rays)


def _discrete_step_toward(obs, pose, goal, target, step_units, heading_tolerance=0., progress_toward=None):
    """Heading for one physical step that is drivable (see _driveable), makes progress toward
    `progress_toward` (default `target`; pass `goal` for an intermediate path node, whose whole point is
    that the route bends away from the target first) and deviates least from the direction to `goal`
    (the planner waypoint). None when no such step exists."""
    obstacles,regions=_layout_geometry(obs)
    px,pz=pose['x'],pose['z']; base=math.atan2(-(goal[1]-pz),goal[0]-px)
    ref=progress_toward or target
    before=math.hypot(ref[0]-px,ref[1]-pz)
    for offset in (0,10,-10,20,-20,30,-30,45,-45,60,-60,75,-75,90,-90):
        heading=base+math.radians(offset); ux,uz=math.cos(heading),-math.sin(heading)
        end=(px+ux*step_units,pz+uz*step_units)
        if math.hypot(ref[0]-end[0],ref[1]-end[1])>=before:
            continue
        if _driveable((px,pz),heading,pose['yaw'],step_units,obstacles,regions,heading_tolerance):
            return {'heading':heading,'offset_deg':offset,'end':end}
    return None


def _point_in_polygon(point, polygon):
    x,z=point; inside=False
    for i in range(len(polygon)):
        (ax,az),(bx,bz)=polygon[i],polygon[(i+1)%len(polygon)]
        if (az>z)!=(bz>z) and x<(bx-ax)*(z-az)/((bz-az) or 1e-12)+ax:
            inside=not inside
    return inside


class AirDemo:
    def __init__(self, mode, map_url, output):
        if mode not in ('replay','live'):
            raise GateError('Explicit immutable replay/live process mode required')
        self.mode = mode
        self.map = MapClient(map_url)
        self.output = Path(output); self.output.mkdir(parents=True, exist_ok=True)
        self._atlas = None
        self.atlas_error = None
        self.traverse_progress = None
        self.backend = None
        self.sample = None
        self.alignment = None
        self.session = None
        self.run_id = None
        self.waypoint = None
        self.feedback_at = 0.
        self.feedback_sequence = -1
        self.feedback_error = None
        self.feedback_enabled = False
        self.pending_fault = None
        self.report = None
        self.mission_thread = None
        self.stop_event = threading.Event()
        self.closed = threading.Event()
        self.sample_lock = threading.Lock()
        self.control_lock = threading.RLock()
        self.capability = BoundedCapability(self)
        self.feedback_thread = threading.Thread(target=self._feedback, daemon=True, name='measured-odometry-to-map')
        self.feedback_thread.start()
        if mode == 'replay':
            from .air_replay import ReplayRobot
            self.backend = ReplayRobot(self.receive)

    def receive(self,x,y,z,yaw,sequence,received,timestamp,source):
        expected = 'replay' if self.mode == 'replay' else 'physical_odometry'
        if source != expected or not all(math.isfinite(v) for v in (x,y,z,yaw,received,timestamp)):
            self.pending_fault = 'telemetry_source_or_value_invalid'; return
        with self.sample_lock:
            if self.sample and sequence <= self.sample.sequence:
                return
            self.sample = Sample(x,y,z,yaw,sequence,received,timestamp,source)

    def fresh_sample(self):
        with self.sample_lock:
            s = self.sample
        if not s or time.monotonic()-s.received > BoundedCapability.STALE_SECONDS:
            raise GateError('measured_telemetry_stale')
        if self.pending_fault:
            raise GateError(self.pending_fault)
        return s

    def feedback_valid(self):
        # This is read by the STOP watchdog. Never wait on map HTTP's lock here.
        return bool(self.feedback_enabled and not self.feedback_error and self.alignment and
                    time.monotonic()-self.feedback_at < BoundedCapability.STALE_SECONDS+.25)

    def _validate(self, obs, require_armed=False):
        if not obs['map_ready'] or obs['scene_session_id'] != self.session:
            raise GateError('map_not_ready_or_scene_changed')
        performance = obs.get('performance') or {}
        if not performance.get('visible') or performance.get('render_age_ms') is None or performance['render_age_ms'] > 750:
            raise GateError('presentation_tab_hidden_or_render_stale')
        mission = obs['mission_state']
        if mission['run_id'] != self.run_id or mission['phase'] == 'HELD':
            raise GateError('mission_replaced_or_held')
        if require_armed and not mission['map_armed']:
            raise GateError('map_disarmed')
        if ((obs.get('layout') or {}).get('robotState') or {}).get('physicalHold'):
            raise GateError('map_physical_hold')

    def _feedback(self):
        # 20 ms poll: pose feedback then runs at the map round-trip rate (~15-25 Hz)
        # instead of ~10 Hz, so each avatar update is a smaller step.
        while not self.closed.wait(.02):
            if not self.feedback_enabled or not self.alignment:
                continue
            try:
                s = self.fresh_sample()
                if s.sequence <= self.feedback_sequence:
                    continue
                with self.map.lock:
                    self._validate(self.map.current())
                    position,yaw = self.alignment.map(s)
                    joints = self.backend.fresh_joints() if self.mode=='live' and self.backend else None
                    result = self.map.post('telemetry',connected=True,source=s.source,frame='three_world',
                        position=position,yaw=yaw,sample_sequence=s.sequence,timestamp_ms=s.timestamp*1000,
                        **({'joint_angles':joints} if joints else {}))
                    obs = result['observation']; self._validate(obs)
                    actual = obs['robot_pose']
                    if actual['source'] != s.source or math.hypot(actual['x']-position['x'],actual['z']-position['z']) > .025 or abs(angle(actual['yaw']-yaw)) > .02:
                        raise GateError('measured_pose_roundtrip_mismatch')
                    self.feedback_sequence = s.sequence
                    self.feedback_at = time.monotonic()
            except Exception as error:
                self.feedback_error = str(error)
                self.feedback_enabled = False
                self.capability.stop(f'map_feedback: {error}')
                self.stop_event.set()
                # Do not auto-resume after a map/session/freshness fault.

    def connect(self, ip, sole_controller_confirmed=False, telemetry_only=False, posture_only=False):
        with self.control_lock:
            if self.mode != 'live':
                raise GateError('Replay process has no live transport access')
            if not sole_controller_confirmed:
                raise GateError('Confirm this Air is the sole physical controller first')
            if telemetry_only and posture_only:
                raise GateError('Choose one restricted connection mode')
            if (self.output.parent/'hardware-hold.json').exists() and not (telemetry_only or posture_only):
                raise GateError('operator_recovery_required: hardware-hold.json blocks live reconnection')
            if self.backend:
                raise GateError('Disconnect existing local controller first')
            address = ipaddress.ip_address(ip)
            if not address.is_private or address.is_loopback or address.version != 4:
                raise GateError('A freshly discovered private Go2 IPv4 is required')
            from .air_live import LiveRobot  # Never imported in the replay process.
            self.backend = LiveRobot(str(address),self.receive,self._fault,os.getenv('UNITREE_AES_128_KEY'),telemetry_only=telemetry_only,posture_only=posture_only)
            return self.status()

    def _fault(self, reason):
        # The first fault invalidates queued motion and sends priority STOP.
        # Subsequent delayed packets must not flood the robot with more STOP
        # requests while this latched fault already prevents re-arming.
        if self.pending_fault is not None:
            return
        self.pending_fault = reason
        self.capability.stop(reason)
        self.stop_event.set()

    def _await_feedback(self, sequence=-1, timeout=3.):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            if self.feedback_error:
                raise GateError(self.feedback_error)
            if self.feedback_valid() and self.feedback_sequence > sequence:
                return self.map.current()
            time.sleep(.025)
        raise GateError('measured_map_feedback_timeout')

    def calibrate(self, scale=40., virtual_heading=None, face_waypoint=False):
        with self.control_lock:
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('Stop mission before calibration')
            if self.capability.armed:
                raise GateError('Disarm before calibration')
            if not math.isfinite(scale) or not 1 <= scale <= 40:
                raise GateError('Physical-to-virtual scale must be 1..40')
            self.feedback_enabled = False
            self.pending_fault = None
            s = self.fresh_sample()
            obs = self.map.read()
            if not obs['map_ready'] or not obs['robot_pose']:
                raise GateError('Current scene is not ready')
            if obs['mission_state']['run_id']:
                raise GateError('Reset the prior mission before fresh calibration')
            pose = obs['robot_pose']
            heading = pose['yaw'] if virtual_heading is None else float(virtual_heading)
            if not math.isfinite(heading):
                raise GateError('Finite virtual heading required')
            self.alignment = Alignment(s,pose['x'],pose['y'],pose['z'],heading,scale)
            result = self.map.post('mission',op='start',target_id='rover-1',mode='replay' if self.mode=='replay' else 'telemetry')
            self.session = result['observation']['scene_session_id']
            self.run_id = result['observation']['mission_state']['run_id']
            # Resolve the current map path while disarmed, before freshness-critical execution.
            self.waypoint = self.map.post('mission',op='approach').get('navigation')
            if face_waypoint and self.waypoint:
                # Map the robot's current physical heading onto the approach bearing so the
                # mission starts with a straight walk instead of a long in-place turn (turn drift
                # at scale 40 is what walked the map avatar into a staged footprint).
                heading = math.atan2(-(self.waypoint['z']-pose['z']), self.waypoint['x']-pose['x'])
                self.alignment = Alignment(s,pose['x'],pose['y'],pose['z'],heading,scale)
            self.feedback_error = None; self.feedback_sequence = -1; self.feedback_at = 0.
            self.feedback_enabled = True
            self._await_feedback()
            # Boot-time recognition: load the scene atlas now that the map is up, so legs,
            # mobile-asset rules and pitfalls are known before anything moves. Advisory only.
            self.atlas(reload=True, strict=False)
            return self.status()

    def atlas(self, reload=False, strict=True):
        """The generated scene atlas (public/scene-atlas.json), loaded from the running map or the repo."""
        if self._atlas is None or reload:
            try:
                self._atlas = SceneAtlas.load(self.map.base)
                self.atlas_error = None
            except Exception as error:
                self.atlas_error = str(error)
                if strict:
                    raise GateError(f'scene_atlas_unavailable: {error}')
        return self._atlas

    def atlas_summary(self, scene='SCENE_1'):
        return self.atlas().summary(scene)

    def scene_drift(self):
        """Live scene versus atlas: re-staged mobile assets, drifted static ones, missing/unexpected ids."""
        atlas = self.atlas()
        with self.map.lock:
            obs = self.map.read()
        result = atlas.compare(obs)
        (self.output.parent/'scene-drift.json').write_text(json.dumps(result,indent=2)+'\n')
        return result

    def arm(self, clear_lane=False, robot_standing=False, recover=False, skip_box_check=False):
        with self.control_lock:
            hold=self.output.parent/'hardware-hold.json'
            recovery=self.mode=='live' and recover and self.backend is not None and not getattr(self.backend,'telemetry_only',False) and (getattr(self.backend,'posture_only',False) or hold.exists())
            if self.mode == 'live' and (getattr(self.backend,'telemetry_only',False) or ((getattr(self.backend,'posture_only',False) or hold.exists()) and not recovery)):
                raise GateError('Physical execution held; telemetry-only connection cannot arm')
            if self.mode == 'live' and not (clear_lane and robot_standing):
                raise GateError('Operator must confirm clear lane and standing robot')
            self.fresh_sample()
            faults=self.backend.blocking_errors() if self.backend and hasattr(self.backend,'blocking_errors') else []
            if faults:
                raise GateError('robot_hardware_fault: '+'; '.join(f"{e['label']} {e['description']}" for e in faults))
            if not self.backend or not self.backend.ready() or not self.feedback_valid():
                raise GateError('Fresh controller/odometry/calibration/roundtrip required')
            if self.mode == 'live':
                if skip_box_check:
                    self.backend.sensors.manual_check_required=False
                self.backend.check_avoidance()
                self.backend.require_clear()
            with self.map.lock:
                obs = self.map.read(); self._validate(obs)
                self.map.post('mission',op='arm')
            self._await_feedback(self.feedback_sequence)
            try:
                if self.mode=='live':
                    self.backend.begin_avoidance_monitor()
                if recovery:
                    self.backend.posture_only=False
                self.capability.arm()
                if recovery and hold.exists():
                    record={'recovered_at':time.time(),'sensor_check':self.backend.sensors.status(),
                            'standing_measured':self.backend.ready(),'map_feedback_valid':self.feedback_valid(),
                            'prior_hold':json.loads(hold.read_text())}
                    (self.output.parent/'hardware-recovery.json').write_text(json.dumps(record,indent=2)+'\n')
                    hold.rename(self.output.parent/f'hardware-hold-resolved-{time.time_ns()}.json')
            except Exception:
                if recovery:self.backend.posture_only=True
                self.stop('arming_failed');raise
            self.stop_event.clear()
            return self.status()

    def stop(self, reason='operator_stop'):
        self.stop_event.set()
        self.capability.stop(reason)  # First, before any potentially blocking map I/O.
        if self.mode=='live' and self.backend:
            self.backend.end_avoidance_monitor()
        if self.mission_thread and self.mission_thread is not threading.current_thread():
            self.mission_thread.join(timeout=2.)
        self.feedback_enabled = False
        try:
            with self.map.lock:
                self.map.read()
                if self.map.current()['mission_state']['run_id']:
                    self.map.post('mission',op='hold')
        except Exception:
            pass
        return self.status()

    def reset(self):
        with self.control_lock:
            self.stop('demo_reset')
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('Mission still exiting; reset withheld')
            with self.map.lock:
                obs = self.map.read()
                if obs['mission_state']['run_id'] and obs['mission_state']['mode'] in ('telemetry','replay'):
                    self.map.post('telemetry',connected=False,source='replay' if self.mode=='replay' else 'physical_odometry')
                try:
                    result = self.map.post('reset',scope='demo')
                except GateError as error:
                    # The page may still be loading its robot model right after a reload; one retry.
                    if 'demo_spawn_unavailable' not in str(error):
                        raise
                    time.sleep(.75)
                    result = self.map.post('reset',scope='demo')
            self.alignment = None; self.session = None; self.run_id = None
            self.feedback_error = None; self.pending_fault = None
            self.report = None
            self._set_traverse_progress(None)
            return {'ok':True,'observation':result['observation'],'physical_calibration':'cleared_requires_fresh_origin'}

    def status(self):
        s = self.sample
        return {'mode':self.mode,'physical_execution_available':self.mode=='live' and self.backend is not None and not getattr(self.backend,'telemetry_only',False) and not getattr(self.backend,'posture_only',False) and not (self.output.parent/'hardware-hold.json').exists(),
                'posture_only':bool(getattr(self.backend,'posture_only',False)),
                'telemetry_only':bool(getattr(self.backend,'telemetry_only',False)),
                'hardware_hold':(self.output.parent/'hardware-hold.json').exists(),
                'controller_ready': bool(self.backend and self.backend.ready()),'armed':self.capability.armed,
                'calibrated':self.alignment is not None,'scale':self.alignment.scale if self.alignment else None,
                'raw_odometry':asdict(s) if s else None,'feedback_valid':self.feedback_valid(),
                'feedback_error':self.feedback_error,'source_fault':self.pending_fault,'stop_reason':self.capability.stop_reason,
                'running':bool(self.mission_thread and self.mission_thread.is_alive()),
                'actions':self.capability.actions,'physical_travel_m':self.capability.travel,
                'physical_yaw_travel_rad':self.capability.yaw_travel,'report':self.report,
                'odometry_timing':dict(self.backend.odometry_timing) if self.mode=='live' and self.backend and hasattr(self.backend,'odometry_timing') else None,
                'controller_mode':getattr(self.backend,'controller_mode',None) if self.mode=='live' and self.backend else None,
                'body_height_m':(self.backend.sport_state or {}).get('body_height') if self.mode=='live' and self.backend and hasattr(self.backend,'sport_state') else None,
                'robot_errors':self.backend.error_status() if self.mode=='live' and self.backend and hasattr(self.backend,'error_status') else None,
                'physical_sensors':self.backend.sensors.status() if self.mode=='live' and self.backend else None,
                'atlas':{'loaded':self._atlas is not None,'source':self._atlas.source if self._atlas else None,
                         'generated_at':self._atlas.generated_at if self._atlas else None,
                         'runnable_scenes':self._atlas.runnable_scenes() if self._atlas else None,'error':self.atlas_error},
                'traverse':self.traverse_progress}

    def sensor_check(self, stage):
        if self.mode != 'live' or not self.backend:
            raise GateError('Stationary sensor check requires a live sensor connection')
        if self.capability.armed:
            raise GateError('Disarm before the stationary sensor check')
        return self.backend.sensors.check(stage)

    def enable_sensing(self):
        with self.control_lock:
            if self.mode != 'live' or not self.backend or self.capability.armed:
                raise GateError('Sensor setup requires an unarmed live connection')
            return self.backend.enable_sensing()

    def diagnose_sensors(self):
        with self.control_lock:
            if self.mode != 'live' or not self.backend or self.capability.armed:
                raise GateError('Sensor diagnostics require an unarmed live connection')
            result = self.backend.diagnose_sensors()
            (self.output.parent/'sensor-diagnostics.json').write_text(json.dumps(result,indent=2)+'\n')
            return result

    def enable_lidar(self):
        with self.control_lock:
            if self.mode != 'live' or not self.backend or self.capability.armed:
                raise GateError('LiDAR stream enable requires an unarmed live connection')
            return self.backend.enable_lidar()

    def check_avoidance(self):
        with self.control_lock:
            if self.mode != 'live' or not self.backend or self.capability.armed:
                raise GateError('Avoidance status check requires an unarmed live connection')
            result=self.backend.check_avoidance()
            (self.output.parent/'avoidance-status-check.json').write_text(json.dumps(result,indent=2)+'\n')
            return result

    def stand_in_place(self, clear_area=False):
        with self.control_lock:
            if self.mode!='live' or not self.backend or self.capability.armed or not clear_area:
                raise GateError('Standing preparation requires live unarmed connection and operator clear area')
            self.fresh_sample()
            record={'requested_at':time.time(),'raw_odometry':asdict(self.sample),'walking_enabled':False}
            path=self.output.parent/'stand-preparation.json'
            path.write_text(json.dumps(record,indent=2)+'\n')
            try:
                result=self.backend.stand_in_place()
                record['result']=result
                return result
            except Exception as error:
                record['error']=str(error);raise
            finally:
                path.write_text(json.dumps(record,indent=2)+'\n')

    def stand_down(self, clear_area=False):
        """Posture only: lower a standing robot so hot hip motors can cool."""
        with self.control_lock:
            if self.mode!='live' or not self.backend or self.capability.armed or not clear_area:
                raise GateError('Stand-down requires live unarmed connection and operator clear area')
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('Stop the mission before stand-down')
            record={'requested_at':time.time(),'raw_odometry':asdict(self.sample) if self.sample else None}
            path=self.output.parent/'stand-down.json'
            try:
                record['result']=self.backend.stand_down()
                return record['result']
            except Exception as error:
                record['error']=str(error);raise
            finally:
                path.write_text(json.dumps(record,indent=2)+'\n')

    def present(self, instruction):
        if instruction.strip().lower().rstrip('.') != MISSION.lower().rstrip('.'):
            raise GateError('This bounded demo accepts only the excavator presentation mission')
        with self.control_lock:
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('A mission is already running')
            if not self.capability.armed:
                raise GateError('Explicit arm required')
            self.stop_event.clear()
            self.mission_thread = threading.Thread(target=self._run,daemon=True,name='dimos-excavator-mission')
            self.mission_thread.start()
            return {'accepted':True,'instruction':MISSION,'mode':self.mode}

    def navigate(self, target_id, max_steps=4):
        """Bounded approach toward any map asset or layout region; stops after max_steps pulses."""
        target_id=str(target_id or '').strip()
        if not target_id or not 1 <= int(max_steps) <= 12:
            raise GateError('navigate requires a target id and 1..12 steps')
        with self.control_lock:
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('A mission is already running')
            if not self.capability.armed:
                raise GateError('Explicit arm required')
            self.stop_event.clear()
            self.mission_thread=threading.Thread(target=self._navigate,args=(target_id,int(max_steps)),daemon=True,name='dimos-navigate')
            self.mission_thread.start()
            return {'accepted':True,'target_id':target_id,'max_steps':int(max_steps),'mode':self.mode}

    def _target_geometry(self, obs, target_id):
        """Planar distance (scene m) and bearing (rad) from the robot to an entity or region centroid."""
        pose=obs['robot_pose']
        entity=next((e for e in obs['entities'] if e['id']==target_id or e.get('scene_object_id')==target_id),None)
        if entity:
            return {'kind':'entity','type':entity.get('type'),'distance':entity['distance_from_robot'],'bearing':entity['bearing'],
                    'position':entity['world_position']}
        region=next((r for r in ((obs.get('layout') or {}).get('regions') or []) if r['id']==target_id),None)
        if not region:
            raise GateError(f'unknown_target: {target_id}')
        poly=region['polygon']; cx=sum(p[0] for p in poly)/len(poly); cz=sum(p[1] for p in poly)/len(poly)
        return {'kind':'region','type':region.get('kind'),'label':region.get('label'),
                'distance':math.hypot(cx-pose['x'],cz-pose['z']),'bearing':angle(math.atan2(-(cz-pose['z']),cx-pose['x'])-pose['yaw']),
                'position':{'x':cx,'y':pose['y'],'z':cz}}

    def _face(self, target_id, events, max_pulses=FACE_PULSES):
        """Bounded in-place yaw pulses until the target is within HEADING_TOLERANCE (or pulses run out)."""
        pulses=0
        while True:
            obs=self._await_feedback(self.feedback_sequence); self._validate(obs,True)
            geometry=self._target_geometry(obs,target_id); bearing=geometry['bearing']
            if abs(bearing)<=self.capability.HEADING_TOLERANCE or pulses>=max_pulses:
                return {'faced':abs(bearing)<=self.capability.HEADING_TOLERANCE,'pulses':pulses,'bearing_rad':bearing}
            yaw=math.copysign(self.capability.MAX_YAW,bearing)
            duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,abs(bearing)/self.capability.MAX_YAW))
            budget=self._envelope_budget(0.,yaw,duration)
            if budget:
                return {'faced':False,'pulses':pulses,'bearing_rad':bearing,'envelope_budget_exhausted':budget}
            events.append({'step':f'face-{pulses+1}','target':geometry,'forward':0.,'yaw':yaw,'duration':duration,
                'robot_pose':obs['robot_pose'],'raw_odometry':asdict(self.fresh_sample()),'timestamp':time.time()})
            s=self.fresh_sample()
            self.capability.pulse(0.,yaw,duration)  # LiDAR turn-halo veto raises here.
            pulses+=1
            if self.stop_event.wait(duration+.05):
                raise GateError('stopped')
            self.capability.stop('pulse_complete',disarm=False)
            newer=self.fresh_sample()
            self._await_feedback(newer.sequence-1)
            if abs(angle(newer.yaw-s.yaw))>abs(yaw)*duration*1.5+.25:
                raise GateError('measured_action_envelope')

    def _discrete_step_heading(self, obs, pose, centre, radius, step_units):
        """Pick the heading for ONE physical step of `step_units` that ends inside the target's ring,
        crosses no footprint (plus CLOSE_IN_MARGIN) and stays on traversable layout. Mirrors the map
        planner's offset-candidate search, but for a step whose length is fixed by MIN_PULSE."""
        obstacles,regions=_layout_geometry(obs)
        px,pz=pose['x'],pose['z']; base=math.atan2(-(centre['z']-pz),centre['x']-px)
        for offset in (0,10,-10,20,-20,30,-30,45,-45,60,-60,75,-75,90,-90):
            heading=base+math.radians(offset); ux,uz=math.cos(heading),-math.sin(heading)
            end=(px+ux*step_units,pz+uz*step_units)
            if math.hypot(end[0]-centre['x'],end[1]-centre['z'])>radius-.15:
                continue
            if not _driveable((px,pz),heading,pose['yaw'],step_units,obstacles,regions,self.capability.HEADING_TOLERANCE):
                continue
            return {'heading':heading,'offset_deg':offset,'end':end}
        return None

    def _close_in(self, target_id, events, max_pulses=3, max_turn_pulses=None):
        """After a discrete 'arrived', step inside an entity's interaction ring when the residual to the
        planner's ring waypoint was smaller than one physical step (MIN_PULSE at the current scale).

        The step heading comes from a bounded candidate search checked against every footprint in the
        layout and the traversable regions (the map's own pose rule); live, each pulse additionally
        passes the LiDAR veto and the measured envelope. Refuses rather than guesses.

        Budgets: `max_pulses` forward steps, plus enough in-place turn pulses for a half turn (the only
        band-clear candidate past H01 sits ~70 deg off the excavator bearing; three shared pulses ran out
        mid-turn in rehearsal and the excavator stayed 0.2 units outside its ring)."""
        if max_turn_pulses is None:
            max_turn_pulses=math.ceil(math.pi/(self.capability.MAX_YAW*self.capability.MAX_PULSE*.8))+1
        pulses=0; turns=0; result={'needed':False,'pulses':0,'turn_pulses':0}
        while pulses<max_pulses and turns<max_turn_pulses:
            obs=self._await_feedback(self.feedback_sequence); self._validate(obs,True)
            entity=next((e for e in obs['entities'] if e['id']==target_id or e.get('scene_object_id')==target_id),None)
            radius=(entity or {}).get('interaction_radius')
            if not entity or not isinstance(radius,(int,float)):
                return result
            distance=entity['distance_from_robot']
            result.update({'distance_units':distance,'interaction_radius':radius})
            if distance<=radius-.15:
                result['inside_ring']=True; return result
            result['needed']=True
            pose=obs['robot_pose']; centre=entity['world_position']
            forward=self.capability.MAX_FORWARD; per_unit=forward*self.alignment.scale
            duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,(distance-(radius-.45))/per_unit))
            step_units=duration*per_unit
            choice=self._discrete_step_heading(obs,pose,centre,radius,step_units)
            result.update({'step_units':step_units,'candidate':choice})
            if not choice:
                result['blocked_by']='no_footprint_free_step_into_ring'; return result
            bearing=angle(choice['heading']-pose['yaw'])
            s=self.fresh_sample(); yaw=0.; forward_cmd=0.
            turning=abs(bearing)>self.capability.HEADING_TOLERANCE
            budget=self._envelope_budget(0. if turning else forward,math.copysign(self.capability.MAX_YAW,bearing) if turning else 0.,
                min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,abs(bearing)/self.capability.MAX_YAW)) if turning else duration)
            if budget:
                result['envelope_budget_exhausted']=budget; return result
            if turning:
                yaw=math.copysign(self.capability.MAX_YAW,bearing)
                duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,abs(bearing)/self.capability.MAX_YAW))
                events.append({'step':f'close-in-turn-{turns+1}','candidate':choice,'bearing':bearing,'forward':0.,'yaw':yaw,'duration':duration,
                    'robot_pose':pose,'raw_odometry':asdict(s),'timestamp':time.time()})
                self.capability.pulse(0.,yaw,duration)  # LiDAR turn-halo veto raises here.
                turns+=1; result['turn_pulses']=turns
            else:
                forward_cmd=forward
                events.append({'step':f'close-in-{pulses+1}','candidate':choice,'target':{'distance':distance,'bearing':entity['bearing'],'interaction_radius':radius},
                    'forward':forward,'yaw':0.,'duration':duration,'step_units':step_units,'robot_pose':pose,'raw_odometry':asdict(s),'timestamp':time.time()})
                self.capability.pulse(forward,0.,duration)  # LiDAR corridor veto raises here if the real room is blocked.
                pulses+=1; result['pulses']=pulses
            if self.stop_event.wait(duration+.05):
                raise GateError('stopped')
            self.capability.stop('pulse_complete',disarm=False)
            newer=self.fresh_sample()
            self._await_feedback(newer.sequence-1)
            if math.hypot(newer.x-s.x,newer.y-s.y)>forward_cmd*duration*1.5+.10 or abs(angle(newer.yaw-s.yaw))>abs(yaw)*duration*1.5+.25:
                raise GateError('measured_action_envelope')
        obs=self._await_feedback(); entity=next((e for e in obs['entities'] if e['id']==target_id or e.get('scene_object_id')==target_id),None)
        if entity:
            result['distance_units']=entity['distance_from_robot']; result['inside_ring']=entity['distance_from_robot']<=entity.get('interaction_radius',math.inf)
        return result

    def _envelope_budget(self, forward, yaw, duration, pose_units=None):
        """Would this pulse spend more of the arm's physical envelope than remains? Returns the exhausted
        budget name or None. The capability's watchdog would otherwise trip `physical_envelope` mid-leg and
        report a failure; a leg that merely needs another arm is resumable (progress keeps it unfinished).
        Margins: one MIN_PULSE of motion, 2 s of run time."""
        cap=self.capability; s=self.fresh_sample()
        if forward:
            metres=forward*duration
            if cap.travel+metres>cap.MAX_TRAVEL-cap.MIN_PULSE*cap.MAX_FORWARD:
                return 'travel'
            if cap.origin is not None:
                ux,uy=math.cos(s.yaw),math.sin(s.yaw)
                if math.hypot(s.x+ux*metres-cap.origin.x,s.y+uy*metres-cap.origin.y)>cap.MAX_RADIUS-cap.MIN_PULSE*cap.MAX_FORWARD:
                    return 'radius'
        if yaw and cap.yaw_travel+abs(yaw)*duration>cap.MAX_YAW_TRAVEL-cap.MIN_PULSE*cap.MAX_YAW:
            return 'yaw_travel'
        if cap.armed_at and time.monotonic()-cap.armed_at+duration>cap.MAX_RUN_SECONDS-2.:
            return 'run_seconds'
        return None

    def _navigate(self, target_id, max_steps, face_target=False, close_in=False):
        """`max_steps` bounds forward pulses; in-place turn pulses have their own budget sized from the arm's
        MAX_YAW_TRAVEL (an about-face is ~8 pulses at MAX_YAW x MAX_PULSE and used to eat most of a 12-step
        budget). Every pulse still passes the capability envelope, the LiDAR veto (live) and the map's rule."""
        started=time.monotonic(); events=[]; stopped_by=None; arrival_kind=None; success=False; face=None; closed_in=None
        turn_pulses=0; max_turn_pulses=math.ceil(self.capability.MAX_YAW_TRAVEL/(self.capability.MAX_YAW*self.capability.MAX_PULSE*.8))
        budget=None
        try:
            start_obs=self._await_feedback(); self._validate(start_obs,True)
            initial=self._target_geometry(start_obs,target_id)
            self.map.post('mission',op='target',target_id=target_id)
            self._await_feedback(self.feedback_sequence)
            waypoint=self.map.post('mission',op='approach',target_id=target_id).get('navigation')
            self._await_feedback(self.feedback_sequence)
            reached=self.capability.MIN_PULSE*self.capability.MAX_FORWARD*self.alignment.scale*.75
            steps=0
            while not self.stop_event.is_set():
                if steps>=max_steps:
                    stopped_by='step_limit'; success=True; break
                if turn_pulses>=max_turn_pulses:
                    stopped_by='turn_limit'; success=True; break
                self._await_feedback(self.feedback_sequence)
                with self.map.lock:
                    obs=self.map.current(); self._validate(obs,True)
                    pose=obs['robot_pose']
                    if not waypoint or math.hypot(waypoint['x']-pose['x'],waypoint['z']-pose['z'])<reached:
                        result=self.map.post('mission',op='approach',target_id=target_id)
                        waypoint=result.get('navigation'); pose=result['observation']['robot_pose']
                    if not waypoint:
                        raise GateError('No path in current scene')
                    dx,dz=waypoint['x']-pose['x'],waypoint['z']-pose['z']; residual=math.hypot(dx,dz)
                    # 'goal' = a point on the standoff ring; 'path_node' = a corner of a grid-searched route
                    # (reaching it is not arrival; the route may bend away from the target first).
                    waypoint_kind=waypoint.get('kind') or 'goal'
                    if residual<PLANNER_HERE_UNITS or waypoint_kind=='here':
                        # The planner returned the robot's own position: inside the target's standoff ring.
                        stopped_by='arrived'; arrival_kind='planner_inside_ring'; success=True; break
                    if waypoint_kind=='goal' and residual<=ARRIVAL_STEP_FRACTION*self.capability.MIN_PULSE*self.capability.MAX_FORWARD*self.alignment.scale:
                        # Closer to the ring goal than the robot can step: a full step would carry it further away.
                        stopped_by='arrived'; arrival_kind='waypoint_within_step_fraction'; success=True; break
                    bearing=angle(math.atan2(-dz,dx)-pose['yaw'])
                    forward=0. if abs(bearing)>self.capability.HEADING_TOLERANCE else self.capability.MAX_FORWARD
                    yaw=math.copysign(self.capability.MAX_YAW,bearing) if not forward else 0.
                    duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,
                        abs(bearing)/self.capability.MAX_YAW if yaw else residual/(forward*self.alignment.scale)))
                    overshoot=None; choice=None; step_cap=None
                    geometry=self._target_geometry(obs,target_id)
                    unit_per_second=self.capability.MAX_FORWARD*self.alignment.scale
                    if forward and residual>=reached:
                        # Heading error x distance is the lateral miss at the end of a straight pulse
                        # (a 0.24 rad error over 7 units clipped the habitat shell in rehearsal). Cap the
                        # pulse so the miss stays inside LATERAL_TOLERANCE, never below one MIN_PULSE step.
                        lateral=abs(math.sin(bearing))
                        if lateral>1e-6 and duration*unit_per_second*lateral>LATERAL_TOLERANCE:
                            duration=max(self.capability.MIN_PULSE,LATERAL_TOLERANCE/lateral/unit_per_second)
                            step_cap='lateral_tolerance'
                        # Fail closed before the map does: the whole predicted step (start->end plus margin)
                        # must respect the map's footprint rule along the robot's actual heading. Shorten to
                        # one MIN_PULSE step first, then try a footprint-free heading toward the waypoint.
                        obstacles,regions=_layout_geometry(obs); start=(pose['x'],pose['z'])
                        if not _step_is_clear(start,pose['yaw'],duration*unit_per_second,obstacles,regions,ROBOT_FOOTPRINT_RADIUS+.05):
                            duration=self.capability.MIN_PULSE; step_cap='footprint_shortened'
                            if not _step_is_clear(start,pose['yaw'],duration*unit_per_second,obstacles,regions,ROBOT_FOOTPRINT_RADIUS+.05):
                                centre=geometry['position']; wp=(waypoint['x'],waypoint['z'])
                                choice=_discrete_step_toward(obs,pose,wp,(centre['x'],centre['z']),duration*unit_per_second,self.capability.HEADING_TOLERANCE,
                                    progress_toward=wp if waypoint_kind=='path_node' else None)
                                if not choice:
                                    raise GateError('step_blocked_by_footprint')
                                bearing=angle(choice['heading']-pose['yaw'])
                                forward=0. if abs(bearing)>self.capability.HEADING_TOLERANCE else self.capability.MAX_FORWARD
                                yaw=math.copysign(self.capability.MAX_YAW,bearing) if not forward else 0.
                                duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,abs(bearing)/self.capability.MAX_YAW)) if yaw else self.capability.MIN_PULSE
                                step_cap='footprint_detour'
                    if residual<reached:
                        # Residual smaller than one physical step (MIN_PULSE at this scale). Find the heading
                        # whose whole step is footprint-free, ends with planner clearance and still gets closer
                        # to the target; turn to it if needed, else overshoot the waypoint along it.
                        step_units=self.capability.MIN_PULSE*self.capability.MAX_FORWARD*self.alignment.scale
                        centre=geometry['position']; wp=(waypoint['x'],waypoint['z'])
                        choice=_discrete_step_toward(obs,pose,wp,(centre['x'],centre['z']),step_units,self.capability.HEADING_TOLERANCE,
                            progress_toward=wp if waypoint_kind=='path_node' else None)
                        if not choice:
                            if waypoint_kind=='path_node':
                                # Standing next to a route corner with no footprint-free step onward is not arrival.
                                raise GateError('step_blocked_by_footprint_at_path_node')
                            stopped_by='arrived'; arrival_kind='residual_below_step_blocked'; success=True; break
                        bearing=angle(choice['heading']-pose['yaw'])
                        forward=0. if abs(bearing)>self.capability.HEADING_TOLERANCE else self.capability.MAX_FORWARD
                        yaw=math.copysign(self.capability.MAX_YAW,bearing) if not forward else 0.
                        duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,abs(bearing)/self.capability.MAX_YAW)) if yaw else self.capability.MIN_PULSE
                        overshoot=round(step_units-residual,3) if forward else None
                    events.append({'step':steps+1,'waypoint':waypoint,'waypoint_kind':waypoint_kind,'waypoint_bearing':bearing,'residual_units':residual,'overshoot_units':overshoot,'sub_step':choice,'step_cap':step_cap,
                        'target':geometry,'forward':forward,'yaw':yaw,'duration':duration,'robot_pose':pose,'raw_odometry':asdict(self.fresh_sample()),
                        'physical_sensors':self.backend.sensors.status() if self.mode=='live' else None,'timestamp':time.time()})
                budget=self._envelope_budget(forward,yaw,duration)
                if budget:
                    # Resumable: the leg stays unfinished in traverse progress; the operator re-arms and re-runs it.
                    events[-1]['not_sent']=f'arm_envelope_budget:{budget}'
                    stopped_by='arm_envelope_budget'; success=True; break
                s=self.fresh_sample()
                self.capability.pulse(forward,yaw,duration)  # LiDAR corridor veto raises here if the room is blocked.
                if forward:
                    steps+=1
                else:
                    turn_pulses+=1
                if self.stop_event.wait(duration+.05):
                    raise GateError('stopped')
                self.capability.stop('pulse_complete',disarm=False)
                newer=self.fresh_sample()
                self._await_feedback(newer.sequence-1)
                if math.hypot(newer.x-s.x,newer.y-s.y)>forward*duration*1.5+.10 or abs(angle(newer.yaw-s.yaw))>abs(yaw)*duration*1.5+.25:
                    raise GateError('measured_action_envelope')
                if forward:
                    # A plan is only valid from the pose it was computed for. After the robot has moved,
                    # ask the planner again instead of steering toward a stale waypoint (a detour step
                    # followed by a turn back toward the old waypoint cost a 180° recovery in rehearsal).
                    waypoint=None
            else:
                raise GateError(self.capability.stop_reason or 'stopped')
            if face_target and stopped_by=='arrived':
                face=self._face(target_id,events)
            if close_in and stopped_by=='arrived':
                closed_in=self._close_in(target_id,events)
            final_obs=self._await_feedback()
            final=self._target_geometry(final_obs,target_id)
            self.report={'kind':'navigate','target_id':target_id,'success':success,'stopped_by':stopped_by,'arrival_kind':arrival_kind,'steps':steps,'turn_pulses':turn_pulses,
                'envelope_budget_exhausted':budget,'mode':self.mode,
                'initial':initial,'final':final,'bearing_improvement_rad':abs(initial['bearing'])-abs(final['bearing']),
                'distance_change_m':final['distance']-initial['distance'],'elapsed_seconds':time.monotonic()-started,
                'physical_travel_m':self.capability.travel,'physical_yaw_travel_rad':self.capability.yaw_travel,
                'physical_sensors':self.backend.sensors.status() if self.mode=='live' else None,'actions':events,'face':face,'close_in':closed_in,
                'final_robot_pose':final_obs['robot_pose']}
        except Exception as error:
            self.report={'kind':'navigate','target_id':target_id,'success':False,'stopped_by':str(error),'steps':sum(1 for e in events if e.get('forward')),'turn_pulses':sum(1 for e in events if e.get('yaw')),'mode':self.mode,
                'actions':events,'face':face,'close_in':closed_in,'elapsed_seconds':time.monotonic()-started,
                'physical_sensors':self.backend.sensors.status() if self.mode=='live' and self.backend else None}
        finally:
            self.capability.stop('navigate_finished')
            if self.mode=='live' and self.backend:
                self.backend.end_avoidance_monitor()
            (self.output/f"navigate-{time.time_ns()}.json").write_text(json.dumps(self.report,indent=2)+'\n')

    # ------------------------------------------------------------------ traverse
    def _set_traverse_progress(self, progress):
        self.traverse_progress=progress
        path=self.output.parent/'traverse-progress.json'
        if progress is None:
            if path.exists():
                path.unlink()
        else:
            path.write_text(json.dumps(progress,indent=2)+'\n')

    def traverse(self, scene='SCENE_1', leg=None, max_steps=4, face_target=True):
        """Run ONE pre-planned atlas leg under the current arm.

        One explicit arm covers one leg: the bounded capability's travel/radius/run-time
        envelope is per arm, and the operator re-confirms the physical lane between legs.
        Without `leg`, the next unfinished leg of the scene runs. Mobile targets are
        re-observed first; the live planner (not the atlas) decides the actual waypoints.
        """
        atlas=self.atlas()
        scene=str(scene or 'SCENE_1')
        route=atlas.route(scene)
        if not route or route.get('status')!='runnable':
            raise GateError(f'{scene}: route status {route.get("status") if route else "absent"}; only runnable scenes may be traversed')
        if not 1<=int(max_steps)<=12:
            raise GateError('traverse requires 1..12 steps per leg')
        progress=self.traverse_progress if self.traverse_progress and self.traverse_progress.get('scene')==scene else None
        index=int(leg) if leg is not None else (progress['next_leg'] if progress else 1)
        definition=atlas.leg(scene,index)
        if not definition:
            raise GateError(f'{scene} has no leg {index}; legs 1..{len(atlas.legs(scene))}')
        with self.control_lock:
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('A mission is already running')
            if not self.capability.armed:
                raise GateError('Explicit arm required (one arm per leg)')
            self.stop_event.clear()
            self.mission_thread=threading.Thread(target=self._traverse_leg,args=(scene,definition,int(max_steps),bool(face_target)),daemon=True,name='dimos-traverse')
            self.mission_thread.start()
            return {'accepted':True,'scene':scene,'leg':index,'target':definition['target'],'leg_kind':definition['kind'],
                    'sequence_label':definition.get('sequence_label'),'mobile_target':definition.get('mobile_target'),
                    'planned':atlas.leg_brief(definition)['plan'],'max_steps':int(max_steps),'mode':self.mode}

    def _interact(self, target_id, interactions):
        """Map interactions in the leg's order, each only while the map says it is currently valid."""
        results=[]
        for action in interactions:
            with self.map.lock:
                obs=self.map.current(); self._validate(obs,True)
                entity=next((e for e in obs['entities'] if e['id']==target_id or e.get('scene_object_id')==target_id),None)
                if not entity:
                    results.append({'action':action,'skipped':'target_missing'}); break
                valid=entity.get('currently_valid_actions') or []
                if action not in valid:
                    results.append({'action':action,'skipped':f'not valid now (valid: {valid})','distance_units':entity.get('distance_from_robot')}); break
                result=self.map.post('interaction',entity_id=entity['id'],action=action)
                state=next((e['state'] for e in result['observation']['entities'] if e['id']==entity['id']),None)
                results.append({'action':action,'state':state,'timestamp':time.time()})
            self._await_feedback(self.feedback_sequence)
        return results

    def _traverse_leg(self, scene, leg, max_steps, face_target):
        started=time.monotonic(); atlas=self._atlas; target=leg['target']
        record={'kind':'traverse_leg','scene':scene,'leg':leg['index'],'target':target,'leg_kind':leg['kind'],
                'sequence_label':leg.get('sequence_label'),'mobile_target':leg.get('mobile_target'),'purpose':leg.get('purpose'),
                'planned':atlas.leg_brief(leg)['plan'],'mode':self.mode,'success':False}
        try:
            obs=self._await_feedback(); self._validate(obs,True)
            check=atlas.target_check(obs,target); record['pre_check']=check
            if not check['present']:
                raise GateError(f'target_missing_in_scene: {target}')
            if check.get('restaged'):
                # Mobile asset moved from its authored stop: fine, the live planner uses the observed
                # position; record it so the ontology can compare reported vs observed later.
                record['note']=f"{target} re-staged {check['displacement_units']} units from its atlas position; planning on the live position"
            self._navigate(target,max_steps,face_target=face_target,close_in=bool(leg.get('interactions')))
            navigate=self.report; record['navigate']=navigate
            transitioned=None
            if leg.get('kind')=='transition' and navigate and not navigate.get('success'):
                # Reaching the airlock threshold makes the map load the next world, which the fail-closed
                # navigate loop reports as a scene change. For a transition leg that IS the arrival.
                transitioned=self._world_transition_after(scene)
                if transitioned:
                    navigate['success']=True; navigate['stopped_by']='arrived'; navigate['arrival_kind']='world_transition_triggered'
                    record['world_transition']=transitioned
            if not navigate or not navigate.get('success'):
                raise GateError(f"leg_navigation_failed: {navigate.get('stopped_by') if navigate else 'no report'}")
            record['arrived']=navigate.get('stopped_by')=='arrived'
            if leg.get('interactions') and record['arrived']:
                record['interactions']=self._interact(target,leg['interactions'])
            if leg.get('arrival_action'):
                final=navigate.get('final') or {}
                record['arrival_action']={'action':leg['arrival_action'],'target_distance_units':final.get('distance'),
                    'note':'Not triggered by the traverse: the map starts the world transition itself when the Go2 is physically near the airlock. Navigate the airlock id with 1-2 steps to enter.'}
            record['success']=True
        except Exception as error:
            record['error']=str(error)
        finally:
            record['elapsed_seconds']=time.monotonic()-started
            record['physical_travel_m']=self.capability.travel; record['physical_yaw_travel_rad']=self.capability.yaw_travel
            self.capability.stop('leg_finished')
            if self.mode=='live' and self.backend:
                self.backend.end_avoidance_monitor()
            legs=atlas.legs(scene); total=len(legs)
            previous=self.traverse_progress if self.traverse_progress and self.traverse_progress.get('scene')==scene else {'scene':scene,'legs':{}}
            previous['legs'][str(leg['index'])]={'target':target,'success':record['success'],'arrived':record.get('arrived'),
                'stopped_by':(record.get('navigate') or {}).get('stopped_by'),'error':record.get('error'),'steps':(record.get('navigate') or {}).get('steps'),
                'interactions':[(i.get('action'),i.get('state') or i.get('skipped')) for i in record.get('interactions') or []],'at':time.time()}
            done=[int(k) for k,v in previous['legs'].items() if v['success'] and v.get('arrived')]
            nxt=next((l['index'] for l in legs if l['index'] not in done),None)
            if nxt is None:
                instruction=None
            elif nxt==leg['index'] and record['success']:
                instruction=f"leg {nxt} ({target}) stopped by {(record.get('navigate') or {}).get('stopped_by')} before arrival: arm again, then `scripts/air-demo traverse --leg {nxt}` to continue"
            else:
                instruction=f"arm again (clear lane, robot standing), then `scripts/air-demo traverse --leg {nxt}` → {legs[nxt-1]['target']}"
            previous.update({'next_leg':nxt,'completed':sorted(done),'total_legs':total,'scene_complete':nxt is None,'next_instruction':instruction})
            self._set_traverse_progress(previous)
            record['progress']=previous
            self.report=record
            (self.output/f"traverse-{scene}-leg{leg['index']}-{time.time_ns()}.json").write_text(json.dumps(record,indent=2)+'\n')

    def _world_transition_after(self, scene, settle_seconds=3.):
        """Did the map leave `scene` (airlock threshold crossed) during the last leg? Polls briefly because the
        world load runs behind a fade; returns the observed world identity or None (still the same scene)."""
        deadline=time.monotonic()+settle_seconds
        while True:
            try:
                with self.map.lock:
                    obs=self.map.read()
                identity=str(obs.get('active_world') or '')
                phase=identity.split(':')[-1] if identity else ''
                if identity and not identity.startswith(scene+':') or phase=='transition':
                    return {'active_world':identity,'map_ready':obs.get('map_ready'),'robot_pose':obs.get('robot_pose')}
            except Exception as error:
                # The read itself fails while the scene session is being replaced.
                if 'scene_changed' in str(error) or 'map_not_ready' in str(error):
                    return {'active_world':None,'map_ready':False,'error':str(error)}
            if time.monotonic()>=deadline:
                return None
            time.sleep(.25)

    def forward_test(self, use_dimos=False):
        """One fixed, bounded forward pulse; STOP on every exit, no retry."""
        with self.control_lock:
            if self.mode!='live' or not self.capability.armed or not self.backend:
                raise GateError('Forward test requires explicit live safety arming')
            if self.mission_thread and self.mission_thread.is_alive():
                raise GateError('Stop the mission before a forward test')
            before=self.fresh_sample()
            report={'kind':'dimos_forward_test' if use_dimos else 'forward_test','requested_at':time.time(),'before':asdict(before),
                    'requested_forward_m_s':self.capability.MAX_FORWARD,'pulse_seconds':self.capability.MAX_PULSE,
                    'pulses_attempted':0,'success':False}
            try:
                if use_dimos:
                    self.backend.native_active=True
                    report['command_units']='dimOS Twist input forwarded as joystick axis; physical speed uncalibrated'
                    report.pop('requested_forward_m_s',None)
                    report['requested_forward_input']=self.capability.MAX_FORWARD
                    self.backend.connection.balance_stand()
                    report['balance_stand_reply']=self.backend.connection.last_request_reply
                    if report['balance_stand_reply'].get('data',{}).get('header',{}).get('status',{}).get('code')!=0:
                        raise GateError('BalanceStand was not acknowledged successfully')
                for _ in range(1):  # One measured pulse (<= MAX_FORWARD*MAX_PULSE metres nominal).
                    self._validate(self.map.read(),True)
                    self.backend.require_clear(self.capability.MAX_FORWARD,0.)
                    self.capability.pulse(self.capability.MAX_FORWARD,0.,self.capability.MAX_PULSE)
                    report['pulses_attempted']+=1
                    if use_dimos:
                        report['dimos']=self.backend.dimos_forward(self.capability.MAX_FORWARD,self.capability.MAX_PULSE,
                            lambda:self.capability.armed and not self.stop_event.is_set() and self.feedback_valid() and self.pending_fault is None)
                    if self.stop_event.wait(.05 if use_dimos else self.capability.MAX_PULSE+.05):
                        raise GateError('forward_test_stopped')
                    self.capability.stop('forward_pulse_complete',disarm=False)
                    after=self.fresh_sample()
                    self._await_feedback(after.sequence-1)
                report['success']=True
            except Exception as error:
                report['error']=str(error)
            finally:
                self.stop_event.set()
                self.capability.stop('forward_test_finished')
                self.backend.end_avoidance_monitor()
                if use_dimos:
                    self.backend.native_active=False
                after=self.sample
                report['after']=asdict(after) if after else None
                if after:
                    report['measured_forward_delta_m']=(after.x-before.x)*math.cos(before.yaw)+(after.y-before.y)*math.sin(before.yaw)
                report['motor_events']=[dict(e) for e in self.backend.motor_events if e['sent_at']>=report['requested_at']]
                self.report=report
                (self.output/f'forward-test-{time.time_ns()}.json').write_text(json.dumps(report,indent=2)+'\n')
            return report

    @skill(uses=['movement'])
    def execute_excavator_mission(self, instruction: str) -> SkillResult:
        """Inspect and ready the current lunar excavator through bounded, measured approach steps."""
        started=time.monotonic(); latency_start=len(self.map.latencies)
        events=[]; start_obs=self._await_feedback(); self._validate(start_obs,True)
        self.map.post('mission',op='target',target_id='rover-1')
        self._await_feedback(self.feedback_sequence)
        self.waypoint = self.map.post('mission',op='approach').get('navigation')
        self._await_feedback(self.feedback_sequence)
        last_progress=time.monotonic(); previous_distance=None; previous_bearing=None
        try:
            while not self.stop_event.is_set():
                self._await_feedback(self.feedback_sequence)
                with self.map.lock:
                    # A telemetry POST returns a freshly recomputed scene observation.
                    # Reuse that measured round trip instead of blocking it behind extra GETs.
                    obs=self.map.current(); self._validate(obs,True)
                    target=next((e for e in obs['entities'] if e['id']=='rover-1' and e['type']=='excavator'),None)
                    if not target:
                        raise GateError('Current lunar excavator unavailable')
                    valid=target['currently_valid_actions']; distance=target['distance_from_robot']
                    context={'scene_session_id':obs['scene_session_id'],'scene_revision':obs['scene_revision'],
                        'observation_sequence':obs['observation_sequence'],'robot_pose':obs['robot_pose'],
                        'target_observation':target,'raw_odometry':asdict(self.fresh_sample()),
                        'physical_sensors':self.backend.sensors.status() if self.mode=='live' else None}
                    if valid==['approach']:
                        pose=obs['robot_pose']
                        waypoint=self.waypoint
                        # A Go2 stops within ~2 scene units at scale 40, so "reached" is one step, not 6 mm.
                        reached=self.capability.MIN_PULSE*self.capability.MAX_FORWARD*self.alignment.scale*.75
                        if not waypoint or math.hypot(waypoint['x']-pose['x'],waypoint['z']-pose['z'])<reached:
                            result=self.map.post('mission',op='approach')
                            waypoint=self.waypoint=result.get('navigation')
                            pose=result['observation']['robot_pose']
                        if not waypoint:
                            raise GateError('No path in current scene')
                        dx,dz=waypoint['x']-pose['x'],waypoint['z']-pose['z']
                        bearing=angle(math.atan2(-dz,dx)-pose['yaw'])
                        forward=0. if abs(bearing)>self.capability.HEADING_TOLERANCE else self.capability.MAX_FORWARD
                        yaw=math.copysign(self.capability.MAX_YAW,bearing) if not forward else 0.
                        duration=min(self.capability.MAX_PULSE,max(self.capability.MIN_PULSE,
                            abs(bearing)/self.capability.MAX_YAW if yaw else math.hypot(dx,dz)/(forward*self.alignment.scale)))
                        # Mandatory sequencing: every nonzero pulse follows an actual approach affordance.
                        events.append({**context,'action':'approach','distance':distance,'bearing':bearing,'forward':forward,'yaw':yaw,
                            'duration':duration,'sample_sequence':self.feedback_sequence,'timestamp':time.time()})
                    elif valid in (['inspect'],['activate'],['verify']):
                        self.capability.stop('interaction',disarm=False)
                        action=valid[0]
                        result=self.map.post('interaction',entity_id='rover-1',action=action)
                        state=next(e['state'] for e in result['observation']['entities'] if e['id']=='rover-1')
                        events.append({**context,'action':action,'distance':distance,'state':state,'timestamp':time.time()})
                        if state=='VERIFIED':
                            self.report={'success':True,'mode':self.mode,'source':self.sample.source,'physical_commands_sent':0 if self.mode=='replay' else None,
                                'elapsed_seconds':time.monotonic()-started,'actions':events,'start_observation':start_obs,'final_observation':result['observation'],
                                'physical_travel_m':self.capability.travel,'physical_yaw_travel_rad':self.capability.yaw_travel,
                                'map_latency_ms':{'max':max(self.map.latencies[latency_start:])*1000,
                                    'mean':sum(self.map.latencies[latency_start:])/len(self.map.latencies[latency_start:])*1000}}
                            return SkillResult.ok('Excavator VERIFIED',mode=self.mode)
                        continue
                    else:
                        raise GateError('No valid mandatory mission action')
                s=self.fresh_sample()
                if (previous_distance is None or distance < previous_distance-.03 or
                    previous_bearing is None or abs(bearing)<previous_bearing-.01):
                    last_progress=time.monotonic()
                if time.monotonic()-last_progress>4:
                    raise GateError('no_progress_abort')
                previous_distance=distance; previous_bearing=abs(bearing)
                self.capability.pulse(forward,yaw,duration)
                if self.stop_event.wait(duration+.05):
                    raise GateError('stopped')
                self.capability.stop('pulse_complete',disarm=False)
                newer=self.fresh_sample()
                self._await_feedback(newer.sequence-1)
                # One pulse may not move the robot further than it was commanded
                # plus controller ramp/stopping slack (Go2 trot ramps ~0.3 s).
                max_step=forward*duration*1.5+.10
                max_turn=abs(yaw)*duration*1.5+.25
                if math.hypot(newer.x-s.x,newer.y-s.y)>max_step or abs(angle(newer.yaw-s.yaw))>max_turn:
                    raise GateError('measured_action_envelope')
            raise GateError(self.capability.stop_reason or 'stopped')
        except Exception as error:
            self.report={'success':False,'error':str(error),'mode':self.mode,'actions':events,'elapsed_seconds':time.monotonic()-started}
            return SkillResult.fail('EXECUTION_FAILED',str(error))
        finally:
            self.capability.stop('mission_finished')
            if self.mode=='live' and self.backend:
                self.backend.end_avoidance_monitor()
            if self.report:
                path=self.output/f"mission-{time.time_ns()}.json"
                path.write_text(json.dumps(self.report,indent=2)+'\n')

    def _run(self):
        try:
            self.execute_excavator_mission(MISSION)
        except Exception as error:
            self.report={'success':False,'error':str(error)}
            self.capability.stop('mission_exception')
        finally:
            if not self.report or not self.report.get('success'):
                self.stop('mission_failed')

    def close(self):
        self.stop('shutdown'); self.closed.set(); self.feedback_thread.join(2)
        self.capability.close()
        if self.backend:
            self.backend.close()

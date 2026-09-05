"""Live-only adapter around the INSTALLED dimOS Unitree WebRTC transport.

Imported only by an explicit live connect command. No replay data enters here.
Connect/subscribe/check-mode are read-only; no stand, controller switch, mode
change, obstacle-avoidance toggle or locomotion happens during connection.
"""
from __future__ import annotations
import asyncio
import json
import math
import threading
import time
from dimos.robot.unitree.connection import UnitreeWebRTCConnection
from dimos.robot.unitree.type.odometry import Odometry
from dimos.msgs.geometry_msgs.Twist import Twist
from unitree_webrtc_connect.constants import RTC_TOPIC, SPORT_CMD, DATA_CHANNEL_TYPE, app_error_messages
from .air_sensors import PhysicalSensors
from .air_core import BoundedCapability

# Robot-reported fault families that must block posture/locomotion requests.
# 1xx communication firmware, 3xx motor (source = 300 + motor index), 6xx motion control.
# The Go2 accepts sport API requests (reply code 0) while such a fault is active
# and then silently refuses to execute them, e.g. 309-4 = motor 9 driver overheating.
BLOCKING_ERROR_FAMILIES = (100, 300, 600)


def decode_robot_error(source, code):
    """Human-readable decode of one Unitree data-channel error tuple element."""
    family = source - source % 100
    hex_code = format(code, 'X')
    text = app_error_messages.get(f'app_error_code_{family}_{hex_code}', f'unknown code {source}-{hex_code}')
    where = app_error_messages.get(f'app_error_source_{family}', f'source {family}')
    entry = {'source': source, 'code': code, 'label': f'{source}-{hex_code}', 'family': family,
             'description': f'{where}: {text}', 'blocking': family in BLOCKING_ERROR_FAMILIES}
    if family == 300:
        entry['motor_index'] = source % 100
    return entry


class TelemetryConnection(UnitreeWebRTCConnection):
    def publish_request(self, topic, data):
        future=asyncio.run_coroutine_threadsafe(self.conn.datachannel.pub_sub.publish_request_new(topic,data),self.loop)
        try:
            result=future.result(timeout=3)
            self.last_request_reply=result
            return result
        except BaseException:
            future.cancel();raise

    def connect(self):
        # Override only startup: stock connect selects a motion mode immediately.
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True, name='go2-local-webrtc')
        self.thread.start()
        async def connect_only():
            await self.conn.connect()
            await self.conn.datachannel.disableTrafficSaving(True)
            self.conn.datachannel.set_decoder(decoder_type='native')
        future = asyncio.run_coroutine_threadsafe(connect_only(), self.loop)
        try:
            future.result(timeout=15)
        except BaseException:
            future.cancel()
            # A failed handshake may already have allocated a peer connection.
            # Close it before relinquishing the sole-controller process.
            cleanup = asyncio.run_coroutine_threadsafe(self.conn.disconnect(),self.loop)
            try:
                cleanup.result(timeout=2)
            except BaseException:
                cleanup.cancel()
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(2)
            raise


class LiveRobot:
    source = 'physical_odometry'
    physical_channel = True

    def __init__(self, ip, on_sample, on_fault, aes_128_key=None, telemetry_only=False, posture_only=False):
        if telemetry_only and posture_only:
            raise ValueError('Choose telemetry-only or posture-only')
        self.telemetry_only = telemetry_only
        self.posture_only = posture_only
        self.stand_attempted = False
        self.avoidance_monitor = None
        self.on_sample, self.on_fault = on_sample, on_fault
        self.sensors = PhysicalSensors()
        self.connection = TelemetryConnection(ip, aes_128_key=aes_128_key)
        self.last_stamp = None
        self.source_offset = None
        self.odometry_timing = {}
        self.sequence = 0
        self.sport_received = 0.
        self.sport_state = {}
        # Measured leg joints (LowState motor_state[0:12].q, Unitree order FR,FL,RR,RL x hip,thigh,calf)
        # ride along with pose feedback so the map avatar walks per limb. Visual only.
        self.joint_angles = None
        self.joints_received = 0.
        self.joint_intervals = []
        self.closed = False
        self.generation = 0
        self.received_topics = {}
        self.robot_errors = {}       # (source, code) -> decoded active robot fault
        self.errors_received = 0.    # monotonic time of the last errors/add_error/rm_error frame
        self.error_events = []       # bounded history of robot fault appear/clear events
        self.motor_events = []
        self.native_active = False
        self.native_window_end = 0.
        self.native_sent = 0
        self.native_allowed = lambda:False
        self.write_lock = threading.Lock()
        pub=self.connection.conn.datachannel.pub_sub
        original_publish=pub.publish_without_callback
        def guarded_publish(topic,data=None,msg_type=None):
            if topic==RTC_TOPIC['WIRELESS_CONTROLLER'] and isinstance(data,dict) and any(data.get(k,0) for k in ('lx','ly','rx','ry')):
                with self.write_lock:
                    if self.telemetry_only or self.posture_only or not self.native_active or time.monotonic()>=self.native_window_end or not self.native_allowed():
                        return
                    self.native_sent+=1
                    original_publish(topic,data,msg_type)
                return
            original_publish(topic,data,msg_type)
        pub.publish_without_callback=guarded_publish
        resolve=pub.run_resolve
        def count_messages(message):
            topic=message.get('topic','')
            self.received_topics[topic]=self.received_topics.get(topic,0)+1
            kind=message.get('type')
            if kind in (DATA_CHANNEL_TYPE['ERRORS'],DATA_CHANNEL_TYPE['ADD_ERROR'],DATA_CHANNEL_TYPE['RM_ERROR']):
                self._robot_errors(kind,message.get('data'))
            if topic=='rt/api/sport/response':
                header=message.get('data',{}).get('header',{})
                identity=header.get('identity',{})
                for event in reversed(self.motor_events):
                    if event['id']==identity.get('id') and event['api_id']==identity.get('api_id'):
                        event['reply_code']=header.get('status',{}).get('code')
                        event['reply_received_at']=time.time()
                        break
            resolve(message)
        pub.run_resolve=count_messages
        self.subscriptions = [
            # Pose safety must not wait behind camera/LiDAR work in dimOS's
            # shared reactive thread pool. Parse directly on packet receipt.
            self.connection.unitree_sub_stream(RTC_TOPIC['ROBOTODOM']).subscribe(self._odom, lambda e: self.on_fault('odometry_stream_error')),
            self.connection.unitree_sub_stream(RTC_TOPIC['LF_SPORT_MOD_STATE']).subscribe(self._sport),
            self.connection.unitree_sub_stream(RTC_TOPIC['LOW_STATE']).subscribe(self._low_state),
            self.connection.raw_lidar_stream().subscribe(self.sensors.lidar, lambda e: self.on_fault('lidar_stream_error')),
            self.connection.raw_video_stream().subscribe(self.sensors.camera, lambda e: self.on_fault('camera_stream_error')),
            self.connection.unitree_sub_stream(RTC_TOPIC['ULIDAR_STATE']).subscribe(self._lidar_state),
        ]
        # The current controller must report itself; never select a different one.
        request = asyncio.run_coroutine_threadsafe(
            self.connection.conn.datachannel.pub_sub.publish_request_new(RTC_TOPIC['MOTION_SWITCHER'], {'api_id':1001}),
            self.connection.loop)
        try:
            result = request.result(timeout=3)
            data = result.get('data', {}).get('data', '{}')
            self.controller_mode = (json.loads(data) if isinstance(data,str) else data).get('name')
        except BaseException:
            request.cancel(); self.controller_mode = None

    def _lidar_state(self, message):
        self.sensors.health(message.get('data'))

    def _robot_errors(self, kind, data):
        """Track the robot's own fault list from the errors/add_error/rm_error frames.

        The frame data is [timestamp, source, code] or a list of such tuples
        (same shapes the installed driver's handle_error prints)."""
        try:
            entries = data or []
            if entries and not isinstance(entries[0], (list, tuple)):
                entries = [entries]
            decoded = []
            for stamp, source, code in entries:
                entry = decode_robot_error(int(source), int(code))
                entry['robot_timestamp'] = stamp
                decoded.append(entry)
            now = time.monotonic()
            if kind == DATA_CHANNEL_TYPE['ERRORS']:
                self.robot_errors = {(e['source'], e['code']): e for e in decoded}
            elif kind == DATA_CHANNEL_TYPE['ADD_ERROR']:
                for e in decoded:
                    self.robot_errors[(e['source'], e['code'])] = e
            else:
                for e in decoded:
                    self.robot_errors.pop((e['source'], e['code']), None)
            for e in decoded:
                self.error_events.append({'event': kind, 'received_at': time.time(), **e})
            del self.error_events[:-64]
            self.errors_received = now
        except Exception:
            self.on_fault('invalid_robot_error_frame')

    def active_errors(self):
        return sorted(self.robot_errors.values(), key=lambda e: (e['source'], e['code']))

    def blocking_errors(self):
        return [e for e in self.active_errors() if e['blocking']]

    def error_status(self):
        return {'active': self.active_errors(), 'blocking': bool(self.blocking_errors()),
                'last_frame_age_ms': (time.monotonic()-self.errors_received)*1000 if self.errors_received else None,
                'recent_events': list(self.error_events[-8:])}

    def enable_sensing(self):
        raise RuntimeError('Automatic robot sensing/avoidance setup disabled after unexpected voice toggling')

    def enable_lidar(self):
        """Explicit point-cloud stream enable; no avoidance or motor API calls."""
        async def enable():
            for _ in range(5):
                self.connection.conn.datachannel.pub_sub.publish_without_callback(RTC_TOPIC['ULIDAR_SWITCH'],'on')
                await asyncio.sleep(.1)
            return {'lidar_stream_requested':True,'avoidance_configuration_changed':False}
        future=asyncio.run_coroutine_threadsafe(enable(),self.connection.loop)
        try:
            return future.result(timeout=3)
        except BaseException:
            future.cancel();raise

    async def _read_avoidance(self):
        result=await asyncio.wait_for(self.connection.conn.datachannel.pub_sub.publish_request_new(
            RTC_TOPIC['OBSTACLES_AVOID'],{'api_id':1002,'parameter':{}}),timeout=2)
        body=result.get('data',{})
        code=body.get('header',{}).get('status',{}).get('code')
        payload=body.get('data',{})
        if isinstance(payload,str):
            payload=json.loads(payload)
        enabled=payload.get('enable') if isinstance(payload,dict) and code==0 else None
        self.sensors.avoidance(enabled)
        return {'reply':result,'confirmed_enabled':enabled is True,'automatic_polling':False}

    def check_avoidance(self):
        """One explicit SwitchGet read; never toggle or start services."""
        future=asyncio.run_coroutine_threadsafe(self._read_avoidance(),self.connection.loop)
        try:
            return future.result(timeout=3)
        except BaseException:
            future.cancel();self.sensors.avoidance(None);raise

    def begin_avoidance_monitor(self):
        """Arm-time status reads only, bounded to the mission time limit."""
        self.end_avoidance_monitor()
        async def monitor():
            deadline=time.monotonic()+95
            while not self.closed and time.monotonic()<deadline:
                try:
                    result=await self._read_avoidance()
                    if not result['confirmed_enabled']:
                        self.on_fault('avoidance_disabled');return
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self.sensors.avoidance(None)
                    self.on_fault('avoidance_status_lost');return
                await asyncio.sleep(1)
        self.avoidance_monitor=asyncio.run_coroutine_threadsafe(monitor(),self.connection.loop)

    def end_avoidance_monitor(self):
        if self.avoidance_monitor:
            self.avoidance_monitor.cancel();self.avoidance_monitor=None

    def diagnose_sensors(self):
        """Bounded read-only alternate-topic and service diagnostics."""
        async def inspect():
            pub = self.connection.conn.datachannel.pub_sub
            messages = []
            def alternate(raw):
                data = raw.get('data',{})
                if isinstance(data,dict):
                    metadata = {k:v for k,v in data.items() if k not in ('data','points')}
                else:
                    metadata = {'data_type':type(data).__name__}
                messages.append(metadata)
                if len(messages)>3:
                    del messages[1]
            pub.subscribe(RTC_TOPIC['ULIDAR'],alternate)
            replies = {}
            try:
                for name,topic,api in [('services','rt/api/robot_state/request',1003)]:
                    try:
                        replies[name] = await asyncio.wait_for(pub.publish_request_new(topic,{'api_id':api}),timeout=2)
                    except Exception as error:
                        replies[name] = {'error':type(error).__name__}
                await asyncio.sleep(2)
            finally:
                pub.unsubscribe(RTC_TOPIC['ULIDAR'])
            return {'alternate_lidar_samples':messages,'service_replies':replies,'controller_mode':self.controller_mode,
                    'robot_errors':self.error_status(),
                    'sport_state':self.sport_state,'sport_age_ms':(time.monotonic()-self.sport_received)*1000 if self.sport_received else None,
                    'joint_state':{'available':self.joint_angles is not None,'age_ms':(time.monotonic()-self.joints_received)*1000 if self.joints_received else None,
                                   'stream_hz':self.joint_stream_hz()},
                    'received_topics':dict(self.received_topics),'subscriptions':list(pub.subscriptions),
                    'odometry_timing':dict(self.odometry_timing)}
        future = asyncio.run_coroutine_threadsafe(inspect(),self.connection.loop)
        try:
            return future.result(timeout=10)
        except BaseException:
            future.cancel();raise

    def _odom(self, raw):
        try:
            odom = Odometry.from_msg(raw)  # Keeps raw source timestamp and raw positions.
            stamp = odom.ts
            now = time.monotonic()
            if not math.isfinite(stamp):
                self.on_fault('invalid_odometry_timestamp'); return
            if self.last_stamp is not None and stamp <= self.last_stamp:
                return  # A frozen/reordered source cannot refresh our stale-data clock.
            if self.last_stamp is not None and stamp - self.last_stamp > 2:
                self.on_fault('odometry_clock_gap')
            self.last_stamp = stamp
            # Robot and Air clocks may have different epochs. Track the best
            # source/receipt offset so buffered old packets cannot look fresh.
            offset = now-stamp
            self.source_offset = offset if self.source_offset is None else min(offset,self.source_offset)
            self.odometry_timing={'source_stamp':stamp,'received_monotonic':now,
                'relative_source_delay_ms':(offset-self.source_offset)*1000,
                'max_relative_source_delay_ms':max(self.odometry_timing.get('max_relative_source_delay_ms',0),(offset-self.source_offset)*1000)}
            if offset-self.source_offset > BoundedCapability.STALE_SECONDS:
                self.on_fault('delayed_source_odometry'); return
            q = odom.orientation
            norm = math.sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w)
            if not math.isfinite(norm) or not .98 < norm < 1.02:
                self.on_fault('invalid_odometry_orientation'); return
            yaw = math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z))
            self.sensors.odometry(odom.position.x,odom.position.y,odom.position.z,yaw,
                                  raw['data']['header'].get('frame_id'),now)
            self.sequence += 1
            self.on_sample(odom.position.x,odom.position.y,odom.position.z,yaw,self.sequence,
                           now,time.time(),self.source)
        except Exception:
            self.on_fault('invalid_odometry')

    def _low_state(self, message):
        """rt/lf/lowstate: keep the 12 leg motor angles when the frame is well formed."""
        data = message.get('data', {}) if isinstance(message, dict) else {}
        motors = data.get('motor_state') if isinstance(data, dict) else None
        if not isinstance(motors, list) or len(motors) < 12:
            return
        try:
            angles = [float(m['q']) for m in motors[:12]]
        except (KeyError, TypeError, ValueError):
            return
        if not all(math.isfinite(a) for a in angles):
            return
        now = time.monotonic()
        if self.joints_received:
            self.joint_intervals.append(now-self.joints_received)
            del self.joint_intervals[:-50]
        self.joint_angles = angles
        self.joints_received = now

    def fresh_joints(self, max_age=.5):
        """Latest measured joint angles or None when absent/stale."""
        if self.joint_angles is None or time.monotonic()-self.joints_received > max_age:
            return None
        return list(self.joint_angles)

    def joint_stream_hz(self):
        if len(self.joint_intervals) < 3:
            return None
        return len(self.joint_intervals)/sum(self.joint_intervals)

    def _sport(self, message):
        data = message.get('data', {})
        if isinstance(data,dict):
            self.sport_state = data
            self.sport_received = time.monotonic()

    def ready(self):
        channel = self.connection.conn.datachannel.pub_sub.channel
        # Controller acknowledgement + fresh standing-height state; operator still
        # confirms the lane/standing posture. No autonomous obstacle claims.
        height = self.sport_state.get('body_height', 0.)
        return (not self.closed and channel.readyState == 'open' and
                self.controller_mode in ('normal','ai','mcf') and
                not self.blocking_errors() and
                time.monotonic()-self.sport_received < .5 and
                isinstance(height,(float,int)) and .12 <= height <= .50)

    def stand_in_place(self):
        """Single high-level dimOS posture request, never a walking command."""
        if self.telemetry_only or not self.posture_only or self.stand_attempted:
            raise RuntimeError('A fresh posture-only connection permits one stand attempt')
        faults=self.blocking_errors()
        if faults:
            # The controller acknowledges StandUp (code 0) but will not execute it
            # while a motor/communication/motion-control fault is active.
            raise RuntimeError('Robot reports active hardware fault; stand refused: '
                               +'; '.join(f"{e['label']} {e['description']}" for e in faults))
        now=time.monotonic()
        state=self.sport_state
        rpy=state.get('imu_state',{}).get('rpy',[])
        if (now-self.sport_received>.5 or now-self.sensors.camera_received>1.5 or
            self.controller_mode not in ('normal','ai','mcf') or len(rpy)!=3 or
            not all(math.isfinite(v) for v in rpy) or abs(rpy[0])>.25 or abs(rpy[1])>.25 or
            not .04 <= state.get('body_height',0) < .15):
            raise RuntimeError('Fresh upright lying posture and camera required for stand preparation')
        self.stand_attempted=True
        async def stand():
            result=await asyncio.wait_for(self.connection.conn.datachannel.pub_sub.publish_request_new(
                RTC_TOPIC['SPORT_MOD'],{'api_id':SPORT_CMD['StandUp']}),timeout=3)
            code=result.get('data',{}).get('header',{}).get('status',{}).get('code')
            if code!=0:
                raise RuntimeError(f'StandUp rejected: {code}')
            deadline=time.monotonic()+12
            stable_since=None
            while time.monotonic()<deadline:
                state=self.sport_state
                stable=(time.monotonic()-self.sport_received<.5 and .18<=state.get('body_height',0)<=.5)
                stable_since=(stable_since or time.monotonic()) if stable else None
                if stable_since and time.monotonic()-stable_since>.5:
                    return {'standing_measured':True,'sport_state':dict(state),'reply':result,'walking_enabled':False}
                await asyncio.sleep(.05)
            raise RuntimeError('StandUp did not reach measured standing height; no retry')
        future=asyncio.run_coroutine_threadsafe(stand(),self.connection.loop)
        try:
            return future.result(timeout=16)
        except BaseException:
            future.cancel();self.stop();raise

    def stand_down(self):
        """Single StandDown (1005) posture request; the controller lowers the body gently."""
        if self.telemetry_only:
            raise RuntimeError('Telemetry-only connection cannot change posture')
        self.stop()
        async def lower():
            result=await asyncio.wait_for(self.connection.conn.datachannel.pub_sub.publish_request_new(
                RTC_TOPIC['SPORT_MOD'],{'api_id':SPORT_CMD['StandDown']}),timeout=3)
            code=result.get('data',{}).get('header',{}).get('status',{}).get('code')
            if code!=0:
                raise RuntimeError(f'StandDown rejected: {code}')
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                height=self.sport_state.get('body_height')
                if time.monotonic()-self.sport_received<.5 and isinstance(height,(int,float)) and height<.15:
                    return {'lowered_measured':True,'body_height_m':height,'reply':result}
                await asyncio.sleep(.1)
            return {'lowered_measured':False,'body_height_m':self.sport_state.get('body_height'),'reply':result}
        future=asyncio.run_coroutine_threadsafe(lower(),self.connection.loop)
        try:
            return future.result(timeout=12)
        except BaseException:
            future.cancel();raise

    def require_clear(self, forward=0.,yaw=0.):
        self.sensors.require_clear(forward,yaw)

    def _publish(self, api, parameter, priority=False):
        if self.telemetry_only:
            raise RuntimeError('Telemetry-only connection cannot publish motor commands')
        if self.posture_only and not (api==SPORT_CMD['StopMove'] or (api==SPORT_CMD['Move'] and parameter=={'x':0.,'y':0.,'z':0.})):
            raise RuntimeError('Posture-only connection rejects locomotion')
        pub = self.connection.conn.datachannel.pub_sub
        header = {'identity': {'id': int(time.time()*1000) % 2147483648, 'api_id':api}}
        if priority:
            header['policy'] = {'priority':1}
        if pub.channel.readyState!='open':
            raise RuntimeError('Motor publication refused: data channel closed')
        self.motor_events.append({'id':header['identity']['id'],'api_id':api,'parameter':dict(parameter),'sent_at':time.time()})
        del self.motor_events[:-128]
        pub.publish_without_callback(RTC_TOPIC['SPORT_MOD'],
            data={'header':header,'parameter':json.dumps(parameter)},msg_type=DATA_CHANNEL_TYPE['REQUEST'])

    def move(self, forward, yaw):
        if self.telemetry_only:
            raise RuntimeError('Telemetry-only connection cannot move hardware')
        if self.posture_only:
            raise RuntimeError('Posture-only connection cannot walk')
        if self.native_active:
            return  # Installed dimOS move() owns publication during its bounded test.
        with self.write_lock:
            generation = self.generation
        def send():
            with self.write_lock:
                if self.closed or generation != self.generation:
                    return
                self._publish(SPORT_CMD['Move'],{'x':forward,'y':0.,'z':yaw})
        self.connection.loop.call_soon_threadsafe(send)

    def stop(self):
        if self.telemetry_only:
            return  # The operator remote owns hardware STOP in this mode.
        with self.write_lock:
            self.native_window_end=0.
            self.generation += 1  # Invalidate already-queued movement callbacks.
        def send():
            with self.write_lock:
                if not self.closed:
                    self.connection.conn.datachannel.pub_sub.publish_without_callback(RTC_TOPIC['WIRELESS_CONTROLLER'],{'lx':0.,'ly':0.,'rx':0.,'ry':0.})
                    self._publish(SPORT_CMD['Move'], {'x':0.,'y':0.,'z':0.}, True)
                    self._publish(SPORT_CMD['StopMove'], {}, True)
        self.connection.loop.call_soon_threadsafe(send)

    def dimos_forward(self, forward, duration, allowed):
        self.native_allowed=allowed
        self.native_window_end=time.monotonic()+duration
        sent_before=self.native_sent
        try:
            result=self.connection.move(Twist(linear=[forward,0.,0.],angular=[0.,0.,0.]),duration=duration)
            return {'dimos_return':result,'nonzero_joystick_messages_sent':self.native_sent-sent_before}
        finally:
            self.native_window_end=0.
            self.connection.move(Twist(),duration=0.)
            self.stop()

    def close(self):
        self.end_avoidance_monitor()
        self.stop()
        for subscription in self.subscriptions:
            subscription.dispose()
        # Queue disconnect after priority STOP, without stand/down side effects.
        async def disconnect():
            await asyncio.sleep(.1)
            await self.connection.conn.disconnect()
        try:
            asyncio.run_coroutine_threadsafe(disconnect(), self.connection.loop).result(timeout=2)
        finally:
            self.closed = True
            self.connection.loop.call_soon_threadsafe(self.connection.loop.stop)
            self.connection.thread.join(2)

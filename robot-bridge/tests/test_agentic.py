"""The dimOS reasoning skills act only through the gated bridge API. Fake local servers, no hardware."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from dimos.agents.skill_result import SkillResult
from moontology_bridge.agentic import (MISSION, CameraFrame, MoontologySkills, MoontologySkillsConfig, SYSTEM_PROMPT,
                                       atlas_prompt_block, build_blueprint, motion_blockers, summarize_observation,
                                       summarize_status, summarize_traverse)

OBSERVATION = {'scene_session_id': 's1', 'scene_revision': 25, 'observation_sequence': 3856, 'map_ready': True,
               'active_world': 'scene1', 'robot_pose': {'x': 1.5160768, 'y': -.35, 'z': 5.0023, 'yaw': .6525, 'frame': 'three_world',
                                                        'source': 'physical_odometry', 'telemetry_fresh': True},
               'mission_state': {'run_id': 'r1', 'phase': 'HELD', 'map_armed': False},
               'entities': [{'id': 'rover-1', 'type': 'excavator', 'state': 'offline', 'distance_from_robot': 12.1352, 'bearing': 2.0184,
                             'currently_valid_actions': ['approach'], 'object_affordances': ['approach', 'inspect'], 'visible': True,
                             'world_position': {'x': -9.3, 'y': -.35, 'z': -.5}, 'secret_internal': 'x',
                             'mobility': 'static', 'atlas_role': 'Lunar excavator', 'displacement_from_expected': 0.0312},
                            {'id': 'digging-bot', 'type': 'humanoid', 'state': 'working', 'distance_from_robot': 6.4, 'bearing': -.2,
                             'currently_valid_actions': [], 'visible': True, 'world_position': {'x': -5.9, 'y': -.35, 'z': .4},
                             'mobility': 'animated_in_place', 'sequence_label': 'H-01', 'atlas_role': 'Excavation technician'}],
               'layout': {'robotState': {'physicalHold': None, 'blockedReason': None}, 'unknownAreas': ['scene2'], 'obstacles': [1, 2, 3]},
               'performance': {'visible': True, 'render_age_ms': 60}}

READY_STATUS = {'mode': 'live', 'controller_ready': True, 'controller_mode': 'mcf', 'body_height_m': .31, 'armed': True, 'calibrated': True,
                'scale': 40., 'running': False, 'posture_only': False, 'telemetry_only': False, 'hardware_hold': False, 'source_fault': None,
                'stop_reason': None, 'robot_errors': {'active': [], 'blocking': False},
                'physical_sensors': {'lidar_age_ms': 120., 'camera_age_ms': 400., 'onboard_avoidance_enabled': True,
                                     'obstacles': {'forward_blocked': False, 'rotation_blocked': False}}, 'report': None}


class FakeServers:
    """One control (8766-like) and one map (5173-like) server on random loopback ports."""

    def __init__(self, status):
        self.status = dict(status); self.calls = []; self.jpeg = b'\xff\xd8fake-jpeg\xff\xd9'
        outer = self

        class Control(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def reply(self, code, body, content_type='application/json'):
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(code); self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
            def do_GET(self):
                if self.path == '/camera.jpg':
                    return self.reply(200, outer.jpeg, 'image/jpeg') if outer.jpeg else self.reply(503, {'error': 'fresh_physical_camera_unavailable'})
                if self.path.startswith('/atlas'):
                    return self.reply(200, {'scene': self.path.split('scene=')[-1], 'legs': [{'index': 1, 'target': 'digging-bot'}], 'mobile_ids': ['digging-bot']})
                if self.path == '/drift':
                    return self.reply(200, {'restaged_mobile': [], 'drifted_static': [], 'missing': [], 'unexpected': []})
                return self.reply(200, outer.status)
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or '{}')
                outer.calls.append((self.path, body, self.headers.get('Origin')))
                if self.path == '/mission':
                    if not outer.status['armed']:
                        return self.reply(409, {'error': 'Explicit arm required'})
                    outer.status['running'] = True
                    threading.Timer(.3, outer.finish_mission).start()
                    return self.reply(200, {'accepted': True})
                if self.path == '/traverse':
                    if not outer.status['armed']:
                        return self.reply(409, {'error': 'Explicit arm required (one arm per leg)'})
                    outer.status['running'] = True
                    threading.Timer(.3, outer.finish_traverse).start()
                    return self.reply(200, {'accepted': True, 'scene': body.get('scene'), 'leg': 1, 'target': 'digging-bot'})
                if self.path == '/stop':
                    outer.status['armed'] = False; outer.status['running'] = False; outer.status['stop_reason'] = 'operator_stop'
                    return self.reply(200, outer.status)
                return self.reply(404, {'error': 'unknown_endpoint'})

        class Map(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                data = json.dumps({'ok': True, 'observation': OBSERVATION, 'read_token': 't'}).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

        self.control = ThreadingHTTPServer(('127.0.0.1', 0), Control); self.map = ThreadingHTTPServer(('127.0.0.1', 0), Map)
        for server in (self.control, self.map):
            threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True).start()

    def finish_mission(self):
        self.status['running'] = False
        self.status['report'] = {'success': True, 'mode': 'live', 'elapsed_seconds': .3, 'physical_travel_m': .012,
                                 'actions': [{'action': 'approach'}, {'action': 'inspect'}, {'action': 'activate'}, {'action': 'verify'}],
                                 'final_observation': {'entities': [{'id': 'rover-1', 'state': 'VERIFIED'}]}}

    def finish_traverse(self):
        self.status['running'] = False
        self.status['report'] = {'kind': 'traverse_leg', 'scene': 'SCENE_1', 'leg': 1, 'target': 'digging-bot', 'leg_kind': 'context',
                                 'sequence_label': 'H-01', 'mobile_target': True, 'success': True, 'arrived': True, 'error': None,
                                 'pre_check': {'mobile': True, 'restaged': False, 'displacement_units': .02, 'distance_units': 6.4, 'raw': 'x'},
                                 'navigate': {'steps': 8, 'stopped_by': 'arrived', 'arrival_kind': 'planner_inside_ring',
                                              'final': {'distance': 1.05, 'bearing': .1}, 'face': {'pulses': 1}, 'actions': [{}] * 8},
                                 'interactions': [], 'physical_travel_m': .196, 'elapsed_seconds': 8.2,
                                 'progress': {'scene': 'SCENE_1', 'next_leg': 2, 'scene_complete': False}}

    def skills(self):
        module = object.__new__(MoontologySkills)
        module.config = MoontologySkillsConfig(control_url=f'http://127.0.0.1:{self.control.server_address[1]}',
                                               map_url=f'http://127.0.0.1:{self.map.server_address[1]}/api/map', mission_timeout_s=5.)
        return module

    def close(self):
        for server in (self.control, self.map):
            server.shutdown(); server.server_close()


class AgenticSkills(unittest.TestCase):
    def test_observation_summary_is_compact_and_semantic(self):
        summary = summarize_observation(OBSERVATION)
        entity = summary['entities'][0]
        self.assertEqual(entity['distance_m'], 12.14); self.assertEqual(entity['bearing_deg'], 115.6)
        self.assertNotIn('secret_internal', entity)
        self.assertEqual(summary['go2_pose']['x'], 1.516); self.assertEqual(summary['obstacle_count'], 3)
        self.assertIn('not physical proof', summary['note'])
        # Raw layout polygons/obstacle footprints are dropped: only counts and holds survive.
        self.assertNotIn('layout', summary); self.assertNotIn('obstacles', summary); self.assertNotIn('regions', json.dumps(summary))

    def test_observation_summary_carries_atlas_marks_for_recognition(self):
        summary = summarize_observation(OBSERVATION)
        excavator, humanoid = summary['entities']
        self.assertEqual(excavator['mobility'], 'static'); self.assertFalse(excavator['mobile'])
        self.assertEqual(excavator['displacement_from_expected_units'], .03)
        self.assertEqual(humanoid['sequence_label'], 'H-01'); self.assertTrue(humanoid['mobile'])
        self.assertEqual(humanoid['atlas_role'], 'Excavation technician')
        self.assertEqual(summary['humanoid_sequence_present'], ['H-01']); self.assertEqual(summary['mobile_entity_ids'], ['digging-bot'])
        self.assertIn('scene-atlas.json', summary['note'])
        self.assertIn('H-01', SYSTEM_PROMPT); self.assertIn('re-observed before any', SYSTEM_PROMPT)
        self.assertIn('ATLAS BRIEF', atlas_prompt_block('http://127.0.0.1:1/api/map'))  # committed file fallback or explicit unavailability

    def test_traverse_summary_is_compact_and_measured(self):
        self.assertIsNone(summarize_traverse({'kind': 'navigate'}))
        servers = FakeServers(READY_STATUS); servers.finish_traverse()
        try:
            report = summarize_traverse(servers.status['report'])
            self.assertEqual(report['sequence_label'], 'H-01'); self.assertTrue(report['faced_target'])
            self.assertEqual(report['final_distance_units'], 1.05); self.assertEqual(report['arrival_kind'], 'planner_inside_ring')
            self.assertNotIn('raw', report['pre_check']); self.assertEqual(report['progress']['next_leg'], 2)
        finally:
            servers.close()

    def test_atlas_and_drift_skills_are_read_only(self):
        servers = FakeServers(READY_STATUS)
        try:
            skills = servers.skills()
            atlas = json.loads(skills.scene_atlas()); self.assertEqual(atlas['scene'], 'SCENE_1'); self.assertEqual(atlas['mobile_ids'], ['digging-bot'])
            drift = json.loads(skills.scene_drift()); self.assertIn('restaged_mobile', drift)
            self.assertEqual(servers.calls, [], 'atlas reads never POST to the controller')
        finally:
            servers.close()

    def test_traverse_leg_refused_when_unarmed_and_reports_measured_leg_when_armed(self):
        servers = FakeServers({**READY_STATUS, 'armed': False})
        try:
            result = servers.skills().traverse_leg()
            self.assertFalse(result.success); self.assertEqual(result.error_code, 'INVALID_STATE'); self.assertEqual(servers.calls, [])
        finally:
            servers.close()
        servers = FakeServers(READY_STATUS)
        try:
            result = servers.skills().traverse_leg(max_steps=6)
            self.assertTrue(result.success, result.message)
            self.assertEqual(result.metadata['target'], 'digging-bot'); self.assertEqual(result.metadata['steps'], 8)
            self.assertEqual(servers.calls[0][0], '/traverse'); self.assertEqual(servers.calls[0][1]['max_steps'], 6)
            self.assertTrue(servers.calls[0][1]['face_target'])
        finally:
            servers.close()

    def test_motion_blockers_explain_each_operator_gate(self):
        self.assertEqual(motion_blockers(READY_STATUS), [])
        status = {**READY_STATUS, 'controller_ready': False, 'armed': False, 'calibrated': False, 'source_fault': 'delayed_source_odometry',
                  'robot_errors': {'active': [{'label': '309-4', 'description': 'Motor malfunction: Driver overheating', 'blocking': True}]}}
        blockers = motion_blockers(status)
        self.assertTrue(any('connect --robot-ip' in b for b in blockers))
        self.assertTrue(any('309-4' in b for b in blockers))
        self.assertTrue(any('reset' in b and 'calibrate' in b for b in blockers))
        self.assertTrue(any(b.startswith('not armed') for b in blockers))
        stale = {**READY_STATUS, 'physical_sensors': {**READY_STATUS['physical_sensors'], 'lidar_age_ms': 900.}}
        self.assertTrue(any('lidar_age_ms' in b for b in motion_blockers(stale)))
        self.assertIn('what_blocks_physical_motion', summarize_status(status))

    def test_skills_read_scene_status_and_camera_through_local_apis(self):
        servers = FakeServers(READY_STATUS)
        try:
            skills = servers.skills()
            scene = json.loads(skills.observe_scene()); self.assertEqual(scene['entities'][0]['id'], 'rover-1')
            status = json.loads(skills.robot_status()); self.assertTrue(status['controller_ready']); self.assertEqual(status['what_blocks_physical_motion'], [])
            frame = skills.look(); self.assertIsInstance(frame, CameraFrame)
            encoded = frame.agent_encode(); self.assertEqual(encoded[1]['type'], 'image_url'); self.assertTrue(encoded[1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
            servers.jpeg = None
            stale = skills.look(); self.assertIsInstance(stale, SkillResult); self.assertFalse(stale.success); self.assertEqual(stale.error_code, 'INVALID_STATE')
            self.assertEqual(servers.calls, [], 'reads must never POST to the controller')
        finally:
            servers.close()

    def test_mission_refused_locally_when_operator_gates_are_open(self):
        servers = FakeServers({**READY_STATUS, 'armed': False})
        try:
            result = servers.skills().run_excavator_mission()
            self.assertFalse(result.success); self.assertEqual(result.error_code, 'INVALID_STATE')
            self.assertIn('not armed', result.message)
            self.assertEqual(servers.calls, [], 'no POST reaches the bridge while a gate is open')
        finally:
            servers.close()

    def test_mission_runs_through_bridge_and_reports_measured_outcome(self):
        servers = FakeServers(READY_STATUS)
        try:
            result = servers.skills().run_excavator_mission()
            self.assertTrue(result.success, result.message)
            self.assertEqual(result.metadata['action_sequence'][-3:], ['inspect', 'activate', 'verify'])
            self.assertEqual(result.metadata['final_target_state'], 'VERIFIED')
            self.assertEqual(servers.calls[0][0], '/mission'); self.assertEqual(servers.calls[0][1], {'instruction': MISSION})
            self.assertIsNone(servers.calls[0][2], 'native local client: no browser Origin header')
        finally:
            servers.close()

    def test_stop_is_always_available_and_reports_bridge_state(self):
        servers = FakeServers(READY_STATUS)
        try:
            result = servers.skills().stop_robot()
            self.assertTrue(result.success); self.assertFalse(result.metadata['armed'])
            self.assertEqual(servers.calls, [('/stop', {}, None)])
        finally:
            servers.close()

    def test_unreachable_bridge_yields_operator_instruction_not_exception(self):
        module = object.__new__(MoontologySkills)
        module.config = MoontologySkillsConfig(control_url='http://127.0.0.1:1', map_url='http://127.0.0.1:1/api/map')
        status = json.loads(module.robot_status()); self.assertIn('start --live', status['what_blocks_physical_motion'][0])
        self.assertIn('error', json.loads(module.observe_scene()))
        result = module.stop_robot(); self.assertFalse(result.success); self.assertIn('remote STOP', result.message)

    def test_blueprint_exposes_only_gated_skills_and_optional_llm(self):
        names = lambda bp: [atom.module.__name__ for atom in bp.blueprints]
        self.assertEqual(names(build_blueprint(model=None)), ['MoontologySkills', 'McpServer'])
        self.assertEqual(names(build_blueprint(model='gpt-4o')), ['MoontologySkills', 'McpServer', 'McpClient'])
        exposed = {name for name in dir(MoontologySkills) if getattr(getattr(MoontologySkills, name), '__skill_uses__', None) is not None}
        self.assertEqual(exposed, {'observe_scene', 'robot_status', 'look', 'mission_report', 'run_excavator_mission', 'navigate_toward',
                                   'scene_atlas', 'scene_drift', 'traverse_leg', 'stop_robot'})
        self.assertEqual(MoontologySkills.run_excavator_mission.__skill_uses__, ['movement'])
        self.assertEqual(MoontologySkills.navigate_toward.__skill_uses__, ['movement'], 'navigation is gated like the mission')
        self.assertEqual(MoontologySkills.traverse_leg.__skill_uses__, ['movement'], 'atlas legs are gated like the mission')
        self.assertEqual(MoontologySkills.scene_atlas.__skill_uses__, []); self.assertEqual(MoontologySkills.scene_drift.__skill_uses__, [])
        self.assertEqual(MoontologySkills.stop_robot.__skill_uses__, [], 'STOP must never wait on a held capability')
        for forbidden in ('connect', 'arm', 'calibrate', 'stand', 'forward'):
            self.assertFalse(any(forbidden in name for name in exposed), forbidden)
        self.assertIn('cannot connect, calibrate, arm or stand', SYSTEM_PROMPT)


if __name__ == '__main__':
    unittest.main()

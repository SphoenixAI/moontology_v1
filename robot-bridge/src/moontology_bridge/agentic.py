"""dimOS agentic blueprint for Moontology.

An LLM (dimOS ``McpClient``) reasons over the live scene ontology and the
robot's measured status, then acts only through the existing fail-closed Air
control API (``moontology_bridge.air_demo`` on 127.0.0.1:8766).

Boundary: the agent can observe, look through the camera, start the bounded
excavator mission and STOP. It cannot connect, calibrate, arm, stand, or
change robot services; those remain explicit operator CLI actions. Every
skill result comes from measured bridge/map state, never from assumptions.

Run: ``scripts/air-demo agent`` (see ``main`` below for options).
External MCP clients (Cursor, Claude Code) can attach to
``http://127.0.0.1:9990/mcp`` and reason with the same tools.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dimos.agents.annotation import skill
from dimos.agents.skill_result import SkillResult
from dimos.core.module import Module, ModuleConfig

from .air_atlas import SceneAtlas

MISSION = 'Go inspect the lunar excavator and ready it for operations.'
DEFAULT_MODEL = os.getenv('MOONTOLOGY_AGENT_MODEL', 'gpt-4o')

SYSTEM_PROMPT = """
You are the reasoning layer of Moontology, a lunar-base robotics demo. A real
Unitree Go2 (called "Go2") is mirrored into a Three.js scene whose ontology you
can read. You think, plan and explain; the physical controller enforces safety.

# HARD RULES
- Human safety first. If anything looks wrong, call `stop_robot` immediately.
- Never claim a physical result you did not read back from `robot_status`,
  `observe_scene` or a skill result. Measured telemetry is the only truth.
- You cannot connect, calibrate, arm or stand the robot. Those are operator
  CLI actions. When `robot_status` reports blockers, tell the operator exactly
  which command they must run; do not try to work around a gate.
- The scene's entities, distances and affordances are map semantics. Baked
  splat features and unregistered objects are unknown, not free space.

# HOW TO WORK
1. Call `observe_scene` to read the ontology (entities, states, valid actions,
   Go2 pose and mission phase) and `robot_status` to read the measured robot
   state, active hardware faults and what currently blocks motion.
2. Reason about the request against those facts. Say what you infer and why.
3. Physical motion skills, all refused unless the operator has armed the bridge:
   `run_excavator_mission` (rover-1: approach -> inspect -> activate -> verify),
   `traverse_leg` (the next pre-planned scene-atlas leg; one arm per leg) and
   `navigate_toward` (a few bounded steps toward any entity/region). Report
   each SkillResult verbatim; the measured report is the only outcome.
4. Use `look` to see the real camera when the operator asks what is in front
   of the robot or before recommending motion.
5. Be concise and factual. Distinguish "map/virtual" from "physical/measured".

# SCENE ATLAS (pre-mapped; call `scene_atlas` for the full plan)
The scene is pre-mapped so you do not relearn it: every entity carries a
`mobility` class (static / animated_in_place / patrol / agent / door), an
ontology `sequence_label` (H-01 .. H-08, the humanoid reasoning order) and,
for authored objects, `displacement_from_expected` (how far the live object
sits from where the atlas expects it). Reasoning pattern for every target:
what should be happening -> what the asset reports -> what Go2 physically
observes -> what the base should now believe -> what changes elsewhere.
Rules: mobile entities (animated_in_place, patrol) are re-observed before any
approach; a non-zero displacement of a static asset is evidence, not noise;
`scene_drift` compares the live scene with the atlas in one call.
"""


def atlas_prompt_block(map_url: str) -> str:
    """Append the committed/served atlas brief to the system prompt when it can be read."""
    try:
        return '\n# ATLAS BRIEF\n' + SceneAtlas.load(map_url).agent_brief() + '\n'
    except Exception as error:
        return f'\n# ATLAS BRIEF\nunavailable at startup ({error}); call `scene_atlas`.\n'


class CameraFrame:
    """JPEG wrapper the MCP server forwards to the LLM as an image."""

    def __init__(self, jpeg: bytes, age_ms: float) -> None:
        self.jpeg = jpeg
        self.age_ms = age_ms

    def agent_encode(self) -> list[dict[str, Any]]:
        return [
            {'type': 'text', 'text': f'Live Go2 front camera frame, receipt age {self.age_ms:.0f} ms.'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(self.jpeg).decode()}},
        ]

    def __str__(self) -> str:
        return f'CameraFrame({len(self.jpeg)} bytes, {self.age_ms:.0f} ms)'


class MoontologySkillsConfig(ModuleConfig):
    control_url: str = 'http://127.0.0.1:8766'
    map_url: str = 'http://127.0.0.1:5173/api/map'
    mission_timeout_s: float = 100.0


def _http(url: str, body: dict | None = None, timeout: float = 5.0) -> Any:
    req = Request(url, data=None if body is None else json.dumps(body).encode(),
                  headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=timeout) as response:
            if response.headers.get('Content-Type', '').startswith('image/'):
                return response.read()
            return json.load(response)
    except HTTPError as error:
        try:
            payload = json.load(error)
        except Exception:
            payload = {'error': str(error)}
        raise RuntimeError(payload.get('error', str(payload))) from error
    except (URLError, TimeoutError, ConnectionError) as error:
        raise RuntimeError(f'unreachable: {url} ({type(error).__name__})') from error


def summarize_observation(obs: dict) -> dict:
    """Compact, LLM-sized view of one map observation (never the raw 10 kB)."""
    pose = obs.get('robot_pose') or {}
    entities = []
    for e in obs.get('entities') or []:
        displacement = e.get('displacement_from_expected')
        entities.append({k: e.get(k) for k in ('id', 'type', 'state', 'currently_valid_actions',
                                                'object_affordances', 'interactable', 'visible',
                                                'mobility', 'sequence_label', 'atlas_role') if k in e}
                        | {'distance_m': round(e['distance_from_robot'], 2) if isinstance(e.get('distance_from_robot'), (int, float)) else None,
                           'bearing_deg': round(math.degrees(e['bearing']), 1) if isinstance(e.get('bearing'), (int, float)) else None,
                           'world_position': e.get('world_position'),
                           'displacement_from_expected_units': round(displacement, 2) if isinstance(displacement, (int, float)) else None,
                           'mobile': e.get('mobility') in ('animated_in_place', 'patrol')})
    layout = obs.get('layout') or {}
    robot_state = layout.get('robotState') or {}
    return {
        'scene_session_id': obs.get('scene_session_id'), 'scene_revision': obs.get('scene_revision'),
        'observation_sequence': obs.get('observation_sequence'), 'active_world': obs.get('active_world'),
        'map_ready': obs.get('map_ready'),
        'go2_pose': {k: (round(v, 3) if isinstance(v, float) else v) for k, v in pose.items()},
        'mission_state': obs.get('mission_state'),
        'entities': entities,
        'map_physical_hold': robot_state.get('physicalHold'), 'map_blocked_reason': robot_state.get('blockedReason'),
        'unknown_areas': layout.get('unknownAreas'), 'obstacle_count': len(layout.get('obstacles') or []),
        'presentation_visible': (obs.get('performance') or {}).get('visible'),
        'go2_joint_source': pose.get('joint_source'),
        'humanoid_sequence_present': sorted({e['sequence_label'] for e in entities if e.get('sequence_label')}),
        'mobile_entity_ids': [e['id'] for e in entities if e.get('mobile')],
        'note': 'Distances/bearings are scene-map semantics relative to the Go2 map pose; states are ontology states, not physical proof. '
                'mobility/sequence_label/displacement_from_expected come from the scene atlas (public/scene-atlas.json).',
    }


def motion_blockers(status: dict) -> list[str]:
    """Explain, from measured status only, why the bridge would refuse motion now."""
    blockers = []
    if status.get('mode') != 'live':
        blockers.append('bridge is in replay mode (software rehearsal, no hardware)')
    if status.get('hardware_hold'):
        blockers.append('runtime.local/hardware-hold.json is present: operator recovery required')
    if not status.get('controller_ready'):
        blockers.append('no ready live controller: operator must run `scripts/air-demo connect --robot-ip <IP> --sole-controller-confirmed` with Go2 standing')
    if status.get('telemetry_only'):
        blockers.append('telemetry-only connection: motor publications disabled')
    if status.get('posture_only'):
        blockers.append('posture-only connection: walking rejected until operator arms with --recover')
    errors = (status.get('robot_errors') or {}).get('active') or []
    for e in errors:
        if e.get('blocking'):
            blockers.append(f"robot hardware fault {e.get('label')}: {e.get('description')} (let it cool/clear; the robot ignores posture commands meanwhile)")
    if status.get('source_fault'):
        blockers.append(f"latched telemetry fault `{status['source_fault']}`: operator must run `scripts/air-demo reset` then `calibrate`")
    if not status.get('calibrated'):
        blockers.append('no measured origin: operator must run `scripts/air-demo calibrate --scale 40`')
    if not status.get('armed'):
        blockers.append('not armed: operator must run `scripts/air-demo arm --clear-lane --robot-standing` after clearing the lane')
    sensors = status.get('physical_sensors') or {}
    if sensors:
        if sensors.get('onboard_avoidance_enabled') is not True:
            blockers.append('onboard obstacle avoidance not confirmed enabled')
        for key, limit in (('lidar_age_ms', 500), ('camera_age_ms', 1500)):
            age = sensors.get(key)
            if not isinstance(age, (int, float)) or age > limit:
                blockers.append(f'{key}={age} exceeds {limit} ms or missing')
        obstacles = sensors.get('obstacles') or {}
        if isinstance(obstacles, dict) and (obstacles.get('forward_blocked') or obstacles.get('rotation_blocked')):
            blockers.append(f'LiDAR veto: {json.dumps(obstacles)[:200]}')
    return blockers


def summarize_status(status: dict) -> dict:
    sensors = status.get('physical_sensors') or {}
    return {
        'mode': status.get('mode'), 'controller_ready': status.get('controller_ready'),
        'controller_mode': status.get('controller_mode'), 'body_height_m': status.get('body_height_m'),
        'armed': status.get('armed'), 'calibrated': status.get('calibrated'), 'scale': status.get('scale'),
        'running_mission': status.get('running'), 'posture_only': status.get('posture_only'),
        'telemetry_only': status.get('telemetry_only'), 'hardware_hold': status.get('hardware_hold'),
        'source_fault': status.get('source_fault'), 'stop_reason': status.get('stop_reason'),
        'raw_odometry': status.get('raw_odometry'), 'odometry_timing': status.get('odometry_timing'),
        'robot_errors': (status.get('robot_errors') or {}).get('active'),
        'sensors': {k: sensors.get(k) for k in ('lidar_age_ms', 'lidar_points', 'camera_age_ms',
                                                'onboard_avoidance_enabled', 'obstacles', 'scope') if k in sensors},
        'physical_travel_m': status.get('physical_travel_m'), 'actions': status.get('actions'),
        'what_blocks_physical_motion': motion_blockers(status),
    }


def summarize_traverse(report: dict | None) -> dict | None:
    """Compact view of one traverse-leg report (kind traverse_leg) from the bridge."""
    if not report or report.get('kind') != 'traverse_leg':
        return None
    navigate = report.get('navigate') or {}
    final = navigate.get('final') or {}
    return {
        'scene': report.get('scene'), 'leg': report.get('leg'), 'target': report.get('target'), 'leg_kind': report.get('leg_kind'),
        'sequence_label': report.get('sequence_label'), 'mobile_target': report.get('mobile_target'), 'purpose': report.get('purpose'),
        'success': report.get('success'), 'arrived': report.get('arrived'), 'error': report.get('error'), 'note': report.get('note'),
        'pre_check': {k: v for k, v in (report.get('pre_check') or {}).items() if k in ('mobile', 'restaged', 'displacement_units', 'distance_units')},
        'steps': navigate.get('steps'), 'stopped_by': navigate.get('stopped_by'), 'arrival_kind': navigate.get('arrival_kind'),
        'final_distance_units': round(final['distance'], 2) if isinstance(final.get('distance'), (int, float)) else None,
        'final_bearing_deg': round(math.degrees(final['bearing']), 1) if isinstance(final.get('bearing'), (int, float)) else None,
        'faced_target': bool((navigate.get('face') or {}).get('pulses')),
        'interactions': [{'action': i.get('action'), 'state': i.get('state'), 'skipped': i.get('skipped')} for i in report.get('interactions') or []],
        'physical_travel_m': report.get('physical_travel_m'), 'elapsed_seconds': report.get('elapsed_seconds'),
        'progress': report.get('progress'),
    }


def summarize_report(report: dict | None) -> dict | None:
    if not report:
        return None
    actions = report.get('actions') or []
    return {
        'success': report.get('success'), 'error': report.get('error'), 'mode': report.get('mode'),
        'elapsed_seconds': report.get('elapsed_seconds'), 'action_count': len(actions),
        'action_sequence': [a.get('action') for a in actions][-12:],
        'physical_travel_m': report.get('physical_travel_m'), 'physical_yaw_travel_rad': report.get('physical_yaw_travel_rad'),
        'final_target_state': next((e.get('state') for e in ((report.get('final_observation') or {}).get('entities') or [])
                                    if e.get('id') == 'rover-1'), None),
    }


class MoontologySkills(Module):
    """Skills the dimOS agent may call. Read-mostly; motion only through gated bridge endpoints."""

    config: MoontologySkillsConfig

    def _control(self, path: str, body: dict | None = None, timeout: float = 5.0) -> Any:
        return _http(self.config.control_url + path, body, timeout)

    @skill
    def observe_scene(self) -> str:
        """Read the live Moontology scene ontology: Go2 map pose, mission phase, every entity with its
        state, distance, bearing and currently valid actions, plus map holds. Call this first."""
        try:
            result = _http(self.config.map_url + '/observation')
            return json.dumps(summarize_observation(result['observation']))
        except Exception as error:
            return json.dumps({'error': f'scene unavailable: {error}'})

    @skill
    def robot_status(self) -> str:
        """Read the measured Go2/bridge state: connection, posture height, arming, calibration, latched
        faults, active robot hardware errors, sensor freshness and an explicit list of what blocks motion."""
        try:
            return json.dumps(summarize_status(self._control('/status')))
        except Exception as error:
            return json.dumps({'error': f'bridge unavailable: {error}', 'what_blocks_physical_motion':
                               ['Air bridge is not running: operator must run `scripts/air-demo start --live`']})

    @skill
    def scene_atlas(self, scene: str = 'SCENE_1') -> str:
        """Read the pre-mapped scene atlas the bridge reasons with: every entity's mobility class and
        H-01..H-08 sequence label, expected positions, the planned route legs (target, purpose, standoff,
        interactions), regions and known pitfalls. Read-only; call before planning any traverse."""
        try:
            return json.dumps(self._control(f'/atlas?scene={scene}'))
        except Exception as bridge_error:
            try:
                return json.dumps(SceneAtlas.load(self.config.map_url).summary(scene) | {'bridge': f'unavailable: {bridge_error}'})
            except Exception as error:
                return json.dumps({'error': f'scene atlas unavailable: {error}'})

    @skill
    def scene_drift(self) -> str:
        """Compare the live scene with the atlas: re-staged mobile assets, static assets displaced from
        their authored position, missing or unexpected ids. This is the 'reported vs observed' check."""
        try:
            return json.dumps(self._control('/drift'))
        except Exception as bridge_error:
            try:
                observation = _http(self.config.map_url + '/observation')['observation']
                return json.dumps(SceneAtlas.load(self.config.map_url).compare(observation) | {'bridge': f'unavailable: {bridge_error}'})
            except Exception as error:
                return json.dumps({'error': f'scene drift unavailable: {error}'})

    @skill(uses=['movement'])
    def traverse_leg(self, scene: str = 'SCENE_1', leg: int | None = None, max_steps: int = 6) -> SkillResult:
        """Run ONE pre-planned scene-atlas leg (default: the next unfinished leg of the scene) and wait for
        it to finish: re-observe a mobile target first, walk bounded steps to its standoff ring, turn to
        face it, run its ontology interactions (rover-1: inspect/activate/verify). One operator arm covers
        one leg. Returns the measured leg report; never assume arrival without it."""
        try:
            status = self._control('/status')
        except Exception as error:
            return SkillResult.fail('NOT_CONFIGURED', f'bridge unavailable: {error}')
        blockers = motion_blockers(status)
        if blockers:
            return SkillResult.fail('INVALID_STATE', 'refused before sending anything: ' + ' | '.join(blockers))
        started = time.monotonic()
        try:
            accepted = self._control('/traverse', {'scene': scene, 'leg': leg, 'max_steps': int(max_steps), 'face_target': True})
        except Exception as error:
            return SkillResult.fail('EXECUTION_FAILED', f'bridge rejected traverse leg: {error}')
        deadline = started + self.config.mission_timeout_s
        while time.monotonic() < deadline:
            time.sleep(0.5)
            try:
                status = self._control('/status')
            except Exception as error:
                return SkillResult.fail('EXECUTION_FAILED', f'lost bridge during traverse: {error}')
            if not status.get('running'):
                break
        else:
            try:
                self._control('/stop', {})
            except Exception:
                pass
            return SkillResult.fail('EXECUTION_TIMEOUT', 'traverse leg exceeded timeout; STOP requested')
        report = summarize_traverse(status.get('report')) or {'accepted': accepted, 'report': None}
        if report.get('success'):
            return SkillResult.ok(f"leg {report.get('leg')} -> {report.get('target')} ({report.get('sequence_label') or report.get('leg_kind')}): "
                                  f"arrived={report.get('arrived')} steps={report.get('steps')} stopped_by={report.get('stopped_by')}", **report)
        return SkillResult.fail('EXECUTION_FAILED', json.dumps(report | {'stop_reason': status.get('stop_reason'), 'source_fault': status.get('source_fault')}))

    @skill
    def look(self) -> Any:
        """Return the current real Go2 front-camera frame (fails when no fresh physical camera)."""
        started = time.monotonic()
        try:
            jpeg = self._control('/camera.jpg')
        except Exception as error:
            return SkillResult.fail('INVALID_STATE', f'no fresh physical camera frame: {error}')
        if not isinstance(jpeg, (bytes, bytearray)):
            return SkillResult.fail('EXECUTION_FAILED', 'camera endpoint returned no image')
        return CameraFrame(bytes(jpeg), (time.monotonic() - started) * 1000)

    @skill
    def mission_report(self) -> str:
        """Summarize the most recent mission or forward-test report recorded by the bridge."""
        try:
            return json.dumps(summarize_report(self._control('/status').get('report')) or {'report': None})
        except Exception as error:
            return json.dumps({'error': str(error)})

    @skill(uses=['movement'])
    def run_excavator_mission(self) -> SkillResult:
        """Start the bounded physical/virtual excavator mission (approach rover-1, inspect, activate, verify)
        and wait for it to finish. Refused unless the operator has connected, calibrated and armed the bridge.
        Returns the measured outcome; never assume success without it."""
        try:
            status = self._control('/status')
        except Exception as error:
            return SkillResult.fail('NOT_CONFIGURED', f'bridge unavailable: {error}')
        blockers = motion_blockers(status)
        if blockers:
            return SkillResult.fail('INVALID_STATE', 'refused before sending anything: ' + ' | '.join(blockers))
        started = time.monotonic()
        try:
            self._control('/mission', {'instruction': MISSION})
        except Exception as error:
            return SkillResult.fail('EXECUTION_FAILED', f'bridge rejected mission: {error}')
        deadline = started + self.config.mission_timeout_s
        while time.monotonic() < deadline:
            time.sleep(0.5)
            try:
                status = self._control('/status')
            except Exception as error:
                return SkillResult.fail('EXECUTION_FAILED', f'lost bridge during mission: {error}')
            if not status.get('running'):
                break
        else:
            try:
                self._control('/stop', {})
                stop_note = 'STOP sent'
            except Exception as error:
                stop_note = f'STOP not confirmed: {error}; operator must use the remote STOP'
            return SkillResult.fail('EXECUTION_TIMEOUT', f'mission exceeded timeout; {stop_note}')
        report = summarize_report(status.get('report')) or {}
        if report.get('success'):
            return SkillResult.ok('Excavator mission VERIFIED (measured)', **report, elapsed_ms=(time.monotonic()-started)*1000)
        return SkillResult.fail('EXECUTION_FAILED', json.dumps({'report': report, 'stop_reason': status.get('stop_reason'),
                                                                'source_fault': status.get('source_fault')}))

    @skill(uses=['movement'])
    def navigate_toward(self, target_id: str, max_steps: int = 3) -> SkillResult:
        """Take at most max_steps (1..12) bounded, measured steps toward a map target and stop.
        target_id is any entity id from observe_scene (e.g. 'H04', 'digging-bot', 'rover-1') or a layout
        region id (e.g. 'Building-West'). Each step is vetoed by live LiDAR if the real room is blocked.
        Returns the measured heading/distance change; call again to continue. Requires an armed bridge."""
        try:
            status = self._control('/status')
        except Exception as error:
            return SkillResult.fail('NOT_CONFIGURED', f'bridge unavailable: {error}')
        blockers = motion_blockers(status)
        if blockers:
            return SkillResult.fail('INVALID_STATE', 'refused before sending anything: ' + ' | '.join(blockers))
        started = time.monotonic()
        try:
            self._control('/navigate', {'target_id': str(target_id), 'max_steps': int(max_steps)})
        except Exception as error:
            return SkillResult.fail('EXECUTION_FAILED', f'bridge rejected navigation: {error}')
        deadline = started + self.config.mission_timeout_s
        while time.monotonic() < deadline:
            time.sleep(0.5)
            try:
                status = self._control('/status')
            except Exception as error:
                return SkillResult.fail('EXECUTION_FAILED', f'lost bridge during navigation: {error}')
            if not status.get('running'):
                break
        else:
            try:
                self._control('/stop', {})
            except Exception:
                pass
            return SkillResult.fail('EXECUTION_TIMEOUT', 'navigation exceeded timeout; STOP requested')
        report = status.get('report') or {}
        summary = {k: report.get(k) for k in ('target_id', 'success', 'stopped_by', 'steps', 'initial', 'final',
                                              'bearing_improvement_rad', 'distance_change_m', 'physical_travel_m',
                                              'physical_yaw_travel_rad')}
        sensors = report.get('physical_sensors') or {}
        summary['room'] = {'nearest_forward_m': (sensors.get('obstacles') or {}).get('nearest_forward_m'),
                           'forward_blocked': (sensors.get('obstacles') or {}).get('forward_blocked'),
                           'onboard_avoidance_enabled': sensors.get('onboard_avoidance_enabled')}
        if report.get('success'):
            return SkillResult.ok(f"{report.get('steps')} step(s) toward {target_id}; stopped by {report.get('stopped_by')}", **summary)
        return SkillResult.fail('EXECUTION_FAILED', json.dumps(summary))

    @skill
    def stop_robot(self) -> SkillResult:
        """Immediately STOP and disarm the robot through the bridge. Always allowed; use on any doubt."""
        try:
            status = self._control('/stop', {}, timeout=5)
            return SkillResult.ok('STOP sent; bridge disarmed', armed=status.get('armed'), stop_reason=status.get('stop_reason'))
        except Exception as error:
            return SkillResult.fail('EXECUTION_FAILED', f'STOP not confirmed by bridge: {error}. Operator must use the remote STOP.')


def build_blueprint(model: str | None = DEFAULT_MODEL, web_input: bool = False,
                    control_url: str = 'http://127.0.0.1:8766', map_url: str = 'http://127.0.0.1:5173/api/map'):
    """Skills + MCP server always; the in-process LLM client only when a model is given."""
    from dimos.agents.mcp.mcp_server import McpServer
    from dimos.core.coordination.blueprints import autoconnect

    parts = [MoontologySkills.blueprint(control_url=control_url, map_url=map_url), McpServer.blueprint()]
    if model:
        from dimos.agents.mcp.mcp_client import McpClient
        parts.append(McpClient.blueprint(model=model, system_prompt=SYSTEM_PROMPT + atlas_prompt_block(map_url)))
    if web_input:
        from dimos.agents.web_human_input import WebInput
        parts.append(WebInput.blueprint())
    return autoconnect(*parts)


def check_model(model: str | None) -> str:
    """Fail early with an actionable message instead of a stack trace mid-startup."""
    if not model:
        return 'MCP tools only (attach Cursor/Claude Code to http://127.0.0.1:9990/mcp)'
    if model.startswith('ollama:'):
        host = os.getenv('OLLAMA_HOST', 'http://127.0.0.1:11434')
        try:
            with urlopen(host.rstrip('/') + '/api/tags', timeout=2) as response:
                names = [m.get('name') for m in json.load(response).get('models', [])]
        except Exception as error:
            raise SystemExit(f'Ollama is not reachable at {host} ({type(error).__name__}). Install it from https://ollama.com, '
                             f'run `ollama serve`, then `ollama pull {model.split(":",1)[1]}`.') from error
        wanted = model.split(':', 1)[1]
        if names and not any(n == wanted or n.split(':')[0] == wanted.split(':')[0] for n in names):
            raise SystemExit(f'Ollama has {names}; run `ollama pull {wanted}` first.')
        return f'local Ollama model {wanted}'
    if ':' not in model or model.startswith('openai:'):
        if not os.getenv('OPENAI_API_KEY'):
            raise SystemExit('OPENAI_API_KEY is not set. Export it in this shell (never commit it), '
                             'or use --model ollama:<name>, or --no-llm to expose MCP tools for Cursor/Claude Code.')
        return f'OpenAI model {model}'
    return f'LangChain model {model}'


def multicast_route_present() -> bool | None:
    """dimOS modules talk over LCM multicast; macOS needs 224.0.0.0/4 routed to lo0.

    Returns None when the routing table cannot be read (sandboxed shells)."""
    if sys.platform != 'darwin':
        return True
    try:
        import subprocess
        table = subprocess.run(['netstat', '-nr'], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    return any(('224.0.0.0/4' in line or '224.0.0/4' in line) and 'lo0' in line for line in table.splitlines())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description='Moontology dimOS reasoning agent (skills + MCP + optional LLM)')
    parser.add_argument('--model', default=DEFAULT_MODEL,
                        help='LangChain model id for dimOS McpClient, e.g. gpt-4o or ollama:qwen3:8b (env MOONTOLOGY_AGENT_MODEL)')
    parser.add_argument('--no-llm', action='store_true', help='Expose skills over MCP only; reason from Cursor/Claude Code')
    parser.add_argument('--web-input', action='store_true', help='Also start the dimOS web/voice input at http://localhost:5555')
    parser.add_argument('--control-url', default='http://127.0.0.1:8766')
    parser.add_argument('--map-url', default='http://127.0.0.1:5173/api/map')
    args = parser.parse_args(argv)
    model = None if args.no_llm else args.model
    route = multicast_route_present()
    print(json.dumps({'service': 'moontology-agent', 'reasoning': check_model(model), 'mcp': 'http://127.0.0.1:9990/mcp',
                      'control': args.control_url, 'map': args.map_url, 'physical_gates': 'operator CLI only',
                      'lcm_multicast_route': 'ok' if route else ('unknown' if route is None else
                          'missing: dimOS will ask for sudo, or run `sudo route -n add -net 224.0.0.0/4 -interface lo0` first')}), flush=True)
    from dimos.core.coordination.module_coordinator import ModuleCoordinator
    ModuleCoordinator.build(build_blueprint(model, args.web_input, args.control_url, args.map_url)).loop()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except SystemExit as error:
        if error.code and not isinstance(error.code, int):
            print(json.dumps({'error': str(error.code)}), file=sys.stderr)
            sys.exit(1)
        raise

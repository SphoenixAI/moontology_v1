"""Boot-time self-check for a Moontology Go2 session.

Runs every check that does not need the robot to move and reports, per check,
whether it passed, whether it is required for a live session, what was
measured and the exact command that fixes it. Nothing here connects to the
robot's transport or changes state; it only reads.

    scripts/air-demo preflight [--robot-ip 192.168.x.y] [--scene SCENE_1] [--skip-atlas-build-check]

Exit status is 1 when a *required* check fails, so it can gate a runbook.
Results are also written to runtime.local/preflight.json.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

from .air_atlas import SceneAtlas, COMMITTED

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'runtime.local'


def _get(url: str, timeout: float = 2.0):
    with urlopen(url, timeout=timeout) as response:
        return json.load(response)


class Preflight:
    def __init__(self, map_url: str, control_url: str, scene: str = 'SCENE_1', robot_ip: str | None = None,
                 check_atlas_build: bool = True) -> None:
        self.map_url = map_url.rstrip('/')
        self.control_url = control_url.rstrip('/')
        self.scene = scene
        self.robot_ip = robot_ip
        self.check_atlas_build = check_atlas_build
        self.checks: list[dict] = []
        self.observation: dict | None = None
        self.atlas: SceneAtlas | None = None

    def record(self, name: str, ok: bool | None, required: bool, detail, fix: str | None = None) -> None:
        self.checks.append({'name': name, 'ok': ok, 'required': required, 'detail': detail, 'fix': None if ok else fix})

    # ----------------------------------------------------------------- checks
    def versions(self, check_versions) -> None:
        try:
            self.record('python_and_pinned_deps', True, True, {**check_versions(), 'python': sys.version.split()[0]})
        except Exception as error:  # noqa: BLE001
            self.record('python_and_pinned_deps', False, True, str(error),
                        'Use the preserved venv: MOONTOLOGY_ROBOT_PYTHON=~/moontology-robot/.venv/bin/python (dimos 0.0.13.post1, unitree-webrtc-connect 2.2.0, Python 3.12)')

    def map_server(self) -> None:
        try:
            health = _get(self.map_url + '/health')
        except Exception as error:  # noqa: BLE001
            self.record('map_server', False, True, f'{self.map_url}/health unreachable ({type(error).__name__})',
                        'Start the map: `npm run dev -- --host 127.0.0.1` (or `scripts/air-demo start --live` which starts it)')
            return
        detail = {k: health.get(k) for k in ('publisher_connected', 'publisher_age_ms', 'authoritative_browser', 'command_transport')}
        if not health.get('publisher_connected'):
            self.record('map_publisher_browser', False, True, detail,
                        f'Open {self.map_url.split("/api/")[0]}/ in a browser tab and keep it visible; it publishes the scene to the relay')
        else:
            self.record('map_publisher_browser', True, True, detail)
        try:
            self.observation = _get(self.map_url + '/observation')['observation']
        except Exception as error:  # noqa: BLE001
            self.record('map_observation', False, True, f'no observation ({type(error).__name__})',
                        'Reload the map tab; the relay has no live observation yet')
            return
        obs = self.observation
        performance = obs.get('performance') or {}
        ok = bool(obs.get('map_ready')) and performance.get('visible') is True and isinstance(performance.get('render_age_ms'), (int, float)) and performance['render_age_ms'] <= 750
        self.record('map_observation', ok, True,
                    {'map_ready': obs.get('map_ready'), 'active_world': obs.get('active_world'), 'visible': performance.get('visible'),
                     'render_age_ms': performance.get('render_age_ms'), 'fps': performance.get('fps'), 'entities': len(obs.get('entities') or []),
                     'scene_session_id': obs.get('scene_session_id'), 'physical_hold': ((obs.get('layout') or {}).get('robotState') or {}).get('physicalHold')},
                    'Bring the map tab to the foreground (render_age must stay < 750 ms) and wait for map_ready')
        # active_world is "SCENE_1:<variant>:<level>"; the atlas keys on the scene prefix.
        if obs.get('active_world') and str(obs['active_world']).split(':')[0] != self.scene:
            self.record('active_world_matches_scene', False, True, {'active_world': obs['active_world'], 'wanted': self.scene},
                        'Reload the map on the Scene 1 exterior (the route legs are planned for SCENE_1)')
        else:
            self.record('active_world_matches_scene', True, True, {'active_world': obs.get('active_world')})

    def scene_atlas(self) -> None:
        try:
            self.atlas = SceneAtlas.load(self.map_url)
        except Exception as error:  # noqa: BLE001
            self.record('scene_atlas', False, True, str(error), 'node scripts/build-scene-atlas.mjs')
            return
        detail = {'source': self.atlas.source, 'generated_at': self.atlas.generated_at, 'runnable_scenes': self.atlas.runnable_scenes(),
                  'mobile_ids': self.atlas.mobile_ids(), 'legs': [f"{l['index']}:{l['target']}" for l in self.atlas.legs(self.scene)]}
        try:
            committed = json.loads(COMMITTED.read_text()).get('generated_at')
        except Exception:  # noqa: BLE001
            committed = None
        served_matches = committed == self.atlas.generated_at
        self.record('scene_atlas', True, True, detail)
        self.record('served_atlas_matches_repo', served_matches, False, {'served': self.atlas.generated_at, 'committed': committed},
                    'The map serves a different atlas than the repo file: restart Vite or rebuild `node scripts/build-scene-atlas.mjs`')
        if self.observation and not self.observation.get('map_ready'):
            self.record('atlas_vs_live_scene', None, True, 'skipped: map still loading (no entities yet)')
        elif self.observation:
            drift = self.atlas.compare(self.observation)
            problems = drift['missing'] or drift['drifted_static']
            self.record('atlas_vs_live_scene', not problems, True,
                        {k: drift[k] for k in ('matched', 'restaged_mobile', 'drifted_static', 'missing', 'unexpected')},
                        'Static assets moved or vanished relative to the atlas: rebuild it (`node scripts/build-scene-atlas.mjs`) or restore the scene')
            if drift['restaged_mobile']:
                self.record('mobile_assets_restaged', None, False, drift['restaged_mobile'],
                            'Informational: mobile humanoids/rovers are away from their authored stops; legs re-observe them before approaching')
        if self.check_atlas_build:
            try:
                started = time.monotonic()
                result = subprocess.run(['node', 'scripts/build-scene-atlas.mjs', '--check', '--map-url', self.map_url], cwd=ROOT,
                                        capture_output=True, text=True, timeout=90)
                ok = result.returncode == 0
                tail = (result.stdout or result.stderr).strip().splitlines()[-3:]
                self.record('atlas_build_check', ok, False, {'seconds': round(time.monotonic() - started, 1), 'output_tail': tail},
                            'Sources changed since the atlas was generated: `node scripts/build-scene-atlas.mjs`')
            except Exception as error:  # noqa: BLE001
                self.record('atlas_build_check', False, False, str(error), 'Install Node (>=20) and run `npm install` in the repo root')

    def bridge(self) -> None:
        try:
            status = _get(self.control_url + '/status', timeout=1.5)
        except Exception as error:  # noqa: BLE001
            self.record('bridge_running', False, False, f'{self.control_url} unreachable ({type(error).__name__})',
                        'scripts/air-demo start --live   (replay rehearsal: scripts/air-demo start --replay)')
            return
        self.record('bridge_running', status.get('service') == 'moontology-air-demo', True,
                    {k: status.get(k) for k in ('mode', 'controller_ready', 'calibrated', 'armed', 'physical_execution_available',
                                                'hardware_hold', 'telemetry_only', 'posture_only', 'source_fault', 'stop_reason', 'controller_mode')},
                    'Port 8766 is occupied by another service')
        atlas = status.get('atlas') or {}
        self.record('bridge_atlas_loaded', bool(atlas.get('loaded')), False, atlas,
                    'The bridge loads the atlas at `calibrate`; it will also load lazily on the first `traverse`/`atlas` call')
        if atlas.get('loaded') and self.atlas is not None:
            self.record('bridge_atlas_is_current', atlas.get('generated_at') == self.atlas.generated_at, False,
                        {'bridge': atlas.get('generated_at'), 'served': self.atlas.generated_at},
                        'The running bridge holds an older atlas than the map serves: run `scripts/air-demo calibrate ...` again (it reloads the atlas) or restart the bridge')
        errors = ((status.get('robot_errors') or {}).get('active')) or []
        blocking = [e for e in errors if e.get('blocking')]
        if status.get('controller_ready'):
            self.record('robot_hardware_faults', not blocking, True, errors or 'none',
                        'Let the motors cool / clear the fault; posture commands are ignored while a blocking fault is active')
            sensors = status.get('physical_sensors') or {}
            if sensors:
                lidar_ok = isinstance(sensors.get('lidar_age_ms'), (int, float)) and sensors['lidar_age_ms'] <= 500
                self.record('lidar_fresh', lidar_ok, True, {k: sensors.get(k) for k in ('lidar_age_ms', 'lidar_points', 'camera_age_ms', 'onboard_avoidance_enabled')},
                            'scripts/air-demo enable-lidar  then  scripts/air-demo enable-sensing')

    def hardware_hold(self) -> None:
        hold = RUNTIME / 'hardware-hold.json'
        detail = json.loads(hold.read_text()) if hold.exists() else 'absent'
        self.record('no_hardware_hold', not hold.exists(), True, detail,
                    'A prior session latched a hardware hold; recover explicitly with `scripts/air-demo arm --recover ...` after the cause is fixed')

    def controller_lock(self) -> None:
        lock = RUNTIME / 'controller.lock'
        if not lock.exists():
            self.record('controller_lock', True, False, 'no lock file (no bridge has run yet)')
            return
        import fcntl
        with open(lock, 'a+') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(handle, fcntl.LOCK_UN)
                self.record('controller_lock', True, False, 'free (no bridge process holds it)')
            except BlockingIOError:
                self.record('controller_lock', True, False, 'held by the running bridge process (expected while it is up)')

    def multicast_route(self) -> None:
        if sys.platform != 'darwin':
            self.record('lcm_multicast_route', True, False, 'not macOS')
            return
        try:
            table = subprocess.run(['netstat', '-nr'], capture_output=True, text=True, timeout=5).stdout
        except Exception as error:  # noqa: BLE001
            self.record('lcm_multicast_route', None, False, f'cannot read routing table ({type(error).__name__})')
            return
        present = any(('224.0.0.0/4' in line or '224.0.0/4' in line) and 'lo0' in line for line in table.splitlines())
        self.record('lcm_multicast_route', present, False, 'present' if present else 'missing',
                    'sudo route -n add -net 224.0.0.0/4 -interface lo0   (dimOS agent modules talk over LCM multicast)')

    def lan(self) -> None:
        try:
            ip = subprocess.run(['ipconfig', 'getifaddr', 'en0'], text=True, capture_output=True, timeout=5).stdout.strip()
        except Exception:  # noqa: BLE001
            ip = ''
        self.record('laptop_lan_ip', bool(ip), self.robot_ip is not None, ip or 'en0 has no IPv4',
                    'Join the same private Wi-Fi as the Go2 (see `scripts/air-demo wifi` to provision the robot)')
        if not self.robot_ip:
            self.record('robot_reachable', None, False, 'skipped (pass --robot-ip to test the WebRTC signalling port)')
            return
        started = time.monotonic()
        try:
            with socket.create_connection((self.robot_ip, 9991), timeout=1.5):
                pass
            self.record('robot_reachable', True, True, {'ip': self.robot_ip, 'port': 9991, 'ms': round((time.monotonic() - started) * 1000)})
        except OSError as error:
            self.record('robot_reachable', False, True, {'ip': self.robot_ip, 'port': 9991, 'error': type(error).__name__},
                        'Power the Go2 on, wait for the head LEDs, confirm the IP with `scripts/air-demo discover`')

    def agent_backend(self) -> None:
        model = os.getenv('MOONTOLOGY_AGENT_MODEL', 'gpt-4o')
        if model.startswith('ollama:'):
            host = os.getenv('OLLAMA_HOST', 'http://127.0.0.1:11434')
            try:
                names = [m.get('name') for m in _get(host.rstrip('/') + '/api/tags').get('models', [])]
                self.record('agent_llm_backend', True, False, {'model': model, 'ollama_models': names})
            except Exception as error:  # noqa: BLE001
                self.record('agent_llm_backend', False, False, {'model': model, 'error': type(error).__name__}, 'ollama serve && ollama pull ' + model.split(':', 1)[1])
        else:
            has_key = bool(os.getenv('OPENAI_API_KEY'))
            self.record('agent_llm_backend', has_key, False, {'model': model, 'OPENAI_API_KEY': 'set' if has_key else 'missing'},
                        'export OPENAI_API_KEY=...  or  scripts/air-demo agent --no-llm (reason from Cursor over MCP)')
        mcp = ROOT / '.cursor' / 'mcp.json'
        try:
            configured = 'dimos-moontology' in json.loads(mcp.read_text()).get('mcpServers', {})
        except Exception:  # noqa: BLE001
            configured = False
        self.record('cursor_mcp_configured', configured, False, str(mcp),
                    'Add {"mcpServers":{"dimos-moontology":{"url":"http://127.0.0.1:9990/mcp"}}} to .cursor/mcp.json')

    # -------------------------------------------------------------------- run
    def run(self, check_versions) -> dict:
        started = time.monotonic()
        RUNTIME.mkdir(exist_ok=True)
        for step in (lambda: self.versions(check_versions), self.map_server, self.scene_atlas, self.bridge, self.hardware_hold,
                     self.controller_lock, self.multicast_route, self.lan, self.agent_backend):
            try:
                step()
            except Exception as error:  # noqa: BLE001 - a broken check must not hide the others
                self.record(getattr(step, '__name__', 'check'), False, False, f'check crashed: {error}')
        failed_required = [c['name'] for c in self.checks if c['required'] and c['ok'] is False]
        warnings = [c['name'] for c in self.checks if not c['required'] and c['ok'] is False]
        result = {'ok': not failed_required, 'scene': self.scene, 'map': self.map_url, 'control': self.control_url,
                  'failed_required': failed_required, 'warnings': warnings, 'seconds': round(time.monotonic() - started, 1),
                  'checks': self.checks, 'physical_connection_started': False, 'at': time.time()}
        (RUNTIME / 'preflight.json').write_text(json.dumps(result, indent=2) + '\n')
        return result


def render(result: dict) -> str:
    lines = [f"preflight {'OK' if result['ok'] else 'FAILED'} in {result['seconds']}s — scene {result['scene']}"]
    for c in result['checks']:
        mark = 'PASS' if c['ok'] else ('INFO' if c['ok'] is None else ('FAIL' if c['required'] else 'WARN'))
        detail = c['detail'] if isinstance(c['detail'], str) else json.dumps(c['detail'])
        lines.append(f"  {mark:4} {c['name']:<28} {detail[:160]}")
        if c['fix']:
            lines.append(f"       fix: {c['fix']}")
    return '\n'.join(lines)

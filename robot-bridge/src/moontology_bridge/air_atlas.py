"""Boot-time scene knowledge for the Go2: the generated scene atlas.

``public/scene-atlas.json`` is produced by ``scripts/build-scene-atlas.mjs``
from the same TypeScript sources the map renders (layouts, assets, background
traffic, airlock placement and the ``approachWaypoint`` planner). The bridge
and the dimOS agent load it once at boot so the robot already *recognises* the
environment instead of re-deriving it per scene:

- which entities exist, their API ids, roles and expected positions;
- which of them are **mobile** (``animated_in_place``/``patrol``) and must be
  re-observed before any approach;
- the humanoid reasoning sequence H-01..H-08 with each label's question;
- per-scene route legs with pre-planned standoffs, turn/face angles and path
  lengths, so a live leg starts from a known plan;
- known pitfalls (no-entry shells, unknown terrain, patrol loops, scale).

The atlas is advisory. Every physical step still goes through the live map
planner (``mission approach``), the bounded capability and the LiDAR veto; the
atlas decides *what to look for, in which order and what to expect*.

Load order: the running map server (Vite serves ``/public`` at the site root,
so ``http://127.0.0.1:5173/scene-atlas.json``), then the committed repository
file. Both must agree with the sources; ``build-scene-atlas.mjs --check`` is
the drift guard.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import time
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]
COMMITTED = ROOT / 'public' / 'scene-atlas.json'
# Above this planar displacement (world units) an entity counts as re-staged
# relative to its authored position: ~0.5 body lengths of the Go2 avatar.
RESTAGED_UNITS = 1.0
MOBILE = ('animated_in_place', 'patrol')


def _wrap(rad: float) -> float:
    return (rad + math.pi) % (2 * math.pi) - math.pi


class SceneAtlas:
    def __init__(self, data: dict, source: str) -> None:
        if data.get('atlas_version') != 1:
            raise ValueError(f'unsupported atlas_version: {data.get("atlas_version")!r}')
        self.data = data
        self.source = source
        self.loaded_at = time.time()
        self._by_id: dict[str, dict] = {}
        for entity in data.get('entities', []):
            self._by_id[entity['id']] = entity
            if entity.get('api_id'):
                self._by_id[entity['api_id']] = entity

    # ----------------------------------------------------------------- loading
    @classmethod
    def load(cls, map_url: str | None = None, committed: Path = COMMITTED, timeout: float = 1.5) -> 'SceneAtlas':
        """Prefer the atlas the running map serves (it is what the browser has); fall back to the repo file."""
        errors = []
        if map_url:
            u = urlparse(map_url)
            served = f'{u.scheme}://{u.netloc}/scene-atlas.json'
            try:
                with urlopen(served, timeout=timeout) as response:
                    return cls(json.load(response), served)
            except Exception as error:  # noqa: BLE001 - fall through to the committed copy
                errors.append(f'{served}: {type(error).__name__}')
        try:
            return cls(json.loads(committed.read_text()), str(committed))
        except Exception as error:  # noqa: BLE001
            errors.append(f'{committed}: {type(error).__name__}: {error}')
        raise RuntimeError('scene atlas unavailable: ' + ' | '.join(errors) +
                           ' (run `node scripts/build-scene-atlas.mjs`)')

    # ------------------------------------------------------------------ lookup
    @property
    def generated_at(self) -> str | None:
        return self.data.get('generated_at')

    @property
    def entities(self) -> list[dict]:
        return list(self.data.get('entities', []))

    def entity(self, entity_id: str) -> dict | None:
        return self._by_id.get(entity_id)

    def mobile_ids(self) -> list[str]:
        return [e['api_id'] for e in self.entities if e.get('mobility') in MOBILE]

    def is_mobile(self, entity_id: str) -> bool:
        e = self.entity(entity_id)
        return bool(e and e.get('mobility') in MOBILE)

    @property
    def sequence(self) -> list[dict]:
        return list(self.data.get('humanoid_sequence', []))

    def world(self, scene: str) -> dict | None:
        return (self.data.get('worlds') or {}).get(scene)

    def route(self, scene: str) -> dict | None:
        return (self.data.get('routes') or {}).get(scene)

    def legs(self, scene: str) -> list[dict]:
        return list((self.route(scene) or {}).get('legs') or [])

    def leg(self, scene: str, index: int) -> dict | None:
        return next((l for l in self.legs(scene) if l.get('index') == index), None)

    def pitfalls(self, scene: str | None = None) -> list[dict]:
        return [p for p in self.data.get('pitfalls', []) if scene is None or p.get('scene') == scene]

    def runnable_scenes(self) -> list[str]:
        return [name for name, route in (self.data.get('routes') or {}).items() if route.get('status') == 'runnable']

    # -------------------------------------------------------------- comparison
    def compare(self, observation: dict) -> dict:
        """Live scene versus authored atlas: which entities moved, vanished or appeared.

        Uses the observation's own ``world_position`` so the answer is in the map
        frame the planner uses. Mobile entities are reported separately because
        being displaced is *expected* for them; static displacement is drift.
        """
        observed = {e['id']: e for e in observation.get('entities') or []}
        restaged, drifted, matched, missing = [], [], [], []
        for entity in self.entities:
            api_id = entity.get('api_id') or entity['id']
            if entity.get('mobility') in ('agent', 'door'):
                continue
            live = observed.get(api_id) or observed.get(entity['id'])
            expected = entity.get('expected_position')
            if not live:
                missing.append(api_id)
                continue
            pos = live.get('world_position') or {}
            if not expected or not all(isinstance(pos.get(k), (int, float)) for k in ('x', 'z')):
                matched.append(api_id)
                continue
            displacement = math.hypot(pos['x'] - expected[0], pos['z'] - expected[2])
            record = {'id': api_id, 'mobility': entity.get('mobility'), 'sequence_label': entity.get('sequence_label'),
                      'displacement_units': round(displacement, 3),
                      'expected': [round(expected[0], 3), round(expected[2], 3)], 'observed': [round(pos['x'], 3), round(pos['z'], 3)]}
            if displacement <= RESTAGED_UNITS:
                matched.append(api_id)
            elif entity.get('mobility') in MOBILE:
                restaged.append(record)
            else:
                drifted.append(record)
        known = set(self._by_id)
        unexpected = [i for i in observed if i not in known and (observed[i].get('type') != 'go2')]
        return {'atlas_generated_at': self.generated_at, 'active_world': observation.get('active_world'),
                'matched': matched, 'restaged_mobile': restaged, 'drifted_static': drifted,
                'missing': missing, 'unexpected': unexpected, 'threshold_units': RESTAGED_UNITS}

    def target_check(self, observation: dict, target_id: str) -> dict:
        """Pre-leg check for one target: present? mobile? displaced from the atlas expectation?"""
        entity = self.entity(target_id)
        live = next((e for e in observation.get('entities') or [] if e['id'] == target_id or e.get('scene_object_id') == target_id), None)
        regions = ((observation.get('layout') or {}).get('regions') or [])
        region = next((r for r in regions if r['id'] == target_id), None)
        out: dict[str, Any] = {'target_id': target_id, 'present': bool(live or region), 'kind': 'entity' if live else ('region' if region else None),
                               'mobile': bool(entity and entity.get('mobility') in MOBILE),
                               'mobility': entity.get('mobility') if entity else None,
                               'sequence_label': entity.get('sequence_label') if entity else None}
        if live and entity and entity.get('expected_position'):
            pos = live.get('world_position') or {}
            if all(isinstance(pos.get(k), (int, float)) for k in ('x', 'z')):
                d = math.hypot(pos['x'] - entity['expected_position'][0], pos['z'] - entity['expected_position'][2])
                out['displacement_units'] = round(d, 3)
                out['restaged'] = d > RESTAGED_UNITS
        if live:
            out['distance_units'] = live.get('distance_from_robot')
            out['bearing_rad'] = live.get('bearing')
            out['state'] = live.get('state')
            out['currently_valid_actions'] = live.get('currently_valid_actions')
        return out

    # --------------------------------------------------------------- summaries
    def leg_brief(self, leg: dict) -> dict:
        plan = leg.get('plan') or {}
        return {'index': leg.get('index'), 'target': leg.get('target'), 'kind': leg.get('kind'), 'label': leg.get('sequence_label'),
                'mobile_target': leg.get('mobile_target'), 'purpose': leg.get('purpose'),
                'interactions': leg.get('interactions'), 'arrival_action': leg.get('arrival_action'),
                'plan': {k: plan.get(k) for k in ('blocked', 'initial_turn_rad', 'path_length_units', 'standoff_at_arrival_units',
                                                    'arrival_face_turn_rad', 'arrival_region', 'waypoints', 'target_position')}}

    def summary(self, scene: str = 'SCENE_1') -> dict:
        """LLM-sized view: what exists, what moves, the sequence, the plan and the pitfalls."""
        route = self.route(scene) or {}
        world = self.world(scene) or {}
        calibration = world.get('calibration') or {}
        frame = self.data.get('frame') or {}
        return {
            'source': self.source, 'generated_at': self.generated_at,
            'frame': {k: frame.get(k) for k in ('name', 'forward_at_zero_yaw', 'yaw_positive_toward', 'position_units', 'note')},
            'scene': scene, 'world_label': world.get('label'), 'world_status': world.get('status'), 'route_status': route.get('status'),
            'spawn': calibration.get('spawn'),
            'physical_axes': {'forward': calibration.get('physical_forward_axis'), 'lateral': calibration.get('physical_lateral_axis')},
            'regions': [{'id': r['id'], 'kind': r['kind'], 'traversable': r['traversable'], 'centroid': r.get('centroid'), 'actions': r.get('valid_actions')}
                        for r in (world.get('layout') or {}).get('regions') or []],
            'entities': [{'id': e['id'], 'api_id': e.get('api_id'), 'mobility': e.get('mobility'), 'label': e.get('sequence_label'),
                          'role': e.get('role'), 'expected_xz': [round(e['expected_position'][0], 2), round(e['expected_position'][2], 2)] if e.get('expected_position') else None,
                          'note': e.get('notes')} for e in self.entities if e.get('scene') in (scene, None)],
            'mobile_ids': self.mobile_ids(),
            'humanoid_sequence': [{'label': s['label'], 'role': s['role'], 'scene': s['scene'],
                                   'placement': (s.get('placement') or {}).get('status'),
                                   'scene_id': (s.get('placement') or {}).get('sceneObjectId'), 'api_id': (s.get('placement') or {}).get('apiId'),
                                   'suggested_position': (s.get('placement') or {}).get('suggestedPosition'),
                                   'relationships': s.get('relationships'), 'question': s.get('question'), 'behaviour': s.get('behaviour')}
                                  for s in self.sequence],
            'legs': [self.leg_brief(l) for l in route.get('legs') or []],
            'total_path_units': route.get('total_path_length_units'), 'physical_estimate_m': route.get('total_physical_estimate_m'),
            'route_notes': route.get('notes'),
            'pitfalls': [{'severity': p['severity'], 'id': p['id'], 'note': p['text']} for p in self.pitfalls(scene)],
            'rule': 'Mobile entities (animated_in_place, patrol) must be re-observed before approaching; their atlas position is only the authored expectation.',
        }

    def agent_brief(self, scene: str = 'SCENE_1') -> str:
        """Short text block for a system prompt: roles, mobility and route order."""
        lines = [f'Scene atlas ({self.generated_at}); frame three_world, forward at yaw 0 = +X, +yaw turns toward -Z, units = world units.']
        for s in self.sequence:
            placement = s.get('placement') or {}
            where = (f"{placement.get('apiId') or placement.get('sceneObjectId')} in {s['scene']}" if placement.get('status') == 'placed'
                     else f"{s['scene']} ({placement.get('status')})")
            lines.append(f"- {s['label']} {s['role']}: {where}. Q: {s.get('question')}")
        legs = self.legs(scene)
        if legs:
            order = ' -> '.join(f"{l['target']}" + (' (mobile)' if l.get('mobile_target') else '') for l in legs)
            lines.append(f'{scene} route: {order}; planned total {self.route(scene).get("total_path_length_units")} units.')
        lines.append('Mobile ids (re-observe before approaching): ' + ', '.join(self.mobile_ids()) + '.')
        for p in self.pitfalls(scene):
            if p['severity'] == 'high':
                lines.append(f"- pitfall {p['id']}: {p['text']}")
        return '\n'.join(lines)

#!/usr/bin/env node
/**
 * Build the scene atlas: public/scene-atlas.json + docs/scene-atlas.md.
 *
 * Joins the authored layout (sceneLayouts), staging (scene1DemoRoute), roles and
 * sequence labels (sceneAtlas), background patrols (BackgroundTraffic) and the
 * live obstacle footprints from a running map, then plans every traversal leg
 * with the same planner the map uses at runtime (relay/approach.ts) so the
 * pre-computed standoffs are exactly what the robot will be handed.
 *
 *   node scripts/build-scene-atlas.mjs                # live obstacles from :5173 (fallback :5174, then committed snapshot)
 *   node scripts/build-scene-atlas.mjs --map-url http://127.0.0.1:5174/api/map
 *   node scripts/build-scene-atlas.mjs --check        # regenerate from the committed snapshot and fail on drift
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const check = args.includes('--check');
const JSON_PATH = resolve(root, 'public/scene-atlas.json');
const DOC_PATH = resolve(root, 'docs/scene-atlas.md');

const server = await createServer({ configFile: false, root, cacheDir: '/tmp/moontology-scene-atlas-vite', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { Group, Vector3 } = await server.ssrLoadModule('three');
  const layouts = await server.ssrLoadModule('/src/levels/sceneLayouts.ts');
  const atlas = await server.ssrLoadModule('/src/levels/sceneAtlas.ts');
  const route = await server.ssrLoadModule('/src/levels/scene1DemoRoute.ts');
  const assets = await server.ssrLoadModule('/src/levels/scene1StaticAssets.ts');
  const traffic = await server.ssrLoadModule('/src/vehicles/BackgroundTraffic.ts');
  const airlock = await server.ssrLoadModule('/src/levels/airlockPlacement.ts');
  const calibration = await server.ssrLoadModule('/src/levels/sceneRobotCalibration.ts');
  const { WorldLayout } = await server.ssrLoadModule('/src/world/WorldLayout.ts');
  const approach = await server.ssrLoadModule('/src/relay/approach.ts');

  const previous = existsSync(JSON_PATH) ? JSON.parse(readFileSync(JSON_PATH, 'utf8')) : null;

  // ---- obstacles: live map first, then the committed snapshot -------------------------------
  const fetchObservation = async (base) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${base}/observation`, { signal: controller.signal });
      if (!res.ok) return null;
      const body = await res.json();
      return body.observation ?? null;
    } catch { return null; } finally { clearTimeout(timer); }
  };
  let obstacles = null, obstacleSource = 'none', liveEntities = null;
  if (!check) {
    const bases = flag('--map-url') ? [flag('--map-url')] : ['http://127.0.0.1:5173/api/map', 'http://127.0.0.1:5174/api/map'];
    for (const base of bases) {
      const obs = await fetchObservation(base);
      if (obs?.layout?.obstacles?.length && String(obs.active_world).startsWith('SCENE_1')) {
        // Patrol vehicles are wherever their loop put them at fetch time; their footprint is only
        // valid at observation time (mobility_classes.patrol), so they never enter the committed
        // snapshot or the offline route plans. The live planner sees them at run time.
        obstacles = obs.layout.obstacles.filter(o => atlas.mobilityOf(o.id) !== 'patrol').map(o => ({ id: o.id, polygon: o.polygon }));
        liveEntities = obs.entities; obstacleSource = `live:${base}`; break;
      }
    }
  }
  if (!obstacles && previous?.worlds?.SCENE_1?.obstacles_snapshot?.items?.length) {
    obstacles = previous.worlds.SCENE_1.obstacles_snapshot.items.filter(o => atlas.mobilityOf(o.id) !== 'patrol'); obstacleSource = `snapshot:${previous.worlds.SCENE_1.obstacles_snapshot.source}`;
  }
  if (!obstacles) { obstacles = []; obstacleSource = 'none'; }

  // ---- layout + planner ----------------------------------------------------------------------
  const layoutFor = (definition) => {
    const worldRoot = new Group(); const collider = new Group();
    const layout = new WorldLayout(definition, worldRoot, collider);
    if (definition.id === 'SCENE_1') layout.setObstacles(obstacles.map(o => ({ id: o.id, polygon: o.polygon })));
    return layout;
  };
  const scene1 = layoutFor(layouts.SCENE_1_LAYOUT);
  const scene2 = layoutFor(layouts.SCENE_2_LAYOUT);
  const floorY = layouts.SCENE_1_LAYOUT.supportFloor.topY;
  const round = (n, d = 3) => Number(n.toFixed(d));
  const centroid = (polygon) => { const c = approach.regionCentroid(polygon, 0); return [round(c.x), round(c.z)]; };
  const heading = (from, to) => Math.atan2(-(to.z - from.z), to.x - from.x); // map yaw convention (+X forward, yaw toward -Z)
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  const targetPosition = (target) => {
    const role = atlas.ATLAS_ENTITY_ROLES.find(e => e.apiId === target || e.id === target);
    if (role) {
      const live = liveEntities?.find(e => e.scene_object_id === role.id);
      const p = live ? [live.world_position.x, live.world_position.y, live.world_position.z] : atlas.expectedPositionOf(role.id);
      return p ? { kind: 'asset', sceneObjectId: role.id, position: new Vector3(p[0], floorY, p[2]), mobility: role.mobility } : null;
    }
    const region = layouts.SCENE_1_LAYOUT.regions.find(r => r.id === target);
    if (region) { const c = approach.regionCentroid(region.polygon, floorY); return { kind: 'region', sceneObjectId: region.id, position: c, mobility: 'static' }; }
    return null;
  };
  const planLeg = (layout, start, target) => {
    const info = targetPosition(target);
    if (!info) return { blocked: 'target_unknown_in_layout', waypoints: [] };
    const policy = target === 'rover-1' ? 'excavator_ring_r6' : info.kind === 'asset' ? `asset_standoff_sweep_${JSON.stringify(approach.ASSET_STANDOFF_RADII)}` : `region_standoff_sweep_${JSON.stringify(approach.REGION_STANDOFF_RADII)}`;
    const step = (from) => target === 'rover-1' ? approach.approachWaypoint(layout, from, info.position)
      : info.kind === 'asset' ? approach.planStandoff(layout, from, info.position, approach.ASSET_STANDOFF_RADII, 2)
      : approach.planStandoff(layout, from, info.position, approach.REGION_STANDOFF_RADII, 3);
    const waypoints = []; let cursor = start.clone(); let blocked = null; let length = 0;
    for (let i = 0; i < 14; i++) {
      const next = step(cursor);
      if (!next) { blocked = 'no_clear_lane_or_path'; break; }
      if (next.distanceTo(cursor) < 0.25) break; // planner says: already within the standoff ring
      length += Math.hypot(next.x - cursor.x, next.z - cursor.z);
      waypoints.push([round(next.x), round(next.y), round(next.z)]);
      cursor = next;
    }
    const finalPoint = waypoints.length ? new Vector3(...waypoints.at(-1)) : start.clone();
    const arrival = layout.sample(finalPoint.x, finalPoint.z);
    const faceHeading = round(heading(finalPoint, info.position));
    return { blocked, policy, target_kind: info.kind, scene_object_id: info.sceneObjectId, mobile_target: info.mobility === 'animated_in_place' || info.mobility === 'patrol',
      arrival_face_heading_rad: faceHeading,
      target_position: [round(info.position.x), round(info.position.y), round(info.position.z)], waypoints,
      final_waypoint: waypoints.length ? waypoints.at(-1) : [round(start.x), round(start.y), round(start.z)],
      path_length_units: round(length), straight_distance_units: round(Math.hypot(info.position.x - start.x, info.position.z - start.z)),
      standoff_at_arrival_units: round(Math.hypot(info.position.x - finalPoint.x, info.position.z - finalPoint.z)),
      initial_heading_rad: waypoints.length ? round(heading(start, new Vector3(...waypoints[0]))) : null,
      arrival_region: arrival.regionId, arrival_traversable: arrival.traversable, end: finalPoint };
  };

  // ---- routes ----------------------------------------------------------------------------------
  const routes = {};
  for (const sceneRoute of atlas.SCENE_ROUTES) {
    if (sceneRoute.scene !== 'SCENE_1') {
      routes[sceneRoute.scene] = { status: sceneRoute.status, start: sceneRoute.start, notes: sceneRoute.notes,
        legs: sceneRoute.legs.map((leg, index) => {
          const seq = atlas.HUMANOID_SEQUENCE.find(h => h.label === leg.sequenceLabel);
          return { index: index + 1, target: leg.target, kind: leg.kind, purpose: leg.purpose, sequence_label: leg.sequenceLabel ?? null,
            reobserve_before_approach: leg.reobserveBeforeApproach, placement: seq?.placement ?? null, plan: null };
        }) };
      continue;
    }
    let cursor = new Vector3(sceneRoute.start.x, floorY, sceneRoute.start.z); let yaw = sceneRoute.start.yaw;
    const legs = sceneRoute.legs.map((leg, index) => {
      const plan = planLeg(scene1, cursor, leg.target);
      const relativeBearing = plan.initial_heading_rad === null ? null : round(wrap(plan.initial_heading_rad - yaw));
      const record = { index: index + 1, target: leg.target, scene_object_id: plan.scene_object_id ?? null, kind: leg.kind, purpose: leg.purpose,
        sequence_label: leg.sequenceLabel ?? null, reobserve_before_approach: leg.reobserveBeforeApproach, mobile_target: plan.mobile_target ?? null,
        interactions: leg.interactions ?? null, arrival_action: leg.arrivalAction ?? null,
        plan: { blocked: plan.blocked, standoff_policy: plan.policy ?? null, target_kind: plan.target_kind ?? null, target_position: plan.target_position ?? null,
          start: [round(cursor.x), round(cursor.y), round(cursor.z)], start_yaw_rad: round(yaw), initial_heading_rad: plan.initial_heading_rad,
          initial_turn_rad: relativeBearing, waypoints: plan.waypoints, final_waypoint: plan.final_waypoint ?? null,
          path_length_units: plan.path_length_units ?? null, straight_distance_units: plan.straight_distance_units ?? null,
          standoff_at_arrival_units: plan.standoff_at_arrival_units ?? null, arrival_region: plan.arrival_region ?? null },
        physical_estimate_m: plan.path_length_units === undefined ? null : { scale_40: round(plan.path_length_units / 40, 3), scale_10: round(plan.path_length_units / 10, 2), scale_4: round(plan.path_length_units / 4, 2) } };
      if (plan.end && plan.waypoints.length) { yaw = plan.initial_heading_rad ?? yaw; if (plan.waypoints.length > 1) { const a = plan.waypoints.at(-2), b = plan.waypoints.at(-1); yaw = heading(new Vector3(...a), new Vector3(...b)); } cursor = plan.end; }
      if (plan.arrival_face_heading_rad !== undefined) {
        // After arriving, turn to face the target (what `calibrate --face-waypoint` / inspection needs).
        record.plan.arrival_face_heading_rad = plan.arrival_face_heading_rad;
        record.plan.arrival_face_turn_rad = round(wrap(plan.arrival_face_heading_rad - yaw));
        yaw = plan.arrival_face_heading_rad;
      }
      return record;
    });
    const total = legs.reduce((sum, l) => sum + (l.plan.path_length_units ?? 0), 0);
    routes.SCENE_1 = { status: legs.some(l => l.plan.blocked) ? 'blocked_leg_present' : sceneRoute.status, start: sceneRoute.start, notes: sceneRoute.notes, legs,
      total_path_length_units: round(total), total_physical_estimate_m: { scale_40: round(total / 40, 3), scale_10: round(total / 10, 2), scale_4: round(total / 4, 2) } };
  }

  // ---- entities ----------------------------------------------------------------------------------
  const staticById = Object.fromEntries((assets.SCENE_1_STATIC_ASSETS ?? []).map(a => [a.id, a]));
  const entities = atlas.ATLAS_ENTITY_ROLES.map(role => {
    const stop = route.SCENE_1_STOPS.find(s => s.id === role.id);
    const staged = route.EQUIPMENT_STAGING[role.id];
    const patrol = traffic.BACKGROUND_ROUTES.find(r => r.id === role.id);
    const expected = atlas.expectedPositionOf(role.id);
    const snapshot = obstacles.find(o => o.id === role.id);
    const live = liveEntities?.find(e => e.scene_object_id === role.id);
    return { id: role.id, api_id: role.apiId, scene: role.scene, role: role.role, mobility: role.mobility, group: role.group, sequence_label: role.sequenceLabel ?? null,
      notes: role.notes ?? null, asset_src: staticById[role.id]?.src ?? null,
      expected_position: expected ? [...expected] : null, expected_yaw_rad: stop?.yaw ?? staged?.rotation?.[1] ?? (role.id === 'GO2-01' ? route.SCENE_1_ROUTE_SPAWN.rotationY : null),
      live_position_at_build: live ? [round(live.world_position.x), round(live.world_position.y), round(live.world_position.z)] : null,
      recognition: stop ? { animation_clip: stop.action, behaviour: stop.behavior, task_id: stop.taskId, title: stop.title, stands_beside: stop.equipment, go2_stop_position: [...stop.stop] } : null,
      patrol: patrol ? { points: patrol.points.map(p => [...p]), speed_units_per_s: patrol.speed, start_delay_s: patrol.delay, dwell_s: patrol.dwell } : null,
      interaction_radius_units: role.apiId === 'rover-1' ? approach.EXCAVATOR_INTERACTION_RADIUS : null,
      footprint_snapshot: snapshot ? snapshot.polygon.map(p => p.map(v => round(v, 2))) : null };
  });

  // ---- worlds ------------------------------------------------------------------------------------
  const describeLayout = (definition) => ({ revision: definition.revision, support_floor: definition.supportFloor ?? null,
    regions: definition.regions.map(r => ({ id: r.id, label: r.label, kind: r.kind, polygon: r.polygon.map(p => [...p]), centroid: centroid(r.polygon),
      valid_actions: r.kind === 'building' ? [] : r.kind === 'doorway' ? ['approach', 'enter_world_2'] : ['walk'], destination: r.destination ?? null,
      traversable: r.kind !== 'building' })) });
  const worlds = {
    SCENE_1: { label: 'Exterior lunar operations (World Labs · Level 1)', status: 'built', layout: describeLayout(layouts.SCENE_1_LAYOUT),
      calibration: { spawn: { ...route.SCENE_1_ROUTE_SPAWN }, physical_forward_axis: calibration.SCENE_1_CALIBRATION.physicalForwardAxis, physical_lateral_axis: calibration.SCENE_1_CALIBRATION.physicalLateralAxis, default_meters_to_world_units: calibration.SCENE_1_CALIBRATION.metersToWorldUnits },
      airlock: { id: 'Airlock-2A', position: [...airlock.AIRLOCK_PLACEMENT.position], doorway_region: 'Doorway-2A', transition: 'proximity to Airlock-2A → fade → load SCENE_2 (physical missions held during the transition)' },
      obstacles_snapshot: { source: obstacleSource, captured_at: obstacleSource.startsWith('live') ? new Date().toISOString() : previous?.worlds?.SCENE_1?.obstacles_snapshot?.captured_at ?? null, items: obstacles } },
    SCENE_2: { label: 'Interior operations facility (World Labs · Scene 2, "Futuristic Museum Interiors")', status: 'built_no_assets', layout: describeLayout(layouts.SCENE_2_LAYOUT),
      calibration: { spawn: { x: calibration.SCENE_2_CALIBRATION.robotSpawnPosition.x, y: 0, z: calibration.SCENE_2_CALIBRATION.robotSpawnPosition.z, rotationY: calibration.SCENE_2_CALIBRATION.robotSpawnYaw }, physical_forward_axis: calibration.SCENE_2_CALIBRATION.physicalForwardAxis, physical_lateral_axis: calibration.SCENE_2_CALIBRATION.physicalLateralAxis, default_meters_to_world_units: calibration.SCENE_2_CALIBRATION.metersToWorldUnits },
      obstacles_snapshot: { source: 'none', captured_at: null, items: [] } },
    SCENE_3: { label: 'Ghost clock (trust scene)', status: 'not_built', layout: null, calibration: null, obstacles_snapshot: null },
  };

  const output = {
    atlas_version: 1,
    generated_at: new Date().toISOString(),
    generator: 'scripts/build-scene-atlas.mjs',
    sources: ['src/levels/sceneLayouts.ts', 'src/levels/sceneAtlas.ts', 'src/levels/scene1DemoRoute.ts', 'src/levels/scene1StaticAssets.ts', 'src/vehicles/BackgroundTraffic.ts', 'src/levels/airlockPlacement.ts', 'src/relay/approach.ts'],
    frame: { name: 'three_world', up: '+Y', forward_at_zero_yaw: '+X', yaw_positive_toward: '-Z', position_units: 'world_units', floor_y: floorY,
      note: 'Physical metres = world_units / meters_to_world_units (set by calibrate --scale). Bearings are radians relative to the robot heading.' },
    mobility_classes: { static: 'authored placement, never moves', animated_in_place: 'plays clips at its stop; treat as mobile (may be re-staged); re-observe before approaching', patrol: 'BackgroundTraffic loop; moving obstacle; position valid only at observation time', agent: 'the Go2', door: 'fixed portal whose state changes' },
    worlds, entities, humanoid_sequence: atlas.HUMANOID_SEQUENCE, routes, pitfalls: atlas.ATLAS_PITFALLS,
  };

  // ---- write / check ---------------------------------------------------------------------------
  // Provenance fields (timestamps, live-vs-snapshot source label, live positions) are not content.
  const strip = (o) => JSON.stringify({ ...o, generated_at: null, worlds: { ...o.worlds, SCENE_1: { ...o.worlds.SCENE_1, obstacles_snapshot: { ...o.worlds.SCENE_1.obstacles_snapshot, captured_at: null, source: null } } }, entities: o.entities.map(e => ({ ...e, live_position_at_build: null })) });
  if (check) {
    if (!previous) { console.error('scene-atlas.json missing; run without --check first'); process.exit(2); }
    if (strip(previous) !== strip(output)) { console.error('scene atlas drift: regenerate with `node scripts/build-scene-atlas.mjs`'); process.exit(1); }
    console.log('scene atlas up to date'); process.exit(0);
  }
  writeFileSync(JSON_PATH, JSON.stringify(output, null, 2) + '\n');
  writeFileSync(DOC_PATH, renderDoc(output));
  const summary = routes.SCENE_1.legs.map(l => `${l.index}. ${l.target}: ${l.plan.blocked ?? 'ok'} ${l.plan.path_length_units}u via ${l.plan.waypoints.length} wp → ${l.plan.arrival_region}`);
  console.log(JSON.stringify({ written: [JSON_PATH, DOC_PATH], obstacles: obstacleSource, scene1_legs: summary, total_units: routes.SCENE_1.total_path_length_units }, null, 2));
} finally {
  await server.close();
}

function renderDoc(a) {
  const r = (n) => typeof n === 'number' ? n.toFixed(2) : String(n);
  const lines = [];
  lines.push('# Scene atlas — Go2 boot-time map knowledge', '',
    `Generated ${a.generated_at} by \`${a.generator}\` from ${a.sources.map(s => `\`${s}\``).join(', ')}. Do not edit by hand: change the sources and rebuild (\`node scripts/build-scene-atlas.mjs\`). \`node scripts/build-scene-atlas.mjs --check\` fails when this file is stale.`, '',
    'Frame: `three_world`, +Y up, forward at zero yaw = +X, positive yaw turns toward −Z. Units are world units; physical metres = units ÷ `meters_to_world_units` (the `calibrate --scale` value). All Scene 1 positions below are on the support floor at y = ' + a.frame.floor_y + '.', '',
    '## Mobility classes (what the agent must assume)', '');
  for (const [k, v] of Object.entries(a.mobility_classes)) lines.push(`- \`${k}\` — ${v}`);
  lines.push('', '## Worlds', '');
  for (const [id, w] of Object.entries(a.worlds)) {
    lines.push(`### ${id} — ${w.label} (${w.status})`, '');
    if (!w.layout) { lines.push('No layout, calibration or assets exist for this world.', ''); continue; }
    lines.push(`Layout revision ${w.layout.revision}${w.layout.support_floor ? `, support floor bounds ${JSON.stringify(w.layout.support_floor.bounds)} at y ${w.layout.support_floor.topY}` : ''}. Spawn ${JSON.stringify(w.calibration.spawn)}; physical forward axis \`${w.calibration.physical_forward_axis}\`, lateral \`${w.calibration.physical_lateral_axis}\`.`, '');
    lines.push('| Region | Kind | Traversable | Centroid (x, z) | Actions | Notes |', '|---|---|---|---|---|---|');
    for (const reg of w.layout.regions) lines.push(`| \`${reg.id}\` | ${reg.kind} | ${reg.traversable ? 'yes' : 'NO_ENTRY'} | ${reg.centroid.join(', ')} | ${reg.valid_actions.join(', ') || '—'} | ${reg.label}${reg.destination ? ` → ${reg.destination}` : ''} |`);
    if (w.airlock) lines.push('', `Airlock: \`${w.airlock.id}\` at ${JSON.stringify(w.airlock.position)} inside \`${w.airlock.doorway_region}\`; ${w.airlock.transition}.`);
    if (w.obstacles_snapshot?.items?.length) lines.push('', `Obstacle footprints (${w.obstacles_snapshot.source}, ${w.obstacles_snapshot.captured_at}): ${w.obstacles_snapshot.items.map(o => `\`${o.id}\``).join(', ')}.`);
    lines.push('');
  }
  lines.push('## Entities', '', '| Scene id | API id | Mobility | Label | Role | Expected (x, z) | Recognition |', '|---|---|---|---|---|---|---|');
  for (const e of a.entities) lines.push(`| \`${e.id}\` | \`${e.api_id}\` | **${e.mobility}** | ${e.sequence_label ?? '—'} | ${e.role} | ${e.expected_position ? `${r(e.expected_position[0])}, ${r(e.expected_position[2])}` : '—'} | ${e.recognition ? `clip “${e.recognition.animation_clip}” (${e.recognition.behaviour}), beside ${e.recognition.stands_beside}` : e.patrol ? `patrol ${e.patrol.points.length} pts @ ${e.patrol.speed_units_per_s} u/s` : e.asset_src ?? '—'} |`);
  lines.push('', 'Notes:', '');
  for (const e of a.entities.filter(e => e.notes)) lines.push(`- \`${e.id}\`: ${e.notes}`);
  lines.push('', '## Humanoid reasoning sequence', '', '| Label | Role | Scene | Placement | Question Go2 answers |', '|---|---|---|---|---|');
  for (const h of a.humanoid_sequence) lines.push(`| **${h.label}** | ${h.role} | ${h.scene} | ${h.placement.status === 'placed' ? `\`${h.placement.sceneObjectId}\` (API \`${h.placement.apiId}\`)` : `planned${h.placement.suggestedPosition ? ` at ${JSON.stringify(h.placement.suggestedPosition)} in \`${h.placement.region}\`` : ''} — ${h.placement.reason}`} | ${h.question} |`);
  lines.push('', 'Relationships and behaviour per label:', '');
  for (const h of a.humanoid_sequence) lines.push(`- **${h.label}** ${h.relationships.map(x => `\`${x}\``).join('; ')}. Behaviour: ${h.behaviour}`);
  lines.push('', '## Routes', '');
  for (const [scene, rt] of Object.entries(a.routes)) {
    lines.push(`### ${scene} (${rt.status})`, '');
    if (rt.start) lines.push(`Start ${JSON.stringify(rt.start)}.`, '');
    if (scene === 'SCENE_1') {
      lines.push('| # | Target | Kind | Label | Mobile | Turn first (rad) | Path (units) | Standoff at arrival | Face target (rad) | Arrival region | Waypoints | Purpose |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const l of rt.legs) lines.push(`| ${l.index} | \`${l.target}\` | ${l.kind} | ${l.sequence_label ?? '—'} | ${l.mobile_target ? 'yes (re-observe)' : 'no'} | ${l.plan.initial_turn_rad === null ? 'none (already in ring)' : r(l.plan.initial_turn_rad)} | ${l.plan.blocked ? `**${l.plan.blocked}**` : r(l.plan.path_length_units)} | ${l.plan.standoff_at_arrival_units === null ? '—' : r(l.plan.standoff_at_arrival_units)} | ${l.plan.arrival_face_turn_rad === undefined ? '—' : r(l.plan.arrival_face_turn_rad)} | ${l.plan.arrival_region ?? '—'} | ${l.plan.waypoints.map(w => `(${r(w[0])}, ${r(w[2])})`).join(' → ') || '—'} | ${l.purpose}${l.interactions ? ` Then: ${l.interactions.join(' → ')}.` : ''}${l.arrival_action ? ` Affordance: \`${l.arrival_action}\`.` : ''} |`);
      lines.push('', `Total planned path ${r(rt.total_path_length_units)} units = ${rt.total_physical_estimate_m.scale_40} m at scale 40 (living room), ${rt.total_physical_estimate_m.scale_10} m at scale 10, ${rt.total_physical_estimate_m.scale_4} m at scale 4.`);
    } else {
      for (const l of rt.legs) lines.push(`- ${l.index}. **${l.target}** (${l.kind}) — ${l.purpose} ${l.placement ? `Placement: ${l.placement.status}${l.placement.suggestedPosition ? ` at ${JSON.stringify(l.placement.suggestedPosition)}` : ''}.` : ''}`);
    }
    for (const n of rt.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push('## Pitfalls', '');
  for (const p of a.pitfalls) lines.push(`- **${p.severity}** · ${p.scene} · \`${p.id}\`: ${p.text}`);
  lines.push('');
  return lines.join('\n');
}

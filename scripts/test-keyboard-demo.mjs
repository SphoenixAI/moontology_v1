import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Group, PerspectiveCamera } from 'three';

const cacheDir = await mkdtemp(join(tmpdir(), 'moontology-keyboard-test-'));
const server = await createServer({ configFile: false, cacheDir, optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
try {
  const { useKeyboardDemo } = await server.ssrLoadModule('/src/controls/keyboardDemo.ts');
  const { LiveMapState } = await server.ssrLoadModule('/src/relay/LiveMapState.ts');
  const { ManualGo2Controller } = await server.ssrLoadModule('/src/go2/ManualGo2Controller.ts');
  const { Go2FollowCamera } = await server.ssrLoadModule('/src/controls/Go2FollowCamera.ts');
  const { OntologyStore } = await server.ssrLoadModule('/src/ontology/OntologyStore.ts');
  const { createLunarBaseOntologySeed } = await server.ssrLoadModule('/src/ontology/demoOntology.ts');
  const { level1 } = await server.ssrLoadModule('/src/levels/level1.ts');
  const { AssetRegistry } = await server.ssrLoadModule('/src/assets/AssetRegistry.ts');
  const guards = { physicalHold: null, legacyTelemetryActive: false, transitioning: false };
  const fixture = () => {
    const robot = new Group(), registry = new AssetRegistry([]);
    const ontology = new OntologyStore(createLunarBaseOntologySeed(level1));
    const config = level1.assets.find(a => a.id === 'EXC-01'), root = new Group();
    robot.add(root);
    registry.register({ config, root, model: root, normalization: null, animations: [], animation: null });
    const world = { identity: 'scene1', ready: true, hold: null, metersToWorldUnits: 1 };
    let applied = 0;
    const state = new LiveMapState({ registry, ontology, robot: () => robot, world: () => world,
      legacyTelemetryActive: () => false, applyPose: () => { applied++; return null; } }, 'test', 'http://127.0.0.1:5173/');
    const send = (kind, body) => {
      const o = state.observation(), now = Date.now(), id = randomUUID();
      return state.handle({ id, kind, body: { ...body, command_id: id }, expires_at: now + 1000,
        context: { scene_session_id: o.scene_session_id, scene_revision: o.scene_revision,
          observation_sequence: o.observation_sequence, read_at: now } });
    };
    return { state, robot, ontology, world, send, applied: () => applied };
  };

  const f = fixture();
  f.state.restorePose({ position: { x: 3, y: 0, z: 2 }, yaw: .5, source: 'physical_odometry' });
  f.state.tick();
  assert.equal(f.state.ownsPose(), true, 'Reload stays held until an explicit operator action');
  const held = f.robot.position.clone();
  for (const blocked of [{ physicalHold: 'STOP' }, { legacyTelemetryActive: true }, { transitioning: true }]) {
    assert.ok(useKeyboardDemo(f.state, { ...guards, ...blocked }));
    assert.equal(f.state.ownsPose(), true);
  }
  assert.equal(useKeyboardDemo(f.state, guards), null);
  const released = f.state.observation();
  assert.equal(f.state.ownsPose(), false);
  assert.equal(released.robot_pose.source, 'manual');
  assert.equal(released.mission_state.map_armed, false);
  assert.equal(released.mission_state.run_id, null);
  assert.ok(f.robot.position.equals(held), 'Handoff must not teleport Go2');
  assert.equal(f.applied(), 0, 'Handoff must not apply a telemetry pose');

  const live = fixture();
  assert.equal(live.send('mission', { op: 'start', target_id: 'rover-1', mode: 'telemetry' }).status, 200);
  assert.equal(live.send('telemetry', { source: 'physical_odometry', frame: 'three_world', connected: true,
    position: { x: 0, y: 0, z: 0 }, yaw: 0, sample_sequence: 1, timestamp_ms: Date.now() }).status, 200);
  assert.match(useKeyboardDemo(live.state, guards), /Pause and disconnect/);
  assert.equal(live.state.ownsPose(), true);
  const unsafe = fixture();
  unsafe.ontology.executeOntologyAction({ type: 'holdFleet', targetId: 'GO2-01' });
  assert.match(useKeyboardDemo(unsafe.state, guards), /safety hold/);

  globalThis.window = new globalThis.EventTarget();
  globalThis.HTMLElement = class {};
  const controller = new ManualGo2Controller(), camera = new PerspectiveCamera();
  const follow = new Go2FollowCamera(camera, f.robot);
  const target = { moveForward: distance => f.robot.translateX(distance), rotateYaw: angle => { f.robot.rotation.y += angle; } };
  const key = (type, code) => globalThis.window.dispatchEvent(Object.assign(new globalThis.Event(type, { cancelable: true }), { code }));
  key('keydown', 'ArrowUp'); controller.update(.1, target); key('keyup', 'ArrowUp');
  assert.ok(f.robot.position.distanceTo(held) > .07, 'ArrowUp moves the virtual root');
  const moved = f.robot.position.clone(); controller.update(.1, target);
  assert.ok(f.robot.position.equals(moved), 'Key release stops movement');
  key('keydown', 'ArrowLeft'); controller.update(.1, target); key('keyup', 'ArrowLeft');
  assert.ok(f.robot.rotation.y > .5, 'ArrowLeft turns Go2');
  follow.update(0, true); const cameraBefore = camera.position.clone();
  key('keydown', 'ArrowDown'); controller.update(.1, target); key('keyup', 'ArrowDown'); follow.update(0, true);
  assert.ok(camera.position.distanceTo(cameraBefore) > .07, 'Follow camera tracks the moved authoritative root');
  const beforeTap = f.robot.position.clone();
  key('keydown', 'ArrowUp'); key('keyup', 'ArrowUp'); controller.update(.1, target);
  assert.ok(f.robot.position.distanceTo(beforeTap) > .07, 'A short tap between render frames is not lost');
  const afterTap = f.robot.position.clone(); controller.update(.1, target);
  assert.ok(f.robot.position.equals(afterTap), 'A completed tap moves for only one frame');
  key('keydown', 'ArrowUp'); controller.setExternalControlActive(true);
  const locked = f.robot.position.clone(); controller.update(.1, target);
  controller.setExternalControlActive(false); controller.update(.1, target);
  assert.ok(f.robot.position.equals(locked), 'Physical ownership clears held keys and never auto-resumes');
  controller.setTouchInput('ArrowUp', true); controller.update(.1, target);
  assert.ok(f.robot.position.distanceTo(locked) > .07, 'Touch pad moves through the same virtual controller');
  controller.setTouchInput('ArrowUp', false);
  const touchReleased = f.robot.position.clone(); controller.update(.1, target);
  assert.ok(f.robot.position.equals(touchReleased), 'Touch release stops movement');
  controller.setTouchInput('ArrowUp', true); controller.setExternalControlActive(true);
  controller.update(.1, target); controller.setExternalControlActive(false); controller.update(.1, target);
  assert.ok(f.robot.position.equals(touchReleased), 'Ownership change clears touch input without auto-resume');
  controller.setEnabled(false); controller.setTouchInput('ArrowUp', true); controller.setEnabled(true); controller.update(.1, target);
  assert.ok(f.robot.position.equals(touchReleased), 'Touch while camera mode is active cannot queue later motion');
  controller.setTouchInput('ArrowUp', true); globalThis.window.dispatchEvent(new globalThis.Event('blur')); controller.update(.1, target);
  assert.ok(f.robot.position.equals(touchReleased), 'Blur cancels touch input');
  controller.dispose();
  console.log('PASS: explicit keyboard handoff, preserved safety gates, arrow controls and follow camera; no hardware connections.');
} finally { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }

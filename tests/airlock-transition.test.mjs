import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import { Box3, Group, PerspectiveCamera, Scene, Vector3 } from 'three';

const server = await createServer({ configFile: false, cacheDir: '/tmp/moontology-airlock-transition.test-vite', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
after(() => server.close());
const { AirlockTransitionController } = await server.ssrLoadModule('/src/world/airlockTransition.ts');
const placement = await server.ssrLoadModule('/src/levels/airlockPlacement.ts');
const { SCENE_2_CALIBRATION } = await server.ssrLoadModule('/src/levels/sceneRobotCalibration.ts');
const { WorldLayout } = await server.ssrLoadModule('/src/world/WorldLayout.ts');
const { SCENE_1_LAYOUT } = await server.ssrLoadModule('/src/levels/sceneLayouts.ts');
const { AirlockController } = await server.ssrLoadModule('/src/static-assets/AirlockController.ts');
const { SCENE_1_STATIC_SYSTEMS } = await server.ssrLoadModule('/src/levels/scene1StaticAssets.ts');
const { Go2FollowCamera } = await server.ssrLoadModule('/src/controls/Go2FollowCamera.ts');
const elements = new Map();
globalThis.document = {
  getElementById: id => elements.get(id),
  createElement: () => ({ style: {}, setAttribute() {}, appendChild(child) { elements.set(child.id, child); }, remove() { elements.delete(this.id); } }),
  body: { appendChild(element) { elements.set(element.id, element); } },
};
globalThis.window = { setTimeout, clearTimeout };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
const [doorX, , doorZ] = placement.AIRLOCK_PLACEMENT.position;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(loadMode = 'success') {
  const robot = new Group(), anchor = new Group();
  let doorState = null, allowed = true, releaseLoad;
  const delayedLoad = new Promise(resolve => { releaseLoad = resolve; });
  anchor.position.fromArray(placement.AIRLOCK_PLACEMENT.position);
  anchor.scale.fromArray(placement.AIRLOCK_PLACEMENT.scale);
  const counts = { open: 0, load: 0, oldDisposed: 0, newDisposed: 0, activated: 0 };
  const old = { dispose: () => counts.oldDisposed++ };
  const next = { root: new Group(), activeMode: loadMode === 'fallback' ? 'placeholder' : 'marble', requestedMode: 'marble', dispose: () => counts.newDisposed++ };
  const controller = new AirlockTransitionController({
    scene: new Scene(), go2Root: robot, airlockAnchor: anchor,
    approachTrigger: placement.APPROACH_WORLD, thresholdTrigger: placement.THRESHOLD_WORLD,
    approachTriggerLocal: placement.APPROACH_LOCAL, thresholdTriggerLocal: placement.THRESHOLD_LOCAL,
    airlock: { openAirlock() { counts.open++; if (loadMode === 'door-failure') throw Error('Door unavailable'); }, getAirlockState: () => doorState },
    canTrigger: () => allowed,
    getScene1World: () => old, clearScene1World() {},
    loadWorldLabsWorld: async () => { counts.load++; if (loadMode === 'slow') await delayedLoad; return next; },
    scene2Url: '/museum.spz', scene2Calibration: SCENE_2_CALIBRATION,
    activateScene2World: () => counts.activated++, onScene2World() {},
  });
  return { controller, robot, counts, releaseLoad, setAllowed: value => { allowed = value; }, setDoorState: value => { doorState = value; } };
}
test('ground-level Go2 is inside both local and fallback doorway bounds', () => {
  const world = new Vector3(doorX, 0, doorZ);
  assert.equal(placement.THRESHOLD_WORLD.containsPoint(world), true);
  const anchor = new Group(); anchor.position.fromArray(placement.AIRLOCK_PLACEMENT.position); anchor.scale.fromArray(placement.AIRLOCK_PLACEMENT.scale);
  assert.equal(placement.THRESHOLD_LOCAL.containsPoint(anchor.worldToLocal(world.clone())), true);
});
test('approach opens once; threshold loads once and spawns after fade', async () => {
  const { controller, robot, counts } = fixture();
  robot.position.set(doorX, 0, doorZ + 1); controller.update(); controller.update();
  assert.equal(counts.open, 1); assert.equal(counts.load, 0);
  robot.position.z = doorZ; controller.update(); controller.update();
  await wait(1600);
  assert.equal(counts.load, 1); assert.equal(counts.oldDisposed, 1); assert.equal(counts.activated, 1);
  assert.equal(controller.getState(), 'scene2'); assert.equal(robot.position.z, SCENE_2_CALIBRATION.robotSpawnPosition.z);
  controller.dispose();
});
test('missing door animation never blocks world progression', async () => {
  const { controller, counts, robot } = fixture('door-failure'); robot.position.set(doorX, -.72, doorZ); controller.enterScene2();
  await wait(1600); assert.equal(counts.load, 1); assert.equal(controller.getState(), 'scene2'); controller.dispose();
});
test('failed World Labs visual preserves exterior and requires exit before retry', async () => {
  const { controller, robot, counts } = fixture('fallback'); robot.position.set(doorX, 0, doorZ); controller.update();
  await wait(1600); controller.update();
  assert.equal(controller.getState(), 'error'); assert.equal(counts.oldDisposed, 0); assert.equal(counts.newDisposed, 1); assert.equal(counts.load, 1);
  robot.position.z = doorZ + 4; controller.update(); assert.equal(controller.getState(), 'scene1'); controller.dispose();
});
test('disposal cancels delayed transition', async () => {
  const { controller, counts, robot } = fixture(); robot.position.set(doorX, -.72, doorZ); controller.enterScene2(); controller.dispose(); await wait(450); assert.equal(counts.load, 0);
});

test('external entry requests cannot bypass the doorway', () => {
  const { controller, counts } = fixture(); controller.enterScene2();
  assert.equal(controller.getState(), 'scene1'); assert.equal(counts.load, 0); controller.dispose();
});

test('full Go2 footprint reaches the trigger across the opening, while walls remain closed', () => {
  const layout = new WorldLayout(SCENE_1_LAYOUT, new Group(), new Group());
  for (const x of [doorX - .4, doorX, doorX + .4]) {
    const start = new Vector3(x, -.23, doorZ + 4);
    const result = layout.constrain(start, new Vector3(x, -.23, doorZ));
    assert.equal(result.blocked, null, `approach at x=${x}: ${result.blocked}`);
    assert.equal(placement.THRESHOLD_WORLD.containsPoint(result.position), true);
    assert.equal(result.position.y, -.23);
    assert.ok(layout.constrain(result.position, new Vector3(x, -.23, doorZ - 2)).blocked, 'back of habitat remains a wall');
  }
  for (const x of [doorX - 2, doorX + 2]) {
    assert.ok(layout.constrain(new Vector3(x, -.23, doorZ + 5), new Vector3(x, -.23, doorZ - 2)).blocked, 'adjacent facade stays solid');
  }
  layout.dispose();
});

test('airlock unseals and swings rigid leaves clear without shrinking; closes continuously', () => {
  const root = new Group(); root.position.fromArray(placement.AIRLOCK_PLACEMENT.position); root.scale.fromArray(placement.AIRLOCK_PLACEMENT.scale);
  const controller = new AirlockController(root, new Group(), new Group(), SCENE_1_STATIC_SYSTEMS.airlock, () => {});
  const left = root.getObjectByName('left-door-hinge');
  const leaf = left.getObjectByName('rigid-pressure-leaf');
  const originalSize = leaf.geometry.boundingBox ?? (leaf.geometry.computeBoundingBox(), leaf.geometry.boundingBox.clone());
  assert.equal(controller.currentState, 'CLOSED');
  controller.openAirlock(); controller.update(.2);
  assert.ok(left.position.z > .08, 'seal releases before swing');
  assert.ok(Math.abs(left.rotation.y) < 1e-9);
  controller.update(2.01);
  assert.equal(controller.currentState, 'OPEN');
  assert.ok(left.rotation.y < -Math.PI / 2);
  assert.deepEqual(leaf.scale.toArray(), [1, 1, 1]);
  assert.ok(leaf.geometry.boundingBox.equals(originalSize));
  root.updateMatrixWorld(true);
  assert.ok(new Box3().setFromObject(left).max.x < doorX - .65, 'open leaf clears robot footprint');
  const openAngle = left.rotation.y;
  controller.closeAirlock(); controller.update(.2);
  assert.ok(left.rotation.y > openAngle && left.rotation.y < 0);
  controller.update(2.01);
  assert.equal(controller.currentState, 'SEALED'); assert.ok(Math.abs(left.rotation.y) < 1e-9);
  root.updateMatrixWorld(true);
  const bottom = new Box3().setFromObject(leaf).min.y;
  assert.ok(bottom <= placement.AIRLOCK_APERTURE.floorY && bottom > placement.AIRLOCK_APERTURE.floorY - .28, 'leaf overlaps the uneven apron without floating');
  controller.dispose();
});

test('threshold waits for the actual opening animation before one world load', async () => {
  const { controller, robot, counts, setDoorState } = fixture();
  setDoorState('REOPENING');
  robot.position.set(doorX, -.23, doorZ); controller.update();
  await wait(500);
  assert.equal(controller.getState(), 'opening'); assert.equal(counts.load, 0);
  setDoorState('OPEN'); controller.update(); controller.update();
  await wait(1600); assert.equal(controller.getState(), 'scene2'); assert.equal(counts.load, 1);
  controller.dispose();
});

test('a slow real world load waits for readiness without the old 45-second deadline', async () => {
  const { controller, robot, counts, releaseLoad } = fixture('slow');
  const timeouts = [];
  globalThis.window.setTimeout = (callback, ms) => { timeouts.push(ms); return setTimeout(callback, ms); };
  try {
    robot.position.set(doorX, -.23, doorZ); controller.update();
    await wait(1100);
    assert.equal(controller.getState(), 'loading'); assert.equal(counts.oldDisposed, 0);
    assert.equal(timeouts.includes(45000), false);
    releaseLoad(); await wait(600);
    assert.equal(controller.getState(), 'scene2'); assert.equal(counts.load, 1);
  } finally { globalThis.window.setTimeout = setTimeout; controller.dispose(); }
});

test('existing mission safety gate still prevents entry', () => {
  const { controller, robot, counts, setAllowed } = fixture();
  setAllowed(false); robot.position.set(doorX, -.23, doorZ); controller.update(); controller.enterScene2();
  assert.equal(controller.getState(), 'scene1'); assert.equal(counts.open, 0); assert.equal(counts.load, 0);
  controller.dispose();
});

test('World 2 chase camera fits inside its foyer without changing Go2 pose', () => {
  const robot = new Group(), camera = new PerspectiveCamera(55, 16 / 9, .1, 2000); robot.rotation.y = Math.PI / 2;
  const follow = new Go2FollowCamera(camera, robot);
  follow.update(0, true); assert.ok(camera.position.z > 1.2, 'exterior offset would be behind the foyer');
  follow.setInterior(true); follow.update(0, true);
  assert.ok(camera.position.z > 0 && camera.position.z < 1.2);
  assert.ok(camera.position.y <= 1.25, 'stay below the scanned entrance arch');
  camera.updateMatrixWorld(true);
  for (const x of [-.25, .25]) for (const y of [0, .7]) for (const z of [-.45, .45]) {
    const screen = new Vector3(x, y, z).project(camera);
    assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < .95, 'full robot envelope fits the frame');
  }
  assert.deepEqual(robot.position.toArray(), [0, 0, 0]);
});

import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import { Group, Scene, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
after(() => server.close());
const { AirlockTransitionController } = await server.ssrLoadModule('/src/world/airlockTransition.ts');
const placement = await server.ssrLoadModule('/src/levels/airlockPlacement.ts');
const { SCENE_2_CALIBRATION } = await server.ssrLoadModule('/src/levels/sceneRobotCalibration.ts');
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
  anchor.position.fromArray(placement.AIRLOCK_PLACEMENT.position);
  anchor.scale.fromArray(placement.AIRLOCK_PLACEMENT.scale);
  const counts = { open: 0, load: 0, oldDisposed: 0, newDisposed: 0, activated: 0 };
  const old = { dispose: () => counts.oldDisposed++ };
  const next = { root: new Group(), activeMode: loadMode === 'fallback' ? 'placeholder' : 'marble', requestedMode: 'marble', dispose: () => counts.newDisposed++ };
  const controller = new AirlockTransitionController({
    scene: new Scene(), go2Root: robot, airlockAnchor: anchor,
    approachTrigger: placement.APPROACH_WORLD, thresholdTrigger: placement.THRESHOLD_WORLD,
    approachTriggerLocal: placement.APPROACH_LOCAL, thresholdTriggerLocal: placement.THRESHOLD_LOCAL,
    airlock: { openAirlock() { counts.open++; if (loadMode === 'door-failure') throw Error('Door unavailable'); } },
    getScene1World: () => old, clearScene1World() {},
    loadWorldLabsWorld: async () => { counts.load++; return next; },
    scene2Url: '/museum.spz', scene2Calibration: SCENE_2_CALIBRATION,
    activateScene2World: () => counts.activated++, onScene2World() {},
  });
  return { controller, robot, counts };
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

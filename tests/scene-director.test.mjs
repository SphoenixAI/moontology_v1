import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneDirector } from '../src/runtime/SceneDirector.ts';
const targets = [{ id: 'H01', x: 0, z: 0, duration: 0.5 }, { id: 'H02', x: 4, z: 0, duration: 1 }];
function step(d, seconds, robot = { x: 0, z: 0 }, block = null) {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) d.update(0.05, robot, targets, block);
}
test('requires arming and sustained proximity; never repeats a completed cue', () => {
  const d = new SceneDirector(); step(d, 2); assert.equal(d.activeId, null);
  d.arm(); step(d, 0.5); assert.equal(d.activeId, null);
  step(d, 0.1, { x: 9, z: 9 }); step(d, 0.6); assert.equal(d.activeId, null);
  step(d, 0.5); assert.equal(d.activeId, 'H01');
  step(d, 30); assert.deepEqual([...d.completed], ['H01']); assert.equal(d.activeId, null);
});
test('pause preserves cue; blocked telemetry requires explicit resume', () => {
  const d = new SceneDirector(); d.arm(); step(d, 1.1);
  step(d, 2, undefined, 'Stale telemetry'); assert.equal(d.state, 'paused');
  step(d, 10); assert.equal(d.state, 'paused'); assert.equal(d.completed.size, 0);
  d.arm(); step(d, 1); assert.equal(d.completed.size, 1);
});
test('cooldown prevents overlap and reset enables a new run', () => {
  const d = new SceneDirector(); d.arm(); step(d, 1.7);
  step(d, 1, { x: 4, z: 0 }); assert.equal(d.activeId, null);
  step(d, 4, { x: 4, z: 0 }); assert.equal(d.state, 'complete');
  d.arm(); assert.equal(d.state, 'complete');
  d.reset(); assert.equal(d.completed.size, 0); assert.equal(d.state, 'ready');
});
test('stalls and invalid poses do not advance the run', () => {
  const d = new SceneDirector(); d.arm(); d.update(10, { x: 0, z: 0 }, targets, null);
  assert.equal(d.state, 'paused'); assert.equal(d.activeId, null);
  d.arm(); d.update(0.05, { x: NaN, z: 0 }, targets, null); assert.equal(d.state, 'paused');
});
test('manual cues obey arming, single playback, cooldown and completion', () => {
  const d = new SceneDirector(); assert.equal(d.cue('H01'), false);
  d.arm(); assert.equal(d.cue('H01'), true); assert.equal(d.cue('H02'), false);
  step(d, 0.6); assert.equal(d.cue('H02'), false);
  step(d, 2.1, { x: 10, z: 10 }); assert.equal(d.cue('H01'), false);
  assert.equal(d.cue('H02'), true);
});

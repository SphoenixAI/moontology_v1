import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import { Group } from 'three';
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
after(() => server.close());
const gait = await server.ssrLoadModule('/src/go2/Go2GaitAnimator.ts');
const { Go2GaitAnimator, legForwardKinematics, legInverseKinematics, UNITREE_MOTOR_ORDER, TELEMETRY_JOINT_FRESH_MS } = gait;

const LIMITS = { hip: [-1.0472, 1.0472], thigh: [-1.5708, 4.5379], calf: [-2.7227, -0.83776] };
const REST = { hip: 0, thigh: 0.8, calf: -1.55 };
function mockJoints() {
  const legs = ['front-left', 'front-right', 'rear-left', 'rear-right'];
  return legs.flatMap(leg => ['hip', 'thigh', 'calf'].map(role => {
    const joint = { angle: REST[role], limit: { lower: LIMITS[role][0], upper: LIMITS[role][1] }, setJointValue(v) { this.angle = v; } };
    return { leg, role, name: `${leg}_${role}`, legLabel: leg, roleLabel: role, joint };
  }));
}
const angleOf = (joints, leg, role) => joints.find(j => j.leg === leg && j.role === role).joint.angle;
const run = (animator, input, seconds, dt = 1 / 60, now = { t: 0 }) => {
  for (let t = 0; t < seconds; t += dt) { now.t += dt * 1000; animator.update({ ...input, deltaSeconds: dt, nowMs: now.t }); }
};

test('inverse kinematics reproduces the official go2_description stand pose', () => {
  const foot = legForwardKinematics(0.8, -1.55);
  assert.ok(Math.abs(foot.z + 0.304) < 0.002, `stand height ${foot.z}`);
  const { thigh, calf } = legInverseKinematics(foot.x, foot.z);
  assert.ok(Math.abs(thigh - 0.8) < 1e-6 && Math.abs(calf + 1.55) < 1e-6, `${thigh} ${calf}`);
  // Round trip across the reachable workspace, knee always bent backward (calf < 0).
  for (const x of [-0.12, -0.05, 0, 0.06, 0.12]) for (const z of [-0.36, -0.3, -0.24]) {
    const ik = legInverseKinematics(x, z); const fk = legForwardKinematics(ik.thigh, ik.calf);
    assert.ok(Math.hypot(fk.x - x, fk.z - z) < 1e-6, `round trip ${x},${z}`);
    assert.ok(ik.calf < 0 && ik.calf > LIMITS.calf[0], `calf limit ${ik.calf}`);
  }
});

test('forward motion trots diagonal pairs in antiphase and lifts swing feet', () => {
  const joints = mockJoints(); const animator = new Go2GaitAnimator(joints, new Group());
  const samples = [];
  const now = { t: 0 };
  for (let i = 0; i < 90; i++) {
    now.t += 1000 / 60;
    animator.update({ forwardVelocity: 0.6, angularVelocity: 0, deltaSeconds: 1 / 60, nowMs: now.t });
    samples.push({ fl: angleOf(joints, 'front-left', 'thigh'), rr: angleOf(joints, 'rear-right', 'thigh'), fr: angleOf(joints, 'front-right', 'thigh') });
  }
  const state = animator.debugState;
  assert.equal(state.jointSource, 'procedural'); assert.ok(state.moving); assert.ok(state.frequency >= 1.4 && state.frequency <= 3.0);
  assert.ok(state.strideMeters > 0.05 && state.strideMeters <= 0.14, `stride ${state.strideMeters}`);
  const late = samples.slice(30);
  const spread = arr => Math.max(...arr) - Math.min(...arr);
  assert.ok(spread(late.map(s => s.fl)) > 0.15, 'front-left thigh must swing');
  // FL and RR share a phase; FL and FR are opposite.
  const corr = (a, b) => { const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
    let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); };
  assert.ok(corr(late.map(s => s.fl), late.map(s => s.rr)) > 0.9, 'diagonal pair in phase');
  assert.ok(corr(late.map(s => s.fl), late.map(s => s.fr)) < -0.7, 'left/right front legs in antiphase');
  for (const j of joints) assert.ok(j.joint.angle >= j.joint.limit.lower && j.joint.angle <= j.joint.limit.upper, `${j.name} within URDF limits`);
});

test('in-place turn steps left and right legs in opposite directions', () => {
  const joints = mockJoints(); const animator = new Go2GaitAnimator(joints, new Group());
  const fl = [], fr = [];
  const now = { t: 0 };
  for (let i = 0; i < 120; i++) {
    now.t += 1000 / 60;
    animator.update({ forwardVelocity: 0, angularVelocity: 0.8, deltaSeconds: 1 / 60, nowMs: now.t });
    if (i >= 40) { fl.push(angleOf(joints, 'front-left', 'thigh')); fr.push(angleOf(joints, 'front-right', 'thigh')); }
  }
  assert.ok(animator.debugState.moving && animator.debugState.jointSource === 'procedural');
  const spread = arr => Math.max(...arr) - Math.min(...arr);
  assert.ok(spread(fl) > 0.1 && spread(fr) > 0.1, 'both sides step during a turn');
  // Hip roll engages for the lateral stride component of a yaw.
  assert.ok(Math.abs(angleOf(joints, 'front-left', 'hip')) > 0.005 || Math.abs(angleOf(joints, 'rear-left', 'hip')) > 0.005, 'hip roll used when turning');
});

test('stopping returns to the rest pose smoothly and a single-frame spike does not start a gait', () => {
  const joints = mockJoints(); const animator = new Go2GaitAnimator(joints, new Group());
  const now = { t: 0 };
  run(animator, { forwardVelocity: 0.6, angularVelocity: 0 }, 1, 1 / 60, now);
  run(animator, { forwardVelocity: 0, angularVelocity: 0 }, 1.5, 1 / 60, now);
  assert.equal(animator.debugState.jointSource, 'rest');
  for (const j of joints) assert.ok(Math.abs(j.joint.angle - REST[j.role]) < 0.02, `${j.name} back to rest`);
  // One frame of telemetry-jump velocity (what the old code saw) must not flicker the gait.
  animator.update({ forwardVelocity: 8, angularVelocity: 0, deltaSeconds: 1 / 60, nowMs: (now.t += 16) });
  run(animator, { forwardVelocity: 0, angularVelocity: 0 }, 0.5, 1 / 60, now);
  assert.equal(animator.debugState.jointSource, 'rest');
});

test('measured joint telemetry overrides the gait while fresh and hands back when stale', () => {
  const joints = mockJoints(); const animator = new Go2GaitAnimator(joints, new Group());
  const measured = UNITREE_MOTOR_ORDER.map(({ role }) => role === 'hip' ? 0.1 : role === 'thigh' ? 1.1 : -1.9);
  assert.equal(animator.setTelemetryJoints(measured, 1000), true);
  assert.equal(animator.setTelemetryJoints([1, 2, 3], 1000), false, 'wrong size rejected');
  assert.equal(animator.setTelemetryJoints(measured.map((v, i) => i === 4 ? NaN : v), 1000), false, 'non-finite rejected');
  for (let i = 0; i < 60; i++) animator.update({ forwardVelocity: 0, angularVelocity: 0, deltaSeconds: 1 / 60, nowMs: 1000 + i * 4 });
  assert.equal(animator.debugState.jointSource, 'telemetry');
  assert.ok(Math.abs(angleOf(joints, 'front-right', 'thigh') - 1.1) < 0.02);
  assert.ok(Math.abs(angleOf(joints, 'rear-left', 'calf') + 1.9) < 0.02);
  // Stale telemetry: procedural gait resumes from the measured pose without a jump.
  const before = angleOf(joints, 'front-right', 'thigh');
  animator.update({ forwardVelocity: 0.5, angularVelocity: 0, deltaSeconds: 1 / 60, nowMs: 1000 + TELEMETRY_JOINT_FRESH_MS + 100 });
  assert.equal(animator.debugState.jointSource, 'procedural');
  assert.ok(Math.abs(angleOf(joints, 'front-right', 'thigh') - before) < 0.3, 'no discontinuity on hand-back');
});

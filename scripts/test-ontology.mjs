import assert from 'node:assert/strict';
import console from 'node:console';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated transform cache: tests must not invalidate the running presentation's Vite dependencies.
const cacheDir = await mkdtemp(join(tmpdir(), 'moontology-intelligence-test-'));
const server = await createServer({ configFile: false, cacheDir, optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
try {
  const { WorldIntelligence, STALL_THRESHOLD_MS } = await server.ssrLoadModule('/src/ontology/WorldIntelligence.ts');
  const { OntologyStore } = await server.ssrLoadModule('/src/ontology/OntologyStore.ts');
  const { createLunarBaseOntologySeed } = await server.ssrLoadModule('/src/ontology/demoOntology.ts');
  const { level1 } = await server.ssrLoadModule('/src/levels/level1.ts');
  const { seedOperationalIntelligence } = await server.ssrLoadModule('/src/ontology/operationalSeed.ts');
  const { AnimationSystem } = await server.ssrLoadModule('/src/animation/AnimationSystem.ts');
  const { Group, AnimationClip, NumberKeyframeTrack } = await import('three');
  const { LiveMapState } = await server.ssrLoadModule('/src/relay/LiveMapState.ts');
  const { AssetRegistry } = await server.ssrLoadModule('/src/assets/AssetRegistry.ts');
  const seed = () => createLunarBaseOntologySeed(level1);
  const start = Date.now(); let serial = 0, passed = 0;
  const engine = () => { const s = seed(); return new WorldIntelligence(s.objects, s.relations, start); };
  const sample = (e, metric, value, t = 0, options = {}) => e.ingest({ id: `test-${++serial}`, source: 'GO2-01', target: 'CABLE-ROVER-01', timestamp: start + t, metric, value, confidence: .94, provenance: 'DEMO', ...options }, start + t);
  const zeros = (e, t, value = 0) => ['motion_delta', 'position_delta', 'reel_rotation'].forEach(m => sample(e, m, value, t));
  const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`); };

  check('1. Independent conflict does not promote the self-report', () => {
    const e = engine(); e.report('CABLE-ROVER-01', 'ACTIVE', 'DEMO', start);
    assert.notEqual(e.entity('CABLE-ROVER-01').authoritativeState, 'ACTIVE');
    sample(e, 'state', 'FAULT');
    assert.equal(e.entity('CABLE-ROVER-01').reportedState, 'ACTIVE');
    assert.equal(e.entity('CABLE-ROVER-01').authoritativeState, 'FAULT');
    assert.equal(e.state.discrepancies.length, 1);
  });
  check('2. Stall threshold requires continuous fresh samples for all cable metrics', () => {
    const e = engine(); e.report('CABLE-ROVER-01', 'ACTIVE', 'DEMO', start);
    zeros(e, 0); e.tick(start + 6000); assert.notEqual(e.entity('CABLE-ROVER-01').authoritativeState, 'STALLED');
    for (let t = 7000; t <= 11500; t += 500) zeros(e, t);
    assert.notEqual(e.entity('CABLE-ROVER-01').authoritativeState, 'STALLED');
    zeros(e, 12000); assert.equal(e.entity('CABLE-ROVER-01').authoritativeState, 'STALLED');
    const count = e.state.events.length; for (let i = 0; i < 100; i++) e.tick(start + 12001);
    assert.equal(e.state.events.length, count, 'No repeated event flood');
  });
  check('3. Dependency propagation uses correct directed edges and handles cycles', () => {
    const e = engine(); e.report('CABLE-ROVER-01', 'ACTIVE', 'DEMO', start);
    e.state.relations.push({ id: 'cycle', from: 'CableDeployment-17', type: 'dependsOn', to: 'Habitat-2' });
    for (let t = 0; t <= STALL_THRESHOLD_MS; t += 500) zeros(e, t);
    for (const id of ['CableDeployment-17', 'CableRun-17', 'PowerNode-B', 'Habitat-2']) assert.equal(e.entity(id).authoritativeState, 'AT_RISK');
    assert.notEqual(e.entity('EXC-02').authoritativeState, 'AT_RISK');
  });
  check('4. Resources rank known sites and eligible extraction/transport separately', () => {
    const e = engine(); seedOperationalIntelligence(e);
    const r = e.state.resources.OxygenFeedstock;
    assert.equal(r.shortage, 32); assert.equal(r.priority, 'HIGH'); assert.equal(r.rankedSites[0], 'Highland-A');
    assert.ok(r.candidateRobots.includes('EXC-02')); assert.ok(r.candidateRobots.includes('LOGISTICS-ROVER-01'));
    e.state.robotResources['EXC-02'].collectionRate = 4; e.state.robotResources['EXC-02'].discoveryRate = .2;
    assert.notEqual(e.state.robotResources['EXC-02'].collectionRate, e.state.robotResources['EXC-02'].discoveryRate);
    e.setState(e.entity('EXC-02'), 'STALLED', 'test', 'unavailable', 'DEMO'); e.evaluateResources();
    assert.ok(!r.candidateRobots.includes('EXC-02'));
    e.updateResource(r.id, 160, 150, 'DEMO'); assert.equal(r.shortage, 0);
  });
  check('5. Trusted physical location mismatch invalidates dependent route', () => {
    const e = engine(); e.state.relations.push({ id: 'cable-route', from: 'CABLE-ROVER-01', type: 'routesThrough', to: 'Route-Alpha' });
    sample(e, 'reported_location', { x: 0, y: 0, z: 0 }, 0, { source: 'CABLE-ROVER-01' });
    sample(e, 'physical_location', { x: 2, y: 0, z: 1 });
    assert.ok(e.state.discrepancies.some(d => d.rule === 'location_mismatch' && d.observationSource === 'GO2-01'));
    assert.equal(e.entity('Route-Alpha').authoritativeState, 'AT_RISK');
    assert.equal(e.canAnimate('CABLE-ROVER-01'), false);
  });
  check('6. Trust revocation selects an independent fresh fallback', () => {
    const e = engine();
    e.configureTrust({ id: 'IndependentSensor', role: 'observer', independenceGroup: 'sensor-b', availability: true, trustScore: .8, state: 'AVAILABLE' });
    sample(e, 'state', 'ACTIVE'); sample(e, 'state', 'IDLE', 10, { source: 'IndependentSensor' });
    assert.equal(e.entity('CABLE-ROVER-01').authoritySource, 'GO2-01');
    e.configureTrust({ ...e.state.trustSources['GO2-01'], trustScore: .14 });
    assert.equal(e.entity('CABLE-ROVER-01').authoritySource, 'IndependentSensor');
    assert.equal(e.entity('CABLE-ROVER-01').authoritativeState, 'IDLE');
    e.configurePath({ id: 'local', trust: .93, linkState: 'UP', isolationState: 'CONNECTED' });
    e.configurePath({ id: 'primary', trust: .14, linkState: 'UP', isolationState: 'CONNECTED' });
    assert.equal(e.state.networkPaths.primary.isolationState, 'ISOLATED'); assert.equal(e.state.networkPaths.primary.alternate, 'local');
  });
  check('7. Unsafe/stale navigation holds actors without erasing history or auto-resume', () => {
    const e = engine(); sample(e, 'navigation_safe', true);
    e.tick(start + 2100); assert.equal(e.state.missionStatus.state, 'HOLD');
    const count = e.state.events.length; sample(e, 'navigation_safe', true, 2200);
    assert.equal(e.canAnimate('H04'), false); assert.equal(e.entity('GO2-01').authoritativeState, 'HOLD');
    assert.ok(e.state.events.length >= count);
    e.invalidateEvidence('world switch', start + 2300); assert.ok(e.state.observations.length > 0);
  });
  check('8. Existing UI snapshot has the same four states and consequences', () => {
    const s = new OntologyStore(seed()); s.startCableDemo(start);
    for (let t = 0; t <= 6000; t += 500) s.tickIntelligence(start + t);
    const snapshot = s.getSnapshot(), a = snapshot.semantic.assets['CABLE-ROVER-01'];
    assert.equal(snapshot.analysis.evidence.authoritative.state, a.authoritativeState);
    assert.equal(snapshot.analysis.evidence.reported.state, 'ACTIVE');
    assert.match(snapshot.analysis.evidence.reported.source, /DEMO/);
    assert.equal(snapshot.objects.find(o => o.id === a.id).properties.status, 'STALLED');
    assert.ok(snapshot.objects.some(o => o.type === 'Alert' && o.properties.subjectId === a.id));
    snapshot.semantic.assets[a.id].authoritativeState = 'CORRUPTED'; assert.equal(s.getAssetState(a.id).authoritativeState, 'STALLED');
  });
  check('9. Existing AnimationMixer freezes when its canonical selector pauses it', () => {
    const system = new AnimationSystem(), root = new Group(), e = engine();
    const binding = system.createBinding(root, [new AnimationClip('work', 2, [new NumberKeyframeTrack('.position[x]', [0, 2], [0, 2])])], { id: 'H04', loop: true });
    system.update(.25); const time = binding.action.time; assert.ok(time > 0);
    e.hold('Unsafe local navigation', 'DEMO'); root.userData.semanticPaused = !e.canAnimate('H04');
    system.update(.25); assert.equal(binding.action.time, time); system.dispose();
  });
  check('10. Provenance reconstructs report, observations, threshold, authority and consequence', () => {
    const e = engine(); e.report('CABLE-ROVER-01', 'ACTIVE', 'DEMO', start);
    for (let t = 0; t <= 5000; t += 500) zeros(e, t);
    const events = e.state.events;
    for (const rule of ['asset_report', 'observation_received', 'asset_stall', 'blocked_dependency', 'mission_status']) assert.ok(events.some(event => event.rule === rule));
    const d = e.state.discrepancies[0]; assert.ok(d.evidenceIds.length >= 30);
    for (const id of d.evidenceIds) assert.ok(e.state.observations.some(o => o.id === id && o.provenance === 'DEMO'));
    e.resolveDiscrepancy(d.id, 'Inspection recorded'); assert.ok(d.resolvedAt); assert.equal(e.entity(d.target).authoritativeState, 'STALLED');
  });
  check('Reject malformed, stale, duplicate, reordered, self and low-confidence evidence', () => {
    const e = engine(), first = sample(e, 'motion_delta', 0);
    e.ingest(first, start); assert.equal(e.state.observations.length, 1);
    assert.throws(() => e.ingest({ ...first, value: 3 }, start), /id_reused/);
    assert.throws(() => sample(e, 'motion_delta', 0), /out_of_order/);
    assert.throws(() => e.ingest({ ...first, id: 'stale' }, start + 5000), /stale/);
    assert.throws(() => sample(e, 'motion_delta', NaN, 1), /numeric/);
    assert.throws(() => sample(e, 'state', 'ACTIVE', 1, { target: 'unregistered-splat' }), /unknown/);
    sample(e, 'state', 'ACTIVE', 1, { source: 'CABLE-ROVER-01' }); assert.notEqual(e.entity('CABLE-ROVER-01').authoritativeState, 'ACTIVE');
    sample(e, 'state', 'FAULT', 2, { confidence: .1 }); assert.notEqual(e.entity('CABLE-ROVER-01').authoritativeState, 'FAULT');
  });
  check('Positive motion and a sampling gap reset the stall window', () => {
    const e = engine(); e.report('CABLE-ROVER-01', 'ACTIVE', 'DEMO', start);
    for (let t = 0; t < 5000; t += 500) zeros(e, t);
    zeros(e, 5000, 1); zeros(e, 5500); zeros(e, 6000);
    assert.notEqual(e.entity('CABLE-ROVER-01').authoritativeState, 'STALLED');
  });
  check('Live evidence supersedes demo samples; seal conflict gates the actual door selector', () => {
    const e = engine(); sample(e, 'state', 'IDLE', 0, { provenance: 'LIVE' });
    sample(e, 'state', 'FAULT', 1); assert.equal(e.entity('CABLE-ROVER-01').authoritativeState, 'IDLE');
    e.report('Airlock-2A', 'SEALED', 'DEMO', start);
    sample(e, 'seal_intact', false, 2, { target: 'Airlock-2A' });
    assert.equal(e.entity('Airlock-2A').authoritativeState, 'LEAK_SUSPECTED'); assert.equal(e.canAnimate('Airlock-2A'), false);
  });
  check('Existing relay accepts observations only with current scene context and no pose calls', () => {
    const store = new OntologyStore(seed()), registry = new AssetRegistry([]), robot = new Group(); let moves = 0;
    const map = new LiveMapState({ registry, ontology: store, robot: () => robot, world: () => ({ identity: 'test-world', ready: true, hold: null, metersToWorldUnits: 1 }), applyPose: () => { moves++; return null; }, legacyTelemetryActive: () => false }, 'test-browser', 'http://127.0.0.1:5173/');
    const obs = map.observation(), now = Date.now();
    const command = { id: 'rpc', kind: 'intelligence', body: { command_id: 'command-1', op: 'observation', observation: { id: 'relay-observation', source: 'GO2-01', target: 'CABLE-ROVER-01', timestamp: now, metric: 'motion_delta', value: 0, confidence: .94, provenance: 'DEMO' } }, context: { scene_session_id: obs.scene_session_id, scene_revision: obs.scene_revision, observation_sequence: obs.observation_sequence, read_at: now }, expires_at: now + 1000 };
    assert.equal(map.handle({ ...command, context: null }).status, 409);
    const response = map.handle(command); assert.equal(response.status, 200); assert.equal(response.body.observation.intelligence.observations.at(-1).id, 'relay-observation');
    assert.equal(moves, 0); map.resetNotice('world_changed'); assert.equal(map.handle(command).status, 409);
  });
  console.log(`${passed} ontology acceptance and boundary checks passed; no hardware connections.`);
} finally { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }

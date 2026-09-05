import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import { Group, Vector3 } from 'three';
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
after(() => server.close());
const { LiveMapState } = await server.ssrLoadModule('/src/relay/LiveMapState.ts');
function fixture() {
  const scene = new Group(), parent = new Group(), rover = new Group(), robot = new Group();
  scene.add(parent, robot); parent.position.set(10, 2, 4); parent.add(rover); rover.position.set(2, 1, 3);
  let identity = 'SCENE_1', hold = null;
  const assets = [{config: {id: 'EXC-01'}, root: rover}];
  const state = new LiveMapState({
    registry: { values: () => assets, get: id => assets.find(a => a.config.id === id) },
    ontology: { getSnapshot: () => ({objects: [{id: 'EXC-01',type:'Excavator',properties:{status:'STAGED'}}]}), selectEntity() {}, setDemoMissionState() {} },
    robot: () => robot, world: () => ({identity,ready:true,hold,metersToWorldUnits:1}),
    legacyTelemetryActive: () => false,
    applyPose: (p,yaw) => {robot.position.set(p.x,p.y,p.z);robot.rotation.y=yaw;return null;},
  }, 'fixture-browser', 'http://localhost:5173/');
  const context = () => {const o=state.observation(); return {scene_session_id:o.scene_session_id,scene_revision:o.scene_revision,observation_sequence:o.observation_sequence,read_at:Date.now()};};
  const send = (kind,body={},ctx=context()) => state.handle({id:crypto.randomUUID(),kind,body:{command_id:crypto.randomUUID(),...body},context:ctx,expires_at:Date.now()+1000});
  return {state,robot,rover,parent,send,context,world: v=>identity=v,hold:v=>hold=v};
}
test('positions come from current nested Object3D world transforms; semantic allowlist only',()=>{
  const f=fixture();let entity=f.state.observation().entities[0];assert.deepEqual(entity.world_position,{x:12,y:3,z:7});
  f.parent.position.x=20;entity=f.state.observation().entities[0];assert.equal(entity.world_position.x,22);
  assert.equal(entity.id,'rover-1');assert.equal(entity.scene_object_id,'EXC-01');assert.equal(entity.line_of_sight,null);
  assert.deepEqual(entity.currently_valid_actions,['approach']);
});
test('out-of-range preserves run/phase, full semantic progression and reset are reversible',()=>{
  const f=fixture();assert.equal(f.send('mission',{op:'start',target_id:'rover-1',mode:'rehearsal'}).status,200);
  f.send('mission',{op:'arm'});f.send('mission',{op:'phase',phase:'APPROACHING'});
  const reject=f.send('interaction',{entity_id:'rover-1',action:'inspect'});
  assert.equal(reject.body.error,'approach_required');assert.equal(reject.body.observation.mission_state.phase,'APPROACHING');
  f.robot.position.set(12,3,8);
  for(const [action,expected,next] of [['inspect','inspected','activate'],['activate','ready','verify'],['verify','VERIFIED',null]]){
    const r=f.send('interaction',{entity_id:'rover-1',action});assert.equal(r.status,200);
    assert.equal(r.body.observation.entities[0].state,expected);
    assert.deepEqual(r.body.observation.entities[0].currently_valid_actions,next?[next]:[]);
    assert.equal(f.rover.userData.mapMissionState,expected);
  }
  // VERIFIED disarms but does not end the run: the scene traverse re-arms for later legs while
  // the excavator's own interactions stay closed.
  assert.equal(f.state.observation().mission_state.map_armed,false);
  assert.equal(f.send('mission',{op:'arm'}).status,200);
  assert.equal(f.send('interaction',{entity_id:'rover-1',action:'verify'}).body.error,'invalid_action_for_state');
  assert.equal(f.send('reset',{scope:'mission'}).body.observation.entities[0].state,'offline');
});
test('world and entity changes reject pending actions, retain pose, and disarm',()=>{
  const f=fixture();f.send('mission',{op:'start',target_id:'rover-1',mode:'rehearsal'});f.send('mission',{op:'arm'});
  const c=f.context();f.rover.position.x++;assert.equal(f.send('interaction',{entity_id:'rover-1',action:'inspect'},c).body.error,'scene_changed_read_observation');
  const old=f.context();f.world('SCENE_2');f.robot.position.set(99,0,0);
  const out=f.send('mission',{op:'arm'},old);assert.equal(out.status,409);
  assert.notEqual(out.body.observation.scene_session_id,old.scene_session_id);assert.equal(out.body.observation.mission_state.map_armed,false);
  assert.equal(f.robot.position.x,0);
});
test('telemetry freezes without extrapolation, requires fresh context, rejects stale/reordered packets',()=>{
  const f=fixture();f.send('mission',{op:'start',target_id:'rover-1',mode:'telemetry'});
  const sample={connected:true,source:'physical_odometry',frame:'three_world',position:{x:1,y:0,z:0},yaw:0,sample_sequence:1,timestamp_ms:Date.now()};
  assert.equal(f.send('telemetry',sample).status,200);assert.equal(f.send('mission',{op:'arm'}).status,200);
  assert.equal(f.send('telemetry',sample).body.error,'out_of_order_telemetry');
  const context=f.context();f.state.tick(Date.now()+2100);
  assert.equal(f.state.observation().mission_state.phase,'HELD');assert.deepEqual(f.robot.position,new Vector3(1,0,0));
  assert.equal(f.send('mission',{op:'arm'},context).body.error,'scene_changed_read_observation');
  assert.equal(f.send('mission',{op:'arm'}).body.error,'run_ready_and_fresh_telemetry_required');
  assert.equal(f.send('telemetry',{...sample,sample_sequence:2,timestamp_ms:Date.now()-5000}).body.error,'stale_telemetry_timestamp');
  assert.equal(f.send('telemetry',{...sample,sample_sequence:2,timestamp_ms:Date.now()}).status,200);
  assert.equal(f.send('mission',{op:'arm'}).status,200);
  f.send('telemetry',{connected:false,source:'physical_odometry'});assert.equal(f.state.observation().mission_state.map_armed,false);assert.equal(f.state.ownsPose(),true);
});
test('duplicate commands cannot apply an interaction twice; expiry has no side effect',()=>{
  const f=fixture();f.robot.position.set(12,3,8);f.send('mission',{op:'start',target_id:'rover-1',mode:'rehearsal'});f.send('mission',{op:'arm'});
  const b={command_id:'one',entity_id:'rover-1',action:'inspect'};
  assert.equal(f.send('interaction',b).status,200);assert.equal(f.send('interaction',b).status,200);
  assert.equal(f.state.observation().entities[0].state,'inspected');
  assert.equal(f.send('interaction',{...b,action:'activate'}).body.error,'command_id_reused');
  const r=f.state.handle({id:'expired',kind:'reset',body:{scope:'mission'},context:f.context(),expires_at:0});
  assert.equal(r.body.error,'expired_command');assert.equal(f.state.observation().entities[0].state,'inspected');
});
test('relay authority: a pinned publisher that went silent for 10 s is replaced by a visible local tab',async()=>{
  // Regression: after a tab reload/close the pin (`globalThis` symbol) survived forever and every new tab
  // got authority_already_pinned until Vite was restarted. Drives the plugin middleware directly.
  const { mapRelayPlugin } = await import('../server/mapRelay.js');
  delete globalThis[Symbol.for('moontology.authoritativeBrowser')];
  let handler; mapRelayPlugin().configureServer({ ws: { on() {} }, middlewares: { use(fn) { handler = fn; } } });
  const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
  const call = async (path, body, method = 'POST') => {
    const raw = JSON.stringify(body ?? {});
    const req = { url: path, method, headers: { host: '127.0.0.1:5173' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { if (method === 'POST') yield raw; } };
    let status = 0, out = '';
    const res = { writeHead(s) { status = s; }, end(v) { out = v; } };
    await handler(req, res, () => {}); return { status, body: JSON.parse(out) };
  };
  try {
    let r = await call('/api/map/publisher/claim', { browser_id: 'tab-A', presentation_visible: true }); assert.equal(r.status, 200);
    r = await call('/api/map/publisher/claim', { browser_id: 'tab-B', presentation_visible: true }); assert.equal(r.body.error, 'authority_already_pinned');
    offset = 5000;  // silent, but not yet presumed dead
    r = await call('/api/map/publisher/claim', { browser_id: 'tab-B', presentation_visible: true }); assert.equal(r.body.error, 'authority_already_pinned');
    offset = 11000; // dead: a hidden tab still may not take over, a visible one does
    r = await call('/api/map/publisher/claim', { browser_id: 'tab-B', presentation_visible: false }); assert.equal(r.body.error, 'authority_already_pinned');
    r = await call('/api/map/publisher/claim', { browser_id: 'tab-B', presentation_visible: true }); assert.equal(r.status, 200); assert.equal(r.body.browser_id, 'tab-B');
    r = await call('/api/map/publisher/claim', { browser_id: 'tab-A', presentation_visible: true }); assert.equal(r.body.error, 'authority_already_pinned');
  } finally { Date.now = realNow; delete globalThis[Symbol.for('moontology.authoritativeBrowser')]; }
});

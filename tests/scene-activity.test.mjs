import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
const server=await createServer({configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
after(()=>server.close());
const { BackgroundTraffic, BACKGROUND_ROUTES }=await server.ssrLoadModule('/src/vehicles/BackgroundTraffic.ts');
const { chooseNearbyHumanoid }=await server.ssrLoadModule('/src/ui/HumanoidProximityOverlay.ts');
const { WorldLayout }=await server.ssrLoadModule('/src/world/WorldLayout.ts');
const { SCENE_1_LAYOUT }=await server.ssrLoadModule('/src/levels/sceneLayouts.ts');
const { SceneGrounding }=await server.ssrLoadModule('/src/world/SceneGrounding.ts');
const { AssetRegistry }=await server.ssrLoadModule('/src/assets/AssetRegistry.ts');
const { OntologyStore }=await server.ssrLoadModule('/src/ontology/OntologyStore.ts');
const { createLunarBaseOntologySeed }=await server.ssrLoadModule('/src/ontology/demoOntology.ts');
const { level1 }=await server.ssrLoadModule('/src/levels/level1.ts');
const { LiveMapState }=await server.ssrLoadModule('/src/relay/LiveMapState.ts');
function fixture() {
  const registry=new AssetRegistry(level1.assets), scene=new Group(), layout=new WorldLayout(SCENE_1_LAYOUT,scene,new Group());
  for(const route of BACKGROUND_ROUTES) {
    const config=level1.assets.find(a=>a.id===route.id),root=new Group(),model=new Group();
    root.position.fromArray(config.position);root.add(model);scene.add(root);
    model.add(new Mesh(new BoxGeometry(1.2,.5,2.6),new MeshBasicMaterial()));
    for(const name of ['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']) {const wheel=new Group();wheel.name=name;wheel.userData.radius=.3;model.add(wheel);}
    registry.register({config,root,model,animation:null,animations:[],normalization:null});
  }
  const ontology=new OntologyStore(createLunarBaseOntologySeed(level1)),grounding=new SceneGrounding(registry,layout);
  grounding.update();const traffic=new BackgroundTraffic(registry,layout,ontology);grounding.update();
  ontology.setLayoutProvider(()=>layout.observation());
  return {registry,scene,layout,ontology,traffic,grounding,step(dt=.05,robot=null,enabled=true){traffic.update(dt,robot,enabled);grounding.update();}};
}
test('staggered routes loop continuously with wheels, live contact and no cable changes',()=>{
  const f=fixture(), first=f.registry.get('ROVER-01').root.position.clone();
  for(let i=0;i<100;i++)f.step();assert.deepEqual(f.registry.get('ROVER-01').root.position,first);
  for(let i=0;i<180;i++)f.step();assert.ok(f.registry.get('ROVER-01').root.position.distanceTo(first)>1);
  assert.equal(f.traffic.report()[1].state,'WAITING');
  for(let i=0;i<5000;i++)f.step();
  for(const v of f.traffic.report()) {assert.ok(v.laps>=1,JSON.stringify(v));assert.ok(Math.abs(v.position[1]-SCENE_1_LAYOUT.supportFloor.topY-.25)<1e-6);}
  assert.ok(!f.registry.get('ROVER-01').model.getObjectByName('Wheel_FL').quaternion.equals(new Group().quaternion));
  assert.equal(f.ontology.getSnapshot().objects.find(o=>o.id==='CABLE-ROVER-01').properties.status,'STAGED');
  assert.equal(f.ontology.getSnapshot().objects.find(o=>o.id==='ROVER-01').properties.status,'STAGED','visual motion does not overwrite semantic truth');
  assert.deepEqual([...f.grounding.issues],[]);f.traffic.dispose();
});
test('Go2 proximity, holds, long frames and external placement edits stop traffic',()=>{
  const f=fixture(),robot=new Group();robot.position.copy(f.registry.get('ROVER-01').root.position);
  for(let i=0;i<400;i++)f.step(.05,robot);
  const root=f.registry.get('ROVER-01').root,p=root.position.clone();
  assert.equal(f.traffic.report()[0].state,'YIELDING');assert.deepEqual(root.position,p);
  f.step(90);assert.deepEqual(root.position,p);f.step(.05,null,false);assert.deepEqual(root.position,p);
  root.position.x+=.4;f.step();assert.equal(f.traffic.report()[0].state,'EDITED');
  const edited=root.position.clone();for(let i=0;i<100;i++)f.step();assert.deepEqual(root.position,edited);
  assert.equal(root.userData.sceneMotionSource,undefined);f.traffic.dispose();
});
test('a hardware fault stops background motion and cannot be overwritten by animation',()=>{
  const f=fixture();for(let i=0;i<300;i++)f.step();
  const root=f.registry.get('ROVER-01').root,p=root.position.clone();
  f.ontology.setAssetHealth('ROVER-01','FAILED');
  for(let i=0;i<100;i++)f.step();
  assert.deepEqual(root.position,p);assert.equal(f.traffic.report()[0].state,'HELD');
  assert.equal(f.ontology.getSnapshot().objects.find(o=>o.id==='ROVER-01').properties.status,'FAILED');
  f.traffic.dispose();
});
test('scheduled motion is live in observations without starving command revisions; edits still invalidate',()=>{
  const f=fixture(),robot=new Group();f.scene.add(robot);
  const state=new LiveMapState({registry:f.registry,ontology:f.ontology,robot:()=>robot,
    world:()=>({identity:'SCENE_1',ready:true,hold:null,metersToWorldUnits:1}),legacyTelemetryActive:()=>false,applyPose:()=>null},'traffic-test','http://localhost');
  const before=state.observation();
  for(let i=0;i<300;i++){f.step();state.tick();}
  const after=state.observation();
  assert.notDeepEqual(after.entities[0].world_position,before.entities[0].world_position);
  assert.equal(after.scene_revision,before.scene_revision);
  assert.ok(after.observation_sequence>before.observation_sequence);
  f.registry.get('ROVER-01').root.position.x+=.5;f.step();
  assert.ok(state.observation().scene_revision>after.scene_revision);f.traffic.dispose();
});
test('nearby graph uses hysteresis, clears at range, and never changes ontology selection or evidence',()=>{
  assert.equal(chooseNearbyHumanoid([{id:'H03',distance:3.5}],null),'H03');
  assert.equal(chooseNearbyHumanoid([{id:'H03',distance:4.2}],'H03'),'H03');
  assert.equal(chooseNearbyHumanoid([{id:'H03',distance:4.5}],'H03'),null);
  assert.equal(chooseNearbyHumanoid([{id:'H03',distance:NaN}],null),null);
  const store=new OntologyStore(createLunarBaseOntologySeed(level1)),before=store.getSnapshot();
  const brief=store.getProximityBrief('H03');assert.match(brief.task,/Thermal/);assert.match(brief.hardware,/Unverified/);
  assert.equal(brief.result,'UNVERIFIED');assert.match(brief.evidence,/pending/);
  assert.equal(store.getSnapshot().selectedEntityId,before.selectedEntityId);assert.equal(store.getSnapshot().revision,before.revision);
  store.createDiscrepancy('H03','Cooling inspection required');assert.match(store.getProximityBrief('H03').hardware,/1 open/);
  assert.equal(store.getProximityBrief('H03').result,'DISCREPANCY');
  assert.equal(store.getSnapshot().objects.filter(o=>o.type==='Observation').length,0);
});

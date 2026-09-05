import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import { Group, PerspectiveCamera, Vector3 } from 'three';
const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
after(() => server.close());
const { level1 } = await server.ssrLoadModule('/src/levels/level1.ts');
const { SCENE_1_STOPS, SCENE_1_ROUTE_IDS, EQUIPMENT_STAGING } = await server.ssrLoadModule('/src/levels/scene1DemoRoute.ts');
const { SceneDirector } = await server.ssrLoadModule('/src/runtime/SceneDirector.ts');
const { createLunarBaseOntologySeed } = await server.ssrLoadModule('/src/ontology/demoOntology.ts');
const { OntologyStore } = await server.ssrLoadModule('/src/ontology/OntologyStore.ts');
const { Go2FollowCamera } = await server.ssrLoadModule('/src/controls/Go2FollowCamera.ts');
test('stops have separate trigger areas, reachable viewing marks and matching ontology tasks', () => {
 const seed = createLunarBaseOntologySeed(level1), ids = new Set(seed.objects.map(o => o.id));
 for (const stop of SCENE_1_STOPS) {
   const actor = level1.assets.find(a => a.id === stop.id);
   assert.deepEqual(actor.position, stop.position);
   assert.ok(Math.hypot(stop.stop[0] - stop.position[0], stop.stop[2] - stop.position[2]) < 2);
   assert.equal(seed.objects.find(o => o.id === stop.id).properties.currentTask, stop.taskId);
   assert.ok(ids.has(stop.taskId));
   for (const other of SCENE_1_STOPS) if (other.id !== stop.id) assert.ok(Math.hypot(stop.position[0]-other.position[0],stop.position[2]-other.position[2]) > 4);
 }
 for (const r of seed.relations) assert.ok(ids.has(r.from) && ids.has(r.to));
 assert.ok(!JSON.stringify(seed).includes('H05'));
 const rovers = Object.entries(EQUIPMENT_STAGING).filter(([id]) => id !== 'PowerNode-B');
 for (const [id,a] of rovers) for (const [other,b] of rovers) if(id !== other) assert.ok(Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2]) > 5);
});
test('route order blocks later actors, with once-only completion and explicit reset', () => {
 const d = new SceneDirector(SCENE_1_ROUTE_IDS); d.arm(); assert.equal(d.cue('H06'), false);
 const targets = SCENE_1_STOPS.map(s => ({id:s.id,x:s.position[0],z:s.position[2],duration:0.1}));
 for(const target of targets) {
   assert.equal(d.nextId,target.id);
   for(let i=0;i<75;i++) d.update(.05,{x:target.x,z:target.z},targets,null);
   assert.ok(d.completed.has(target.id)); assert.equal(d.cue(target.id),false);
 }
 assert.equal(d.state,'complete');d.reset();assert.equal(d.nextId,'H04');
});
test('scene cues select ontology without fabricating physical observations or task completion', () => {
 const store = new OntologyStore(createLunarBaseOntologySeed(level1));
 store.setSceneCue('H03','Fatigue check','PLAYING');
 let s = store.getSnapshot(); assert.equal(s.selectedEntityId,'H03');assert.equal(s.analysis.evidence.result,'UNVERIFIED');
 store.setSceneCue('H03','Fatigue check','COMPLETE');s=store.getSnapshot();
 assert.equal(s.objects.find(o=>o.id==='WorkerRecovery-12').properties.status,'PLANNED');
 assert.equal(s.objects.filter(o=>o.type==='Observation'||o.type==='TelemetryReport').length,0);
});
test('chase camera follows root translation and yaw without changing the robot', () => {
 const root = new Group(), camera = new PerspectiveCamera(), follow = new Go2FollowCamera(camera,root);
 follow.update(0,true);assert.ok(camera.position.x<0);assert.ok(follow.target.x>0);
 root.position.set(3,0,4);root.rotation.y=Math.PI/2;
 for(let i=0;i<120;i++)follow.update(1/60);
 assert.ok(camera.position.z>root.position.z);assert.ok(follow.target.z<root.position.z);
 assert.ok(camera.position.distanceTo(new Vector3(3,2.05,7.8))<.01);
 assert.deepEqual(root.position.toArray(),[3,0,4]);
});
test('selection outline uses the proxy without scanning animated hero geometry', async () => {
 const { SceneEntityHighlighter } = await server.ssrLoadModule('/src/world/SceneEntityHighlighter.ts');
 const { BoxGeometry, Mesh, MeshBasicMaterial } = await import('three');
 const root = new Group(), proxy = new Mesh(new BoxGeometry(1,2,1), new MeshBasicMaterial());
 proxy.userData.humanoidSelectionProxy = true; root.add(proxy);
 const expensive = new Mesh(new BoxGeometry(1,2,1),new MeshBasicMaterial());
 expensive.getVertexPosition = () => { throw Error('Outline must not scan hero vertices'); };root.add(expensive);
 const outline = new SceneEntityHighlighter();outline.select(root,false);outline.update();assert.equal(outline.object.visible,true);outline.dispose();
});

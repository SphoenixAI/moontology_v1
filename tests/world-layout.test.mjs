import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import { createServer } from 'vite';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Group, Vector3 } from 'three';
const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
after(() => server.close());
const { WorldLayout } = await server.ssrLoadModule('/src/world/WorldLayout.ts');
const { SCENE_1_LAYOUT } = await server.ssrLoadModule('/src/levels/sceneLayouts.ts');
const { SCENE_1_STOPS, EQUIPMENT_STAGING } = await server.ssrLoadModule('/src/levels/scene1DemoRoute.ts');
const { AIRLOCK_PLACEMENT, THRESHOLD_WORLD } = await server.ssrLoadModule('/src/levels/airlockPlacement.ts');
const bytes = fs.readFileSync('public/worldlabs/lunar-base/Moon Base with Habitats_collider.glb');
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const root = new Group(); root.add(gltf.scene);
const layout = new WorldLayout(SCENE_1_LAYOUT, root, gltf.scene);

test('actual collider gives local floor height instead of zero at every demo stop', () => {
  for (const stop of SCENE_1_STOPS) {
    const support = layout.sample(stop.position[0], stop.position[2]);
    assert.ok(support.traversable, `${stop.id}: ${support.reason}`);
    assert.ok(support.height < -.35 && support.height > -.9, `${stop.id}: ${support.height}`);
    assert.ok(layout.footprint(stop.stop[0], stop.stop[2]).traversable, stop.id);
  }
  assert.equal(layout.sample(-9.4,5).traversable, false, 'old excavator position is inside the building');
  const p = EQUIPMENT_STAGING['EXC-02'].position;
  assert.ok(layout.footprint(p[0],p[2],1.6).traversable, 'new excavator footprint clears the building');
});
test('walls, unknown areas and swept large moves block; door corridor stays accessible', () => {
  assert.equal(layout.sample(-5,-19).traversable, false);
  assert.equal(layout.sample(40,0).kind, 'unknown');
  const wall = layout.constrain(new Vector3(-6,-.5,0),new Vector3(-15,-.5,9));
  assert.ok(wall.blocked); assert.ok(wall.position.z < 5);
  const [x,,z] = AIRLOCK_PLACEMENT.position;
  const entry = layout.constrain(new Vector3(x,0,z+3),new Vector3(x,0,z));
  assert.equal(entry.blocked,null); assert.ok(THRESHOLD_WORLD.containsPoint(entry.position));
  const through = layout.constrain(entry.position, new Vector3(x,0,z-5));
  assert.ok(through.blocked); assert.ok(through.position.z > z-1);
});
test('all route legs can be walked without crossing a building', () => {
  const route = [[1.5,5],...SCENE_1_STOPS.map(s=>[s.stop[0],s.stop[2]]),[-.9,-15],[-.9,-18.35]];
  for(let i=1;i<route.length;i++) {
    const [x,z]=route[i-1], [xx,zz]=route[i];
    const result = layout.constrain(new Vector3(x,0,z),new Vector3(xx,0,zz));
    assert.equal(result.blocked,null, `route leg ${i}: ${result.blocked}`);
  }
});
test('live obstacle additions, moves and removals change traversal and observation', () => {
  const before=layout.observation().obstacleRevision;
  layout.setObstacles([{id:'equipment',polygon:[[1,4],[2,4],[2,6],[1,6]]}]);
  assert.equal(layout.sample(1.5,5).traversable,false);
  assert.ok(layout.observation().obstacleRevision>before);
  layout.setObstacles([]); assert.equal(layout.sample(1.5,5).traversable,true);
});
test('ground and boundary observations use the current world transform', () => {
  const y=layout.sample(1.5,5).height;
  root.position.set(10,2,0);root.rotation.y=Math.PI/2;root.scale.setScalar(2);root.updateMatrixWorld(true);
  const p=root.localToWorld(new Vector3(1.5,0,5));
  assert.ok(Math.abs(layout.sample(p.x,p.z).height - (y*2+2)) < 1e-6);
  const first=layout.observation().regions[0].polygon[0];
  const expected=root.localToWorld(new Vector3(-17,0,-23));assert.ok(Math.abs(first[0]-expected.x)<1e-6);
  root.position.set(0,0,0);root.rotation.y=0;root.scale.setScalar(1);root.updateMatrixWorld(true);
});
test('actual equipment footprints are grounded and clear building shells', async () => {
  const { level1 } = await server.ssrLoadModule('/src/levels/level1.ts');
  const { AssetRegistry } = await server.ssrLoadModule('/src/assets/AssetRegistry.ts');
  const { SceneGrounding } = await server.ssrLoadModule('/src/world/SceneGrounding.ts');
  const { scaleObjectToLength, placeObjectBottomAtY } = await server.ssrLoadModule('/src/assets/physicalScale.ts');
  const registry = new AssetRegistry(level1.assets), scene = new Group();
  const { Box3 } = await import('three');
  for (const config of level1.assets.filter(a=>a.src && a.type !== 'humanoid')) {
    // Parse original geometry with materials omitted for Node; never rewrite assets.
    const source=fs.readFileSync('public'+decodeURIComponent(config.src));
    const jsonLength=source.readUInt32LE(12), doc=JSON.parse(source.subarray(20,20+jsonLength));
    for(const mesh of doc.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
    delete doc.images;delete doc.textures;delete doc.materials;delete doc.samplers;
    let js=Buffer.from(JSON.stringify(doc));js=Buffer.concat([js,Buffer.alloc((4-js.length%4)%4,32)]);
    const binary=source.subarray(20+jsonLength), out=Buffer.alloc(20+js.length+binary.length);
    source.copy(out,0,0,12);out.writeUInt32LE(out.length,8);out.writeUInt32LE(js.length,12);out.writeUInt32LE(0x4e4f534a,16);js.copy(out,20);binary.copy(out,20+js.length);
    const model=(await new GLTFLoader().parseAsync(out.buffer,'')).scene;
    const entity=new Group();entity.position.fromArray(config.position);entity.rotation.set(...config.rotation);entity.add(model);scene.add(entity);
    scaleObjectToLength(entity,config.targetLengthMeters);placeObjectBottomAtY(entity,0);
    registry.register({config,root:entity,model,normalization:null,animations:[],animation:null});
  }
  const grounding=new SceneGrounding(registry,layout);grounding.update();
  assert.deepEqual([...grounding.issues],[]);
  for(const a of registry.values()) {
    const bounds=new Box3().setFromObject(a.model);
    assert.ok(Math.abs(bounds.min.y-a.root.userData.surfaceY)<1e-5,a.config.id);
    assert.equal(a.root.userData.layoutStatus,'GROUNDED');
  }
  const route = [[1.5,5],...SCENE_1_STOPS.map(s=>[s.stop[0],s.stop[2]]),[-.9,-15],[-.9,-18.35]];
  for(let i=1;i<route.length;i++) {
    const [x,z]=route[i-1], [xx,zz]=route[i];
    const result=layout.constrain(new Vector3(x,0,z),new Vector3(xx,0,zz));
    assert.equal(result.blocked,null,`equipment blocks route leg ${i}: ${result.blocked}`);
  }
  const excavator=registry.get('EXC-02'), accepted=excavator.root.position.clone();
  excavator.root.position.set(-9.4,0,5); grounding.update();
  assert.ok(excavator.root.position.distanceTo(accepted)<1e-6, 'invalid edit restores the accepted placement');
  assert.ok(layout.observation().obstacles.some(o=>o.id==='EXC-02'));
  registry.unregister('EXC-02');grounding.update();
  assert.ok(!layout.observation().obstacles.some(o=>o.id==='EXC-02'));
  layout.setObstacles([]);
});
test('animated foot contact stays grounded without changing source scale or root X/Z', async () => {
  const { SceneGrounding } = await server.ssrLoadModule('/src/world/SceneGrounding.ts');
  const { AssetRegistry } = await server.ssrLoadModule('/src/assets/AssetRegistry.ts');
  const { Mesh, BoxGeometry, MeshBasicMaterial, Box3 } = await import('three');
  const scene=new Group(), entity=new Group(), normalization=new Group(), model=new Group();
  entity.position.set(1.5,0,5);entity.add(normalization);normalization.add(model);scene.add(entity);
  const feet = ['LeftFoot','RightFoot'].map((name,i)=>{
    const foot=new Group();foot.name=name;foot.position.set(i*.2, .7,0);
    foot.add(new Mesh(new BoxGeometry(.1,.1,.2),new MeshBasicMaterial()));model.add(foot);return foot;
  });
  const config={id:'worker-test',type:'humanoid',src:'/fixture.glb'};
  const registry=new AssetRegistry([config]);registry.register({config,root:entity,model});
  const grounding=new SceneGrounding(registry,layout), scale=model.scale.clone();
  grounding.update();
  const ground=layout.sample(1.5,5,false).height;
  assert.ok(Math.abs(new Box3().setFromObject(model).min.y-ground)<1e-6);
  feet[0].position.y+=.6;feet[1].position.y+=.2;grounding.update();
  assert.ok(Math.abs(new Box3().setFromObject(model).min.y-ground)<1e-6);
  assert.equal(entity.position.x,1.5);assert.equal(entity.position.z,5);assert.deepEqual(model.scale,scale);
  layout.setObstacles([]);
});

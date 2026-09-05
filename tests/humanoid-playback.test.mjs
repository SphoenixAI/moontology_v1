import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { AnimationClip, Group, NumberKeyframeTrack, LoopRepeat } from 'three';
import { createServer } from 'vite';
const server = await createServer({configFile:false,cacheDir:'/tmp/moontology-humanoid-playback-test-cache',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
after(()=>server.close());
const { AnimationSystem, setLoopingPlayback } = await server.ssrLoadModule('/src/animation/AnimationSystem.ts');

test('humanoid work loops beyond its first clip without restarting each frame; pause/resume retains phase', () => {
  const system=new AnimationSystem(), root=new Group();
  const clip=new AnimationClip('work',1,[new NumberKeyframeTrack('.rotation[y]',[0,1],[0,.25])]);
  const binding=system.createBinding(root,[clip],{id:'worker',loop:false});
  for(let i=0;i<85;i++) {setLoopingPlayback(binding,false);system.update(.05);}
  assert.equal(binding.action.loop,LoopRepeat);
  assert.ok(Math.abs(binding.action.time-.25)<1e-6,'phase advances through four full loops');
  assert.equal(binding.action.paused,false);
  const phase=binding.action.time, yaw=root.rotation.y;
  for(let i=0;i<20;i++) {setLoopingPlayback(binding,true);system.update(.05);}
  assert.equal(binding.action.time,phase);assert.equal(root.rotation.y,yaw);
  setLoopingPlayback(binding,false);system.update(.1);
  assert.ok(Math.abs(binding.action.time-phase-.1)<1e-6,'resume does not restart');
  setLoopingPlayback(binding,true,true);assert.equal(binding.action.time,0);
  assert.equal(binding.action.paused,true);system.dispose();
});

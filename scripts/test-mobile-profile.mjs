import assert from 'node:assert/strict';
import console from 'node:console';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cacheDir=await mkdtemp(join(tmpdir(),'moontology-mobile-test-'));
const server=await createServer({configFile:false,cacheDir,optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try {
  const {isMobileDevice,mobileBudget}=await server.ssrLoadModule('/src/runtime/deviceProfile.ts');
  assert.equal(isMobileDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',5),true);
  assert.equal(isMobileDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)',5),true);
  assert.equal(isMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',5),true,'iPad desktop UA must use mobile assets');
  assert.equal(isMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',0),false);
  assert.equal(isMobileDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)',0),false);
  assert.equal(mobileBudget.pixelRatio,1); assert.equal(mobileBudget.fps,30);
  assert.equal(mobileBudget.pagedSplats%65536,0);
  assert.ok(mobileBudget.renderSplats<=mobileBudget.pagedSplats);
  const {publicAssetUrl}=await server.ssrLoadModule('/src/assets/publicAssetUrl.ts');
  assert.equal(publicAssetUrl('/models/example.glb'),'/models/example.glb','local presentation remains local');
  console.log('Mobile/iPad detection, bounded rendering, and unchanged local asset routing passed.');
} finally {await server.close();await rm(cacheDir,{recursive:true,force:true});}

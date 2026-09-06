import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import console from 'node:console';
const sha = b => createHash('sha256').update(b).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const originals = JSON.parse(await readFile('docs/public-assets.json', 'utf8'));
const report = { method: 'Mobile-only mesh simplification (0.1% radius error ceiling), 1024px textures. Original rigs and animation samples retained.', assets: [] };
const triangles = doc => doc.getRoot().listMeshes().reduce((sum,m) => sum + m.listPrimitives().reduce((n,p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount())/3,0),0);
const animationSignature = doc => doc.getRoot().listAnimations().map(a => ({name:a.getName(),channels:a.listChannels().map(c=>({node:c.getTargetNode()?.getName(),path:c.getTargetPath(), interpolation:c.getSampler().getInterpolation(),input:sha(c.getSampler().getInput().getArray()),output:sha(c.getSampler().getOutput().getArray())}))}));
for (const source of originals.assets.filter(a=>a.path.endsWith('.glb') && !a.path.includes('_collider'))) {
  const original = await readFile(`public/${source.path}`);
  assert.equal(sha(original),source.sha256);
  const doc = await io.readBinary(original);
  const before = triangles(doc), animation = animationSignature(doc);
  const skins = doc.getRoot().listSkins().map(s=>s.listJoints().map(j=>j.getName()));
  await doc.transform(weld(), simplify({simplifier:MeshoptSimplifier,ratio:Math.min(1,80000/before),error:0.001}));
  for (const texture of doc.getRoot().listTextures()) {
    const img = texture.getImage();
    if (!img) continue;
    // Lossless PNG encoding after mobile-only resizing; no missing maps or material substitution.
    texture.setImage(await sharp(img).resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png().toBuffer()).setMimeType('image/png');
  }
  await doc.transform(prune({keepLeaves:true,keepAttributes:true}));
  const path = `mobile/${source.path}`, output = await io.writeBinary(doc);
  await mkdir(dirname(`public/${path}`),{recursive:true});
  await writeFile(`public/${path}`,output);
  const verified=await io.readBinary(output);
  assert.deepEqual(animationSignature(verified),animation,'Animation keyframes changed');
  assert.deepEqual(verified.getRoot().listSkins().map(s=>s.listJoints().map(j=>j.getName())),skins,'Joint hierarchy changed');
  for(const t of verified.getRoot().listTextures()) {const {width,height}=await sharp(t.getImage()).metadata();assert.ok(width<=1024 && height<=1024);}
  report.assets.push({path,route:source.path,bytes:output.length,sha256:sha(output),sourceSha256:source.sha256,sourceBytes:original.length,sourceTriangles:before,mobileTriangles:triangles(verified),animationClips:animation.map(a=>a.name),animationSamplesUnchanged:true,textureMaxSize:1024});
  await writeFile('docs/mobile-assets.json',JSON.stringify(report,null,2)+'\n');
  console.log(`${source.path}: ${before} → ${triangles(verified)} triangles; ${(output.length/1048576).toFixed(1)} MiB; animation verified`);
}

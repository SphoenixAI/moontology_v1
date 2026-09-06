import { cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import console from 'node:console';
const original=JSON.parse(await readFile('docs/public-assets.json','utf8'));
const report=JSON.parse(await readFile('docs/mobile-assets.json','utf8'));
for(const [route,input] of [
  ['worldlabs/lunar-base/Moon Base with Habitats.spz','/tmp/Moontology-mobile-base-lod.rad'],
  ['worldlabs/scene-2/Futuristic Museum Interiors.spz','/tmp/Moontology-mobile-interior-lod.rad'],
]) {
  const source=original.assets.find(a=>a.path===route);
  const sourceBytes=await readFile(`public/${route}`);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'),source.sha256);
  const path=`mobile/${route.replace(/\.spz$/,'.rad')}`;
  await cp(input,`public/${path}`);
  const output=await readFile(`public/${path}`);
  assert.ok(output.length>1024);
  report.assets=report.assets.filter(a=>a.route!==route);
  report.assets.push({path,route,bytes:output.length,sha256:createHash('sha256').update(output).digest('hex'),sourceSha256:source.sha256,sourceBytes:source.bytes,method:'Spark v2.1.0 build-lod --quality --rad; paged hierarchy, no crop; colliders unchanged'});
  console.log(path,output.length);
}
await writeFile('docs/mobile-assets.json',JSON.stringify(report,null,2)+'\n');

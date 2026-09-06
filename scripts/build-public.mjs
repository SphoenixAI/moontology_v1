import { build } from 'vite';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';
import { URL } from 'node:url';

const uploads = JSON.parse(await readFile('docs/public-assets.json', 'utf8'));
const optimizedUploads = JSON.parse(await readFile('docs/optimized-public-assets.json', 'utf8'));
const optimizedBuild = JSON.parse(await readFile('docs/optimized-assets.json', 'utf8'));
const publicAssetUrls = Object.fromEntries(uploads.assets.map(asset => [`/${asset.path}`, asset.url]));
for (const asset of optimizedBuild.assets) {
  const uploaded = optimizedUploads.assets.find(entry => entry.path === asset.path && entry.sha256 === asset.sha256);
  if (!uploaded) throw new Error(`Missing optimized upload: ${asset.path}`);
  publicAssetUrls[`/${asset.route}`] = uploaded.url;
}
const mobileBuild = JSON.parse(await readFile('docs/mobile-assets.json', 'utf8'));
const mobileUploads = JSON.parse(await readFile('docs/mobile-public-assets.json', 'utf8'));
const mobileAssetUrls = {};
for (const asset of mobileBuild.assets) {
  const uploaded = mobileUploads.assets.find(entry => entry.path === asset.path && entry.sha256 === asset.sha256 && entry.bytes === asset.bytes);
  if (!uploaded) throw new Error(`Missing mobile upload: ${asset.path}`);
  mobileAssetUrls[`/${asset.route}`] = uploaded.url;
}
const blobOrigin = new URL(uploads.assets[0].url).origin;

// Separate output: the local presentation and its full source assets stay intact.
await build({ mode: 'public', define: { __MOONTOLOGY_PUBLIC_ASSET_URLS__: JSON.stringify(publicAssetUrls), __MOONTOLOGY_MOBILE_ASSET_URLS__: JSON.stringify(mobileAssetUrls) },
  build: { outDir: 'dist-public', copyPublicDir: false } });
const html = await readFile('dist-public/index.html', 'utf8');
await writeFile('dist-public/index.html', html.replace('</head>',
  `<link rel="preconnect" href="${blobOrigin}" crossorigin>\n</head>`));
await mkdir('dist-public/docs', { recursive: true });
await cp('public/docs/moontology-design-provenance.pdf', 'dist-public/docs/moontology-design-provenance.pdf');
await mkdir('dist-public/models', { recursive: true });
// The URDF references /dae only. /meshes is an identical, unused second copy.
for (const path of ['OFFICIAL_SOURCE.md', 'go2_description/urdf/go2_description.urdf', 'go2_description/dae']) {
  const target = `dist-public/models/go2/${path}`;
  await mkdir(target.substring(0, target.lastIndexOf('/')), { recursive: true });
  await cp(`public/models/go2/${path}`, target, { recursive: true });
}

// These exact, unmodified large files must be hosted before publishing the site.
const files = [
  'models/humanoids/full-detail-glb/Dig And Plant Seeds.glb',
  'models/humanoids/full-detail-glb/Shared Worker Actions.glb',
  'models/animated/rover-driving.glb',
  'models/animated/logistics-rover.glb',
  'models/rovers/lunar excavator.glb',
  'models/static/excavator traditional.glb',
  'models/static/cable.glb',
  'worldlabs/lunar-base/Moon Base with Habitats.spz',
  'worldlabs/lunar-base/Moon Base with Habitats_collider.glb',
  'worldlabs/scene-2/Futuristic Museum Interiors.spz',
  'worldlabs/scene-2/Futuristic Museum Interiors_collider.glb',
];
const assets = [];
for (const path of files) {
  const source = `public/${path}`;
  assets.push({ path, bytes: (await stat(source)).size,
    sha256: createHash('sha256').update(await readFile(source)).digest('hex') });
}
await writeFile('dist-public/map-assets-manifest.json', JSON.stringify({
  note: 'Original full-detail assets. Deployment requires matching verified public upload receipts.', assets,
}, null, 2) + '\n');
console.log(`Public site built. ${assets.length} unchanged map assets require hosting (${Math.round(assets.reduce((sum, a) => sum + a.bytes, 0) / 1024 / 1024)} MiB).`);

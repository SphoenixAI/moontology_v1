import { build } from 'vite';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import console from 'node:console';

// Separate output: the local presentation and its full source assets stay intact.
await build({ mode: 'public', build: { outDir: 'dist-public', copyPublicDir: false } });
await mkdir('dist-public/docs', { recursive: true });
await cp('public/docs/moontology-design-provenance.pdf', 'dist-public/docs/moontology-design-provenance.pdf');
await mkdir('dist-public/models', { recursive: true });
await cp('public/models/go2', 'dist-public/models/go2', { recursive: true });

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

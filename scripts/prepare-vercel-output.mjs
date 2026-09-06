import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import console from 'node:console';
import { URL } from 'node:url';

const { assets } = JSON.parse(await readFile('dist-public/map-assets-manifest.json', 'utf8'));
const { assets: receipts } = JSON.parse(await readFile('docs/public-assets.json', 'utf8'));
const { assets: optimized } = JSON.parse(await readFile('docs/optimized-public-assets.json', 'utf8'));
const { assets: optimizedBuild } = JSON.parse(await readFile('docs/optimized-assets.json', 'utf8'));
const routes = [];
for (const asset of assets) {
  const original = receipts.find((entry) => entry.path === asset.path);
  if (!original || original.sha256 !== asset.sha256 || original.bytes !== asset.bytes) {
    throw new Error(`Missing matching upload receipt: ${asset.path}`);
  }
  const candidate = optimized.find(entry => entry.route === asset.path);
  const build = optimizedBuild.find(entry => entry.route === asset.path);
  if (build && (!candidate || candidate.sha256 !== build.sha256 || candidate.bytes !== build.bytes || candidate.sourceSha256 !== asset.sha256)) {
    throw new Error(`Missing verified optimized upload: ${asset.path}`);
  }
  const receipt = candidate ?? original;
  const url = new URL(receipt.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com')) {
    throw new Error(`Invalid public asset URL: ${asset.path}`);
  }
  const escapedPath = asset.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '(?: |%20)');
  routes.push({ src: `^/${escapedPath}$`, status: 307,
    headers: { Location: url.href, 'Cache-Control': 'public, max-age=3600' } });
}
routes.push({ src: '/docs/moontology-design-provenance.pdf', headers: {
  'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Moontology-Design-Provenance.pdf"',
}, continue: true });
routes.push({ src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true });
routes.push({ handle: 'filesystem' });
await rm('.vercel/output', { recursive: true, force: true });
await mkdir('.vercel/output', { recursive: true });
await cp('dist-public', '.vercel/output/static', { recursive: true });
await writeFile('.vercel/output/config.json', JSON.stringify({ version: 3, routes }, null, 2) + '\n');
console.log(`Prepared Vercel static output with ${assets.length} original-asset redirects.`);

import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import process from 'node:process';
import console from 'node:console';
import { head, put, BlobNotFoundError } from '@vercel/blob';

// Run only after authorizing publication. Credentials never enter the repository.
const envFile = process.argv[2];
if (!envFile) throw new Error('Supply a private production environment file path.');
const { BLOB_READ_WRITE_TOKEN: token } = parseEnv(await readFile(envFile, 'utf8'));
if (!token) throw new Error('Production BLOB_READ_WRITE_TOKEN is missing.');
const { assets } = JSON.parse(await readFile('dist-public/map-assets-manifest.json', 'utf8'));
const receiptPath = 'docs/public-assets.json';
const receipts = { store: 'moontology-assets', storeId: 'store_w1Q22HcAFGF7ppYH', assets: [] };
try { Object.assign(receipts, JSON.parse(await readFile(receiptPath, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

for (const asset of assets) {
  const source = `public/${asset.path}`;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  if (hash.digest('hex') !== asset.sha256) throw new Error(`Source changed: ${asset.path}`);
  const pathname = `v1/${asset.sha256.slice(0, 16)}/${asset.path}`;
  let uploaded;
  try { uploaded = await head(pathname, { token }); }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  if (!uploaded) {
    console.log(`Uploading ${asset.path} (${Math.round(asset.bytes / 1048576)} MiB)`);
    uploaded = await put(pathname, createReadStream(source), {
      token, access: 'public', multipart: true, addRandomSuffix: false,
      contentType: asset.path.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream',
      cacheControlMaxAge: 31536000,
    });
  }
  const metadata = await head(uploaded.url, { token });
  if (metadata.size !== asset.bytes) throw new Error(`Upload size mismatch: ${asset.path}`);
  const publicResponse = await globalThis.fetch(uploaded.url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  if (!publicResponse.ok || Number(publicResponse.headers.get('content-length')) !== asset.bytes) {
    throw new Error(`Public verification failed: ${asset.path}`);
  }
  receipts.assets = receipts.assets.filter((entry) => entry.path !== asset.path);
  receipts.assets.push({ ...asset, url: uploaded.url, pathname, verifiedAt: new Date().toISOString() });
  await writeFile(`${receiptPath}.tmp`, JSON.stringify(receipts, null, 2) + '\n');
  await rename(`${receiptPath}.tmp`, receiptPath);
  console.log(`Verified ${receipts.assets.length}/${assets.length}: ${uploaded.url}`);
}

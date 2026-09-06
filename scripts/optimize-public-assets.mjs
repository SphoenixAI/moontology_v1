import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + jsonLength)), bin: bytes.subarray(28 + jsonLength) };
};
const pack = (json, bin) => {
  const raw = Buffer.from(JSON.stringify(json));
  const text = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(text);
  const binary = Buffer.alloc(Math.ceil(bin.length / 4) * 4); bin.copy(binary);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + text.length + binary.length, 8);
  header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, text, binHeader, binary]);
};
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const original = JSON.parse(await readFile('docs/public-assets.json', 'utf8'));
const report = { method: 'Lossless meshopt; no quantization, filtering, decimation, resampling, or texture changes', assets: [] };
for (const source of original.assets.filter(asset => asset.path.endsWith('.glb'))) {
  const input = await readFile(`public/${source.path}`);
  assert.equal(sha(input), source.sha256, `Original changed: ${source.path}`);
  const { json, bin } = parse(input);
  assert.equal(json.buffers.length, 1, 'Expected a self-contained source GLB');
  const inputJson = globalThis.structuredClone(json);
  const imageViews = new Set((json.images ?? []).map(image => image.bufferView));
  const indexViews = new Set((json.meshes ?? []).flatMap(mesh => mesh.primitives)
    .filter(primitive => primitive.indices !== undefined).map(primitive => json.accessors[primitive.indices].bufferView));
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const parts = [], viewChecks = [];
  let offset = 0, compressedViews = 0;
  const append = data => {
    const start = offset;
    parts.push(Buffer.from(data)); offset += data.length;
    const padding = (4 - offset % 4) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); offset += padding; }
    return start;
  };
  for (const [index, view] of json.bufferViews.entries()) {
    const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const accessor = (json.accessors ?? []).find(a => a.bufferView === index);
    let stride = view.byteStride ?? (accessor ? sizes[accessor.type] * componentBytes[accessor.componentType] : 4);
    const mode = indexViews.has(index) ? 'INDICES' : 'ATTRIBUTES';
    if (mode === 'ATTRIBUTES' && !view.byteStride && (stride % 4 || stride > 256)) stride = 4;
    const eligible = !imageViews.has(index) && data.length % stride === 0 &&
      (mode === 'INDICES' ? stride === 2 || stride === 4 : stride % 4 === 0 && stride <= 256);
    let encoded = null;
    if (eligible) {
      encoded = mode === 'ATTRIBUTES'
        ? MeshoptEncoder.encodeVertexBufferLevel(data, data.length / stride, stride, 3, 0)
        : MeshoptEncoder.encodeGltfBuffer(data, data.length / stride, stride, mode, 0);
      const decoded = Buffer.alloc(data.length);
      MeshoptDecoder.decodeGltfBuffer(decoded, data.length / stride, stride, encoded, mode, 'NONE');
      assert.ok(decoded.equals(data), `Lossless round-trip failed: ${source.path} view ${index}`);
    }
    if (encoded && encoded.length < data.length) {
      view.buffer = 1;
      view.extensions = { ...view.extensions, EXT_meshopt_compression: {
        buffer: 0, byteOffset: append(encoded), byteLength: encoded.length,
        byteStride: stride, count: data.length / stride, mode, filter: 'NONE',
      } };
      compressedViews++;
    } else {
      view.buffer = 0; view.byteOffset = append(data);
    }
    viewChecks.push({ index, sha256: sha(data), bytes: data.length, texture: imageViews.has(index) });
  }
  json.buffers = [{ byteLength: offset }, { byteLength: bin.length, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
  const output = pack(json, Buffer.concat(parts));
  const path = `optimized/${source.path}`;
  await mkdir(dirname(`public/${path}`), { recursive: true });
  await writeFile(`public/${path}`, output);
  // Verify the written artifact, including every image, keyframe, skin and vertex buffer.
  const checked = parse(await readFile(`public/${path}`));
  for (const { index, sha256, bytes } of viewChecks) {
    const view = checked.json.bufferViews[index], ext = view.extensions?.EXT_meshopt_compression;
    let decoded;
    if (ext) {
      decoded = Buffer.alloc(bytes);
      MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride,
        checked.bin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
    } else decoded = checked.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    assert.equal(sha(decoded), sha256, `Written buffer mismatch: ${index}`);
  }
  for (const key of ['accessors', 'meshes', 'animations', 'skins', 'nodes', 'materials', 'textures', 'images', 'scenes']) {
    assert.deepEqual(checked.json[key], inputJson[key], `Scene metadata changed: ${key}`);
  }
  report.assets.push({ path, route: source.path, bytes: output.length, sha256: sha(output),
    sourceSha256: source.sha256, sourceBytes: input.length, compressedViews,
    animationClips: (json.animations ?? []).map(clip => clip.name),
    verifiedBuffers: viewChecks.length, textureBytesUnchanged: true });
  console.log(`${source.path}: ${(input.length / 1048576).toFixed(1)} → ${(output.length / 1048576).toFixed(1)} MiB; verified exact buffers + metadata`);
  await writeFile('docs/optimized-assets.json', JSON.stringify(report, null, 2) + '\n');
}

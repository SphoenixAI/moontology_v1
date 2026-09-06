# Public mobile map and desktop loading

The public build chooses mobile assets before downloading the scene for iPhone,
Android and iPad (including iPad's desktop-style user agent). `?quality=mobile`
forces this path for QA. A narrow desktop window alone does not reduce quality.
Local presentation asset URLs remain unchanged.

## Mobile budget

- 30 FPS, 1x device pixel ratio, no multisample antialiasing.
- Spark v2.1.0 paged RAD worlds: 250,000 rendered splats and at most 1,048,576
  resident splats per world, one page fetcher. Detail is fetched by HTTP Range;
  no full SPZ download or runtime construction of the entire LoD tree.
- Seven mobile model sources total 47,448,088 bytes versus 452,035,928 original
  bytes (89.5% smaller). Their combined source mesh triangle count falls from
  11,383,113 to 523,087 (95.4% fewer). Instanced actors share source geometry.
- Mobile-only textures are capped at 1024 pixels. These are reduced-detail copies,
  not lossless substitutes. Material maps, rig joints, action names, animation
  keyframe inputs/outputs and interpolation are retained and checked after export.
- Model decoding is sequential on mobile; desktop can preload two sources while
  the world loads. Background tab rendering is paused.
- Opening the design book suspends mobile 3D rendering. Its canvas is capped at
  two million pixels and PDF/canvas resources are released when the reader closes.
- GPU context loss pauses rendering and offers an explicit reload. It does not
  trigger an automatic reload loop. An operating-system tab kill cannot be caught
  by JavaScript; a physical phone test is still necessary.

Both map collider meshes and world transforms are unchanged. Mobile models retain
all scene placements/actions and the same grounding, airlock and animation logic.
No physical robot controller, calibration, STOP or LAN access setting changes.

## Desktop fidelity

Nine losslessly compressed GLB copies total 200,299,972 bytes instead of
455,700,444 bytes (56.0% smaller files). Every decoded buffer, embedded texture
byte and scene/animation metadata record is verified against the original.
There is no geometry quantization, decimation, texture resizing or keyframe
resampling on desktop. Original FBX, GLB and SPZ sources remain untouched.

Direct immutable Blob URLs remove the per-asset application redirect from the
normal loader path. Compatibility redirects remain. The public static package
omits the unused duplicate Go2 meshes directory; the official URDF still uses
its original DAE files.

## Rebuild and publish

`node scripts/optimize-public-assets.mjs` builds and verifies desktop duplicates.
`node scripts/build-mobile-assets.mjs` builds and verifies mobile mesh copies.
Manifests record paths, source/output SHA-256 hashes and quality checks.

Streaming worlds were generated with official `sparkjsdev/spark` tag v2.1.0,
commit f22236f95fdd8078f0c12e3aab479523d401daf6, using its native build-lod tool:

```sh
build-lod --quality --rad /tmp/Moontology-mobile-base.spz /tmp/Moontology-mobile-interior.spz
node scripts/register-mobile-worlds.mjs
```

The temporary input files are exact copies of the original lunar and interior
SPZ files. The registration script copies the converter outputs into
`public/mobile/worldlabs` and records them in the mobile manifest. No cropping
or spherical-harmonic reduction is applied. Keep `.rad` assets in Git LFS.

Upload with `scripts/upload-public-assets.mjs` and a private environment file;
use `--optimized` for desktop or `--mobile` for mobile. Existing immutable original
uploads remain available. Never commit the credential file. Public builds refuse
missing or mismatched optimized/mobile receipts. Then use the public build and
prebuilt Vercel deployment instructions in `public-site.md`.

## Validation

All mobile rigs/keyframe buffers and texture dimensions passed export checks.
Desktop decoded buffers and image bytes passed exact round-trip checks.
Mobile device/iPad detection, local asset routing, keyboard safety and download
inactivity tests passed. Both hosted RAD worlds returned HTTP 206 for a 512-byte
request with the expected Content-Range and cross-origin headers.

The build was made from HEAD plus only the staged optimization patch in an
isolated temporary directory, excluding another agent's unfinished robot and
ontology edits. Final production deployment dpl_3dFMnNkqWRvxrv1WRWyNXFqptmQf reached READY,
with https://moontology.vercel.app aliased to
https://moontology-71pwa1soz-sphoenixs-projects.vercel.app.

At 390 x 844, the mobile profile loaded Scene 1's world in 1.182 seconds and all
13 assets in 4.004 seconds on the test connection. A repeat load was 0.629 seconds
for the world and 3.769 seconds for the full scene. Scene 2's direct start reached
world readiness in 0.313 seconds and scene readiness in 3.285 seconds. These are
browser test measurements on this Mac, not promised timings on mobile hardware.
Both scenes continued rendering for minutes. All five humanoid clips and the
rover Drive_InPlace clip reported playing, and textured models were visible.

The mobile reader rendered page 1 of 5. Its render counter held at 840 while open,
then advanced after closing; its canvas count returned to zero. Touch buttons and
compact panels were verified in the phone-sized layout. Regression tests cover
touch release, blur, disabled camera mode and ownership handoff without auto-resume.

Desktop Chrome visibly loaded the full scene with textured humanoids, vehicles,
Go2 and the original desktop controls. Chrome reported about 1.0 GB tab memory
for the full-detail scene, reinforcing the need for a separate mobile budget.
The prior mobile airlock transition reached World 2; disposing Spark workers
emitted two Worker terminate rejections during that earlier transition. No
current-world render failure was observed. Actual iPhone/Android hardware has
not been connected to this test session, so phone-specific crash freedom is not
claimed.

A fresh Chrome tab using the mobile profile reported 575 MB tab memory after
loading. A prior same-tab desktop-to-mobile navigation reported 3.0 GB and is
not treated as a clean mobile baseline. These are desktop Chrome process-memory
observations, not measurements of iOS/Android memory limits.

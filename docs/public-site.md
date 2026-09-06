# Moontology public site

The existing map includes a glass project toolbar with the GitHub mark, a link to
`https://github.com/SphoenixAI/moontology_v1`, and **View design book**. The reader
renders the supplied five-page PDF with page navigation, zoom, fit-width, close,
and an unchanged PDF download. Opening the reader suspends virtual keyboard input.

Public site: **https://moontology.vercel.app**

Vercel project: `sphoenixs-projects/moontology`. Production is published using
the Vercel CLI and the Build Output API. The GitHub repository remains private;
Vercel could not attach its Git integration, so automatic deployment from main is
not connected. The GitHub link is usable by viewers who have repository access.

## Mobile and loading optimization

The September 6 release adds automatic mobile assets, streamed worlds and bounded
rendering, plus lossless desktop compression. See [mobile-performance.md](mobile-performance.md)
for budgets, quality differences and verification. Original sources remain intact.

## Public build

Run `npm run build:public`. This writes a separate `dist-public/` directory and
does not modify the local map or original model files. The build ignores local
environment files and does not expose the local robot bridge address or token.
The browser relay is development-only; the hosted version is the virtual demo.

The build includes the site, original PDF, and official Go2 model. Its
`map-assets-manifest.json` records the exact paths, sizes, and SHA-256 hashes of
the eleven large map assets (522 MiB): two full-detail humanoid GLBs containing
all five action clips, two animated/background vehicles, three equipment GLBs,
and the two World Labs splat/collider pairs.

## Asset storage and repeat deployment

The user explicitly approved public asset upload on September 5, 2026.
`moontology-assets` is a public Vercel Blob store in `sfo1`, ID
`store_w1Q22HcAFGF7ppYH`, linked to this project's production environment.
`docs/public-assets.json` records all eleven public URLs, byte lengths, and source
SHA-256 hashes. The original files total 547,775,841 bytes. Their URLs include
source hash prefixes, so updates cannot overwrite an earlier source version.

The public loader uses direct verified Blob URLs, with redirects retained for existing model/world paths.
The official Go2 files and PDF remain in the static deployment. This keeps the
static package within the current Hobby deployment limit without reducing mesh
detail, embedded texture resolution, or animation clips.

To publish code changes with the same assets:

```sh
npm run build:public
node scripts/prepare-vercel-output.mjs
vercel deploy --prebuilt --prod --yes --scope sphoenixs-projects
```

If a source asset changes, first pull the production environment to a private
temporary file using the authenticated Vercel CLI, then run
`node scripts/upload-public-assets.mjs /path/to/private-production.env`.
The script checks local hashes, resumes existing uploads, and verifies both Blob
metadata and unauthenticated public response sizes. Remove the temporary
credential file when finished. Never commit credentials or supply them in argv.

The output preparation step refuses missing or mismatched asset receipts. Use
the prebuilt deployment command above; a plain source deployment does not include
these asset redirects. Keep the generated output and original source asset tree
available on the deployment laptop. New public visitors receive loading progress
while the full-detail map downloads, and model downloads have a longer production
inactivity timeout than the local presentation. A GLB download that is still
receiving data is allowed to finish; the timeout applies to a stalled transfer.

Original FBX/GLB sources and all embedded texture pixels stay unchanged. No
physical controller, calibration, STOP behavior, or physical motion is changed
by publication.

## Previous full-detail production baseline

Deployment `dpl_Cp5wtJrg5iFFNT7zpUL9kaEzsJxk` reached `READY`, with the canonical
domain assigned to `https://moontology.vercel.app`. Its immutable deployment URL
is `https://moontology-71plfsrgg-sphoenixs-projects.vercel.app`.

Verified unauthenticated access to all eleven asset redirects and their original
byte lengths. A full public lunar SPZ download and the PDF also matched their
source SHA-256 hashes. The initial SPZ download took about 154 seconds on the
test connection; full-detail first loads can take several minutes and subsequent
visits benefit from the immutable asset cache.

Browser verification confirmed the lunar scene, five playing humanoid clips
(H01/H04/H02/H03/H06), running background traffic, Follow Go2 keyboard movement,
the GitHub link, and reader pages 1 through 5 with zoom/fit and correct navigation
boundaries. The virtual approach distance changed from 5.2 m to 4.4 m after arrow
key input. No physical controller was contacted. Build, focused lint, keyboard
safety tests, and download inactivity/error tests passed.

# Moontology public site

The existing map includes a glass project toolbar with the GitHub mark, a link to
`https://github.com/SphoenixAI/moontology_v1`, and **View design book**. The reader
renders the supplied five-page PDF with page navigation, zoom, fit-width, close,
and an unchanged PDF download. Opening the reader suspends virtual keyboard input.

Vercel project: `sphoenixs-projects/moontology`. The project has been created, but
**no public deployment has been published**. The GitHub repository remains private;
Vercel could not attach its Git integration, so automatic deployment from main is
not connected. The GitHub link is usable by viewers who have repository access.

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

## Remaining publication step

Automatic approval review rejected creation of a public `moontology-assets`
Vercel Blob store because publishing original meshes/textures from the private
repository requires explicit approval. No store or asset upload was performed.

After approval, publish the manifest's eleven unchanged files to the named public
store, verify their URLs and byte lengths, and configure production redirects for
their existing `/models/…` and `/worldlabs/…` paths. Keep `/models/go2/…` local to
the static deployment. Package `dist-public/` with those routes using Vercel's
Build Output API, then deploy the prebuilt output and verify the actual public
map, keyboard movement, all assets, and reader. Do not deploy this intermediate
build before its large-asset routes are configured.

Original FBX/GLB sources and all embedded texture pixels stay unchanged. No
physical controller, calibration, STOP behavior, or physical motion is changed
by publication.

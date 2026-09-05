# Static lunar asset provenance

Development source (not used by browser runtime):

`/Users/sphoenix/Documents/hackathon assets/static/`

Staged without renaming:

- `cable.glb` — SHA-256 `6b956175be0d910a4c8192c2e6b6e4c4c26ef28eac9a39a96f08c785ae30d0d4`
- `cyber-rover.glb` — SHA-256 `7344aff678659156a1ccd458ce9959ddeb18027619355b0919e6dbaadc3d2d79`
- `door.png` — SHA-256 `dd7b785ced1fadde7f0b5cb4a26b4351917385112054eac2972ca19c09d5fa8f`
- `excavator traditional.glb` — SHA-256 `0dadb6f36264d1189946a0301ecf659f67cd643d25efb46704f78a847cec6535`
- `rover.glb` — SHA-256 `3249e29dce0952f1a65a4c8cf8a4bc3c7eedea273ebece7f51e16c4b7d6dc507`

`lunar excavator.glb` was not copied here because the existing
`public/models/rovers/lunar excavator.glb` is byte-identical to the source
(SHA-256 `135a7de70adc41210bd2bdc97b273a348d8810abbc6d8ff8057b8f21e3ae7579`).

All five source GLBs are valid, self-contained glTF 2.0 binaries. The source
folder provides no 3D airlock model; `door.png` is the only door asset and is
mounted on a shallow Three.js panel at runtime.

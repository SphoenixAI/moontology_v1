"""Create verified, byte-identical FBX runtime copies; never overwrite a model."""
import hashlib
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
models = root / 'public/models/humanoids'
destination = models / 'full-fidelity'
sources = ['scene1/Dig And Plant Seeds.fbx', 'Writing.fbx',
           'Kneeling Inspecting.fbx', 'h01-kicking.fbx', 'h01-sweat.fbx', 'Defeat.fbx']

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

originals = {str(path.relative_to(models)): digest(path)
             for path in models.rglob('*.fbx') if destination not in path.parents}
destination.mkdir(parents=True, exist_ok=True)
records = []
for name in sources:
    source = models / name
    target = destination / source.name
    source_hash = digest(source)
    if target.exists():
        if digest(target) != source_hash:
            raise RuntimeError(f'Refusing to overwrite different existing copy: {target}')
    else:
        # Exclusive creation prevents accidental replacement of an existing file.
        with source.open('rb') as incoming, target.open('xb') as outgoing:
            shutil.copyfileobj(incoming, outgoing)
    assert digest(source) == source_hash == digest(target)
    records.append({'source': name, 'copy': str(target.relative_to(models)),
                    'bytes': target.stat().st_size, 'sha256': source_hash})
for name, expected in originals.items():
    assert digest(models / name) == expected, f'Original changed: {name}'
manifest = {'method': 'Byte-for-byte copy; no conversion, simplification or texture processing',
            'originals_sha256': originals, 'copies': records}
manifest_path = destination / 'manifest.json'
serialized = json.dumps(manifest, indent=2) + '\n'
if manifest_path.exists():
    assert manifest_path.read_text() == serialized, 'Existing manifest differs; inspect manually'
else:
    with manifest_path.open('x') as output:
        output.write(serialized)
print(f'Verified {len(records)} exact copies and {len(originals)} unchanged originals.')

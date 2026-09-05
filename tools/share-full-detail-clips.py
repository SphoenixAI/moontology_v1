"""Share byte-identical mesh/skin/images across four full-detail action clips."""
from pathlib import Path
import json, struct, copy, hashlib
root = Path(__file__).resolve().parents[1] / 'public/models/humanoids/full-detail-glb'
def read(path):
    raw = path.read_bytes(); length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+length]); return doc, raw[28+length:28+length+doc['buffers'][0]['byteLength']]
def view(doc, binary, index):
    v = doc['bufferViews'][index]; start = v.get('byteOffset', 0); return binary[start:start+v['byteLength']]
def signature(doc, binary):
    primitive = doc['meshes'][0]['primitives'][0]
    refs = list(primitive['attributes'].values()) + [primitive['indices']] + [s['inverseBindMatrices'] for s in doc['skins']]
    return [hashlib.sha256(view(doc, binary, doc['accessors'][i]['bufferView'])).hexdigest() for i in refs] + [hashlib.sha256(view(doc, binary, i['bufferView'])).hexdigest() for i in doc['images']]
base, binary = read(root / 'Writing.glb'); data = bytearray(binary)
expected = signature(base, binary)
base['animations'][0]['name'] = 'Writing'
for name in ['Kneeling Inspecting', 'h01-sweat', 'Defeat']:
    doc, source = read(root / (name + '.glb'))
    assert signature(doc, source) == expected, 'Cannot share unequal geometry or skin data'
    assert doc['materials'] == base['materials'] and doc['skins'] == base['skins']
    # Same hierarchy and base transforms: only action samples differ.
    assert doc['nodes'] == base['nodes'], 'Rig node transforms differ'
    views, accessors = {}, {}
    def accessor(index):
        if index in accessors: return accessors[index]
        value = copy.deepcopy(doc['accessors'][index]); old_view = value['bufferView']
        if old_view not in views:
            while len(data) % 4: data.append(0)
            v = copy.deepcopy(doc['bufferViews'][old_view]); v['byteOffset'] = len(data); v['buffer'] = 0
            data.extend(view(doc, source, old_view)); views[old_view] = len(base['bufferViews']); base['bufferViews'].append(v)
        value['bufferView'] = views[old_view]; accessors[index] = len(base['accessors']); base['accessors'].append(value)
        return accessors[index]
    animation = copy.deepcopy(doc['animations'][0]); animation['name'] = name
    for sampler in animation['samplers']:
        sampler['input'] = accessor(sampler['input']); sampler['output'] = accessor(sampler['output'])
    base['animations'].append(animation)
base['buffers'][0]['byteLength'] = len(data)
encoded = json.dumps(base, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4); data.extend(b'\0' * (-len(data) % 4))
result = struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(data)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(data), 0x004e4942) + data
path = root / 'Shared Worker Actions.glb'
with path.open('xb') as output: output.write(result)
print('Verified identical geometry, skin, hierarchy and image bytes; shared GLB:', len(result), 'bytes')

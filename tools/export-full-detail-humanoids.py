"""Non-decimating GLB derivatives. Original FBXs are read-only inputs."""
import bpy
import json
import hashlib
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'public/models/humanoids'
output = root / 'full-detail-glb'
output.mkdir(exist_ok=True)
report = []
for name in ['Dig And Plant Seeds', 'Writing', 'Kneeling Inspecting', 'h01-sweat', 'Defeat']:
    source = root / 'full-fidelity' / (name + '.fbx')
    target = output / (name + '.glb')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if target.exists():
        raise RuntimeError('Refusing to overwrite: ' + str(target))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    before = {obj.name: {'vertices': len(obj.data.vertices), 'polygons': len(obj.data.polygons)} for obj in meshes}
    images = [{'name': image.name, 'size': list(image.size)} for image in bpy.data.images if image.size[0]]
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_animations=True,
        export_all_influences=True, export_image_format='AUTO', export_draco_mesh_compression_enable=False)
    after = {obj.name: {'vertices': len(obj.data.vertices), 'polygons': len(obj.data.polygons)} for obj in meshes}
    assert before == after
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    report.append({'source': str(source), 'source_sha256': digest, 'output': str(target), 'mesh_counts': before,
        'images': images, 'bytes': target.stat().st_size, 'decimation': False, 'all_skin_influences_exported': True})
    print('FULL DETAIL', name, target.stat().st_size, before, images, flush=True)
(output / 'export-report.json').write_text(json.dumps(report, indent=2) + '\n')

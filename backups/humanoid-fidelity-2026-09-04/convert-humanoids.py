"""Bake existing FBX character actions into browser-ready GLBs using Blender."""
import bpy
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'public/models/humanoids'
for name in ['scene1/Dig And Plant Seeds', 'Writing', 'Kneeling Inspecting', 'h01-kicking', 'h01-sweat', 'Defeat']:
    output = root / 'optimized' / (Path(name).name + '.glb')
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(root / (name + '.fbx')))
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and len(obj.data.polygons) > 60000:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new('Browser preview budget', 'DECIMATE')
            modifier.ratio = 60000 / len(obj.data.polygons)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_animations=True)
    print('EXPORTED', output, output.stat().st_size, flush=True)

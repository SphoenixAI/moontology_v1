import { Box3, Vector3, type Object3D } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { LoadedAsset } from '../assets/AssetRegistry';
import type { WorldLayout, LayoutObstacle } from './WorldLayout';

interface Contact {
  asset: LoadedAsset;
  feet: Object3D[];
  footOffset: number;
  normalizationY: number;
  bottomOffset: number;
  halfX: number;
  halfZ: number;
  centerX: number;
  centerZ: number;
  key: string;
  accepted: Vector3 | null;
  acceptedRotation: number[];
  acceptedScale: number[];
  obstacle: LayoutObstacle | null;
}
/** Scene-side contact correction; never changes source meshes, textures or scale. */
export class SceneGrounding {
  private readonly contacts = new Map<string, Contact>();
  private readonly registry: AssetRegistry;
  private readonly layout: WorldLayout;
  readonly issues = new Map<string, string>();
  constructor(registry: AssetRegistry, layout: WorldLayout) { this.registry = registry; this.layout = layout; }
  update(): void {
    const live = new Set<string>();
    const obstacles: LayoutObstacle[] = [];
    for (const asset of this.registry.values()) {
      if (!asset.root.visible || !asset.root.parent?.visible || (!asset.config.src && asset.config.id !== 'PowerNode-B')) continue;
      const id = asset.config.id; live.add(id);
      let contact = this.contacts.get(id);
      if (!contact || contact.asset !== asset) {
        asset.root.updateMatrixWorld(true);
        const feet: Object3D[] = [];
        if (asset.config.type === 'humanoid') asset.model.traverse(node => { if (/(Left|Right)(ToeBase|Foot|Toe_End)$/.test(node.name)) feet.push(node); });
        const box = new Box3().setFromObject(asset.model, true);
        if (!Number.isFinite(box.min.y)) { this.issues.set(id, 'Contact geometry unavailable'); continue; }
        const root = asset.root.getWorldPosition(new Vector3());
        const feetY = feet.length ? Math.min(...feet.map(foot => foot.getWorldPosition(new Vector3()).y)) : 0;
        contact = { asset, feet, footOffset: feetY - box.min.y, normalizationY: asset.model.parent!.position.y, bottomOffset: root.y - box.min.y,
          halfX: Math.max(.15, (box.max.x - box.min.x) / 2), halfZ: Math.max(.15, (box.max.z - box.min.z) / 2),
          centerX: (box.max.x + box.min.x) / 2 - root.x, centerZ: (box.max.z + box.min.z) / 2 - root.z,
          key: '', accepted: null, acceptedRotation: [], acceptedScale: [], obstacle: null };
        this.contacts.set(id, contact);
      }
      const root = asset.root.getWorldPosition(new Vector3());
      const key = [root.x, root.z, ...asset.root.rotation.toArray(), ...asset.root.scale.toArray()].join(',');
      const humanoid = asset.config.type === 'humanoid';
      if (key !== contact.key) {
        // Recompute footprint after placement/rotation/scale edits, not every frame.
        if (!humanoid) {
          const box = new Box3().setFromObject(asset.model);
          contact.halfX = (box.max.x - box.min.x) / 2; contact.halfZ = (box.max.z - box.min.z) / 2;
          contact.centerX = (box.max.x + box.min.x) / 2 - root.x; contact.centerZ = (box.max.z + box.min.z) / 2 - root.z;
          contact.bottomOffset = root.y - box.min.y;
        }
        contact.key = key;
      }
      const offsets = humanoid ? [[0,0]] : [[0,0],[-contact.halfX,-contact.halfZ],[contact.halfX,-contact.halfZ],[-contact.halfX,contact.halfZ],[contact.halfX,contact.halfZ]];
      const supports = offsets.map(([x,z]) => this.layout.sample(root.x + (humanoid ? 0 : contact.centerX) + x,
        root.z + (humanoid ? 0 : contact.centerZ) + z, false));
      const invalid = supports.find(sample => !sample.traversable);
      if (invalid) {
        this.issues.set(id, invalid.reason ?? 'Invalid placement');
        asset.root.userData.layoutStatus = 'BLOCKED';
        if (contact.accepted) {
          asset.root.position.copy(asset.root.parent!.worldToLocal(contact.accepted.clone()));
          asset.root.rotation.set(contact.acceptedRotation[0], contact.acceptedRotation[1], contact.acceptedRotation[2]);
          asset.root.scale.fromArray(contact.acceptedScale);
          if (contact.obstacle) obstacles.push(contact.obstacle);
        }
        continue;
      }
      this.issues.delete(id);
      const ground = Math.max(...supports.map(sample => sample.height!));
      root.y = ground + (humanoid ? 0 : contact.bottomOffset);
      asset.root.position.copy(asset.root.parent!.worldToLocal(root.clone()));
      asset.root.updateMatrixWorld(true);
      if (contact.feet.length) {
        const normalization = asset.model.parent!;
        // Re-solve from the original wrapper every frame, never integrate an
        // animation correction into the next frame's starting offset.
        normalization.position.y = contact.normalizationY;
        asset.root.updateMatrixWorld(true);
        const sole = Math.min(...contact.feet.map(foot => foot.getWorldPosition(new Vector3()).y)) - contact.footOffset;
        const scaleY = normalization.parent!.getWorldScale(new Vector3()).y;
        if (scaleY > 0) normalization.position.y = contact.normalizationY + (ground - sole) / scaleY;
        asset.root.updateMatrixWorld(true);
      }
      contact.accepted = root.clone();
      contact.acceptedRotation = [asset.root.rotation.x, asset.root.rotation.y, asset.root.rotation.z];
      contact.acceptedScale = asset.root.scale.toArray();
      asset.root.userData.layoutStatus = 'GROUNDED';
      asset.root.userData.surfaceRegion = supports[0].regionId;
      asset.root.userData.surfaceY = ground;
      const hx = humanoid ? .32 : contact.halfX, hz = humanoid ? .32 : contact.halfZ;
      const x = root.x + (humanoid ? 0 : contact.centerX), z = root.z + (humanoid ? 0 : contact.centerZ);
      contact.obstacle = { id, scheduledMotion: asset.root.userData.sceneMotionSource === 'SCHEDULED_BACKGROUND',
        polygon: [[x-hx,z-hz],[x+hx,z-hz],[x+hx,z+hz],[x-hx,z+hz]] };
      obstacles.push(contact.obstacle);
    }
    for (const id of this.contacts.keys()) if (!live.has(id)) { this.contacts.delete(id); this.issues.delete(id); }
    this.layout.setObstacles(obstacles);
  }
}

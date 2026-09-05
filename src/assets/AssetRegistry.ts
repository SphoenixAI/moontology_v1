import type { AnimationClip, Group, Object3D } from 'three';
import type { AnimationBinding } from '../animation/AnimationSystem';
import type { HumanoidNormalization } from '../humanoids/HumanoidFleet';
import type { LevelAssetConfig } from '../levels/types';

export interface LoadedAsset {
  config: LevelAssetConfig;
  root: Group;
  model: Object3D;
  normalization: HumanoidNormalization | null;
  animations: readonly AnimationClip[];
  animation: AnimationBinding | null;
}

export class AssetRegistry {
  private readonly assets = new Map<string, LoadedAsset>();
  private readonly childToRoot = new WeakMap<Object3D, Group>();
  private readonly configuredOrder: readonly string[];

  constructor(configs: readonly LevelAssetConfig[]) {
    this.configuredOrder = configs.map(({ id }) => id);
  }

  register(asset: LoadedAsset): void {
    if (this.assets.has(asset.config.id)) {
      throw new Error(`[assets] Duplicate level asset id: "${asset.config.id}".`);
    }

    this.assets.set(asset.config.id, asset);
    asset.root.traverse((child) => {
      this.childToRoot.set(child, asset.root);
    });
  }

  get(id: string): LoadedAsset | undefined {
    return this.assets.get(id);
  }

  resolveRoot(object: Object3D): Group | null {
    return this.childToRoot.get(object) ?? null;
  }

  getRaycastRoots(): Group[] {
    return this.values()
      .map(({ root }) => root)
      .filter(({ visible }) => visible);
  }

  values(): LoadedAsset[] {
    const ordered = this.configuredOrder
      .map((id) => this.assets.get(id))
      .filter((asset): asset is LoadedAsset => Boolean(asset));

    const configuredIds = new Set(this.configuredOrder);
    for (const asset of this.assets.values()) {
      if (!configuredIds.has(asset.config.id)) {
        ordered.push(asset);
      }
    }

    return ordered;
  }

  get size(): number {
    return this.assets.size;
  }

  clear(): void {
    this.assets.clear();
  }
}

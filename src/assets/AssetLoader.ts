import {
  AnimationClip,
  Group,
  Mesh,
  type Object3D,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AnimationSystem } from '../animation/AnimationSystem';
import type { LevelAssetConfig } from '../levels/types';
import { AssetRegistry, type LoadedAsset } from './AssetRegistry';

interface CachedModel {
  root: Object3D;
  animations: readonly AnimationClip[];
  instanceCount: number;
}

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class AssetLoader {
  private readonly gltfLoader = new GLTFLoader();
  private readonly fbxLoader = new FBXLoader();
  private readonly cache = new Map<string, Promise<CachedModel>>();
  private readonly assetLayer: Group;
  private readonly registry: AssetRegistry;
  private readonly animations: AnimationSystem;

  constructor(
    assetLayer: Group,
    registry: AssetRegistry,
    animations: AnimationSystem,
  ) {
    this.assetLayer = assetLayer;
    this.registry = registry;
    this.animations = animations;
  }

  async loadAll(
    configs: readonly LevelAssetConfig[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<LoadedAsset[]> {
    let completed = 0;
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          return await this.load(config);
        } catch (error) {
          console.warn(
            `[assets] Failed to load "${config.id}" from "${config.src}": ${formatError(error)}`,
          );
          return null;
        } finally {
          completed += 1;
          onProgress?.(completed, configs.length);
        }
      }),
    );

    return results.filter((asset): asset is LoadedAsset => asset !== null);
  }

  async load(config: LevelAssetConfig): Promise<LoadedAsset | null> {
    if (!config.src) {
      console.warn(
        `[assets] Skipping "${config.id}": no model source configured.${config.todo ? ` TODO: ${config.todo}` : ''}`,
      );
      return null;
    }

    const source = await this.getSource(config.src);
    const model =
      source.instanceCount === 0 ? source.root : clone(source.root);
    source.instanceCount += 1;

    const root = new Group();
    root.name = config.id;
    root.userData.levelAssetId = config.id;
    root.userData.levelAssetType = config.type;
    root.position.fromArray(config.position);
    root.rotation.set(...config.rotation);
    root.scale.fromArray(config.scale);
    root.visible = config.visible ?? true;

    model.traverse((child) => {
      child.userData.levelAssetId = config.id;
      if (child instanceof Mesh) {
        child.castShadow = config.castShadow ?? false;
        child.receiveShadow = config.receiveShadow ?? false;
      }
    });

    root.add(model);
    this.assetLayer.add(root);

    const animation = this.animations.createBinding(
      root,
      source.animations,
      config,
    );
    const loadedAsset: LoadedAsset = {
      config,
      root,
      model,
      animations: source.animations,
      animation,
    };

    this.registry.register(loadedAsset);

    if (source.animations.length > 0) {
      console.info(
        `[animations] "${config.id}" is playing embedded clip "${animation?.clip.name}".`,
      );
    }

    return loadedAsset;
  }

  private getSource(src: string): Promise<CachedModel> {
    const cached = this.cache.get(src);
    if (cached) {
      return cached;
    }

    const pending = this.loadSource(src).catch((error) => {
      this.cache.delete(src);
      throw error;
    });
    this.cache.set(src, pending);
    return pending;
  }

  private async loadSource(src: string): Promise<CachedModel> {
    const extension = src.split(/[?#]/, 1)[0].toLowerCase().split('.').pop();

    if (extension === 'glb' || extension === 'gltf') {
      const gltf = await this.gltfLoader.loadAsync(src);
      return {
        root: gltf.scene,
        animations: gltf.animations,
        instanceCount: 0,
      };
    }

    if (extension === 'fbx') {
      const fbx = await this.fbxLoader.loadAsync(src);
      return {
        root: fbx,
        animations: fbx.animations,
        instanceCount: 0,
      };
    }

    throw new Error(
      `Unsupported model format ".${extension ?? ''}". Use .glb, .gltf, or .fbx.`,
    );
  }
}

import {
  AnimationClip,
  BoxGeometry,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AnimationSystem } from '../animation/AnimationSystem';
import type {
  HumanoidFleet,
  HumanoidNormalization,
} from '../humanoids/HumanoidFleet';
import type { LevelAssetConfig } from '../levels/types';
import { MOONTOLOGY_CONFIG } from '../config/moontologyConfig';
import { AssetRegistry, type LoadedAsset } from './AssetRegistry';
import { withDownloadTimeout } from './withDownloadTimeout';
import {
  placeObjectBottomAtY,
  scaleObjectToHeight,
  scaleObjectToLength,
} from './physicalScale';

interface CachedModel {
  root: Object3D;
  animations: readonly AnimationClip[];
  instanceCount: number;
}

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const formatMs = (elapsedMs: number): string =>
  `${Math.round(elapsedMs)}ms`;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${message} after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });

export type AssetLoadPhase =
  | 'loading'
  | 'loaded'
  | 'skipped'
  | 'failed';

export interface AssetLoadEvent {
  id: string;
  src: string | null;
  type: LevelAssetConfig['type'];
  phase: AssetLoadPhase;
  index: number;
  total: number;
  elapsedMs?: number;
  message?: string;
}

export class AssetLoader {
  private readonly manager = new LoadingManager();
  private readonly gltfLoader = new GLTFLoader(this.manager);
  private readonly fbxLoader = new FBXLoader(this.manager);
  private readonly textureLoader = new TextureLoader(this.manager);
  private disposed = false;
  private readonly cache = new Map<string, Promise<CachedModel>>();
  private readonly assetLayer: Group;
  private readonly registry: AssetRegistry;
  private readonly animations: AnimationSystem;
  private readonly humanoidFleet: HumanoidFleet | null;
  private readonly staticAssetRoot: Group | null;

  constructor(
    assetLayer: Group,
    registry: AssetRegistry,
    animations: AnimationSystem,
    humanoidFleet: HumanoidFleet | null = null,
    staticAssetRoot: Group | null = null,
  ) {
    this.assetLayer = assetLayer;
    this.registry = registry;
    this.animations = animations;
    this.humanoidFleet = humanoidFleet;
    this.staticAssetRoot = staticAssetRoot;
  }

  async loadAll(
    configs: readonly LevelAssetConfig[],
    onProgress?: (loaded: number, total: number) => void,
    onEvent?: (event: AssetLoadEvent) => void,
  ): Promise<LoadedAsset[]> {
    let completed = 0;
    const results: (LoadedAsset | null)[] = [];

    for (const [index, config] of configs.entries()) {
      if (this.disposed) break;
      const startedAt = performance.now();
      const eventBase = {
        id: config.id,
        src: config.src,
        type: config.type,
        index: index + 1,
        total: configs.length,
      } satisfies Omit<AssetLoadEvent, 'phase'>;
      onEvent?.({ ...eventBase, phase: 'loading' });
      console.info('[assets] loading', eventBase);
      try {
        const asset = await this.load(config);
        const elapsedMs = performance.now() - startedAt;
        if (asset) {
          console.info('[assets] loaded', {
            ...eventBase,
            elapsed: formatMs(elapsedMs),
          });
          onEvent?.({
            ...eventBase,
            phase: 'loaded',
            elapsedMs,
          });
        } else {
          console.info('[assets] skipped', {
            ...eventBase,
            elapsed: formatMs(elapsedMs),
          });
          onEvent?.({
            ...eventBase,
            phase: 'skipped',
            elapsedMs,
          });
        }
        results.push(asset);
      } catch (error) {
        const elapsedMs = performance.now() - startedAt;
        const message = formatError(error);
        console.warn(
          `[assets] Failed to load "${config.id}" from "${config.src}": ${message}`,
        );
        onEvent?.({
          ...eventBase,
          phase: 'failed',
          elapsedMs,
          message,
        });
        results.push(null);
      } finally {
        completed += 1;
        onProgress?.(completed, configs.length);
      }
    }

    return results.filter((asset): asset is LoadedAsset => asset !== null);
  }

  async load(config: LevelAssetConfig): Promise<LoadedAsset | null> {
    if (!config.src) {
      if (config.procedural) {
        return null;
      }
      console.warn(
        `[assets] Skipping "${config.id}": no model source configured.${config.todo ? ` TODO: ${config.todo}` : ''}`,
      );
      return null;
    }

    const skipReason = this.getEmergencySkipReason(config);
    if (skipReason) {
      console.warn(`[assets] Skipping "${config.id}": ${skipReason}`);
      return null;
    }

    const source = await this.getSource(config.src);
    if (this.disposed) return null;
    // Keep the cached rig detached and pristine: placed skinned meshes update
    // their bind matrices, which must not leak into subsequent instances.
    const model = clone(source.root);
    source.instanceCount += 1;

    const root = new Group();
    root.name = config.id;
    root.userData.levelAssetId = config.id;
    root.userData.levelAssetType = config.type;
    root.userData.role = config.role;
    root.userData.sceneTags = [...(config.sceneTags ?? [])];
    if (config.association) {
      root.userData.entityId = config.association.entityId;
      root.userData.assignedWorker = config.association.assignedWorker;
      root.userData.assignedWorkers = [
        ...(config.association.assignedWorkers ?? []),
      ];
      root.userData.taskId = config.association.taskId;
      root.userData.workGroupIds = [
        ...config.association.workGroupIds,
      ];
      root.userData.relatedEntityIds = [
        ...(config.association.relatedEntityIds ?? []),
      ];
    }
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

    let normalization: HumanoidNormalization | null = null;
    if (config.type === 'humanoid' && this.humanoidFleet) {
      normalization = this.humanoidFleet.add(root, model);
    } else {
      root.add(model);
      (this.staticAssetRoot ?? this.assetLayer).add(root);
      if (config.type === 'humanoid') {
        console.warn(
          `[humanoids] "${config.id}" loaded without HumanoidFleetRoot; normalization was skipped.`,
        );
      }

      if (config.targetHeightMeters !== undefined) {
        scaleObjectToHeight(root, config.targetHeightMeters);
      }
      if (config.targetLengthMeters !== undefined) {
        scaleObjectToLength(root, config.targetLengthMeters);
      }
      if (config.groundY !== undefined) {
        placeObjectBottomAtY(root, config.groundY);
      }
    }

    const animation = this.animations.createBinding(
      root,
      source.animations,
      config,
    );
    const loadedAsset: LoadedAsset = {
      config,
      root,
      model,
      normalization,
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

  dispose(): void {
    this.disposed = true;
    this.manager.abort();
    this.cache.clear();
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
    const timeoutMs = MOONTOLOGY_CONFIG.loading.assetTimeoutMs;
    const startedAt = performance.now();
    console.info('[assets] source loading', {
      src,
      extension,
      timeoutMs,
    });

    if (extension === 'glb' || extension === 'gltf') {
      const message = `Asset source "${src}" timed out`;
      const gltf = await (import.meta.env.PROD
        ? withDownloadTimeout(onProgress => this.gltfLoader.loadAsync(src, onProgress), timeoutMs, message)
        : withTimeout(this.gltfLoader.loadAsync(src), timeoutMs, message));
      console.info('[assets] source loaded', {
        src,
        extension,
        elapsed: formatMs(performance.now() - startedAt),
      });
      return {
        root: gltf.scene,
        animations: gltf.animations,
        instanceCount: 0,
      };
    }

    if (extension === 'fbx') {
      const fbx = await withTimeout(
        this.fbxLoader.loadAsync(src),
        timeoutMs,
        `Asset source "${src}" timed out`,
      );
      console.info('[assets] source loaded', {
        src,
        extension,
        elapsed: formatMs(performance.now() - startedAt),
      });
      return {
        root: fbx,
        animations: fbx.animations,
        instanceCount: 0,
      };
    }

    if (
      extension === 'png' ||
      extension === 'jpg' ||
      extension === 'jpeg' ||
      extension === 'webp'
    ) {
      const texture = await withTimeout(
        this.textureLoader.loadAsync(src),
        timeoutMs,
        `Asset source "${src}" timed out`,
      );
      texture.colorSpace = SRGBColorSpace;
      const image = texture.image as {
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      };
      const width = image.naturalWidth ?? image.width ?? 1;
      const height = image.naturalHeight ?? image.height ?? 1;
      const aspect = height > 0 ? width / height : 1;
      const panelHeight = 3;
      const panel = new Group();
      panel.name = 'image-backed-static-panel';
      const slab = new Mesh(
        new BoxGeometry(aspect * panelHeight, panelHeight, 0.12),
        new MeshStandardMaterial({
          color: 0x26292c,
          metalness: 0.62,
          roughness: 0.42,
        }),
      );
      const face = new Mesh(
        new PlaneGeometry(
          aspect * panelHeight * 0.96,
          panelHeight * 0.96,
        ),
        new MeshStandardMaterial({
          map: texture,
          metalness: 0.12,
          roughness: 0.68,
        }),
      );
      face.position.z = 0.061;
      panel.add(slab, face);
      console.info('[assets] source loaded', {
        src,
        extension,
        elapsed: formatMs(performance.now() - startedAt),
      });
      return {
        root: panel,
        animations: [],
        instanceCount: 0,
      };
    }

    throw new Error(
      `Unsupported asset format ".${extension ?? ''}". Use .glb, .gltf, .fbx, .png, .jpg, or .webp.`,
    );
  }

  private getEmergencySkipReason(config: LevelAssetConfig): string | null {
    if (
      MOONTOLOGY_CONFIG.loading.loadAnimatedHumanoids ||
      new URLSearchParams(window.location.search).has('fullAssets')
    ) {
      return null;
    }

    if (config.type === 'humanoid') {
      return (
        'humanoid loading explicitly disabled; ' +
        'set VITE_LOAD_HEAVY_ANIMATED_FBX=true or add ?fullAssets=1 to opt in'
      );
    }

    return null;
  }
}

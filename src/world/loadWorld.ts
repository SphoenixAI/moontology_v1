import { MOBILE, mobileBudget } from '../runtime/deviceProfile';
import { WorldLayout } from './WorldLayout';
import type {
  SparkRenderer as SparkRendererInstance,
  SplatMesh as SplatMeshInstance,
} from '@sparkjsdev/spark';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  WebGLRenderer,
  type Clock,
  type Timer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { WorldConfig, WorldMode } from '../levels/types';
import { createCriticalGameplayColliders } from './createCriticalGameplayColliders';
import {
  createPlaceholderWorld,
} from './placeholderWorld';
import { MOONTOLOGY_CONFIG } from '../config/moontologyConfig';
import { publicAssetUrl } from '../assets/publicAssetUrl';

export interface WorldHandle {
  layout: WorldLayout | null;
  root: Group;
  visualLayer: Group;
  collisionLayer: Group;
  generatedColliderLayer: Group;
  criticalGameplayColliders: Group;
  requestedMode: WorldMode;
  activeMode: WorldMode;
  colliderAvailable: boolean;
  fallbackReason: string | null;
  setColliderVisible: (visible: boolean) => void;
  dispose: () => void;
}

interface LoadWorldOptions {
  config: WorldConfig;
  renderer: WebGLRenderer;
  scene: Scene;
  timer: Timer;
  onProgress?: (event: ProgressEvent) => void;
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

interface ResourceProbe {
  contentLength: string | null;
  contentType: string;
}

const assertResourceAvailable = async (
  url: string,
): Promise<ResourceProbe> => {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (contentType.includes('text/html')) {
      throw new Error(`Unexpected content type "${contentType}"`);
    }
    return {
      contentLength: response.headers.get('content-length'),
      contentType,
    };
  } catch (error) {
    throw new Error(
      `Resource check failed for "${url}": ${formatError(error)}`,
      { cause: error },
    );
  }
};

export const loadWorld = async ({
  config,
  renderer,
  scene,
  timer,
  onProgress,
}: LoadWorldOptions): Promise<WorldHandle> => {
  const worldRoot = new Group();
  worldRoot.name = 'world-root';
  worldRoot.position.set(
    config.transform.position.x,
    config.transform.position.y,
    config.transform.position.z,
  );
  worldRoot.rotation.y = config.transform.rotationY;
  worldRoot.scale.setScalar(config.transform.scale);

  const visualLayer = new Group();
  visualLayer.name = 'world-visual-layer';

  const collisionLayer = new Group();
  collisionLayer.name = 'world-collision-layer';

  const generatedColliderLayer = new Group();
  generatedColliderLayer.name = 'world-labs-generated-collider';
  generatedColliderLayer.visible = false;

  const criticalGameplayColliders = createCriticalGameplayColliders();
  collisionLayer.add(
    generatedColliderLayer,
    criticalGameplayColliders,
  );
  worldRoot.add(visualLayer, collisionLayer);
  scene.add(worldRoot);

  let activeMode: WorldMode = 'placeholder';
  let fallbackReason: string | null = null;
  let sparkRenderer: SparkRendererInstance | null = null;
  let splat: SplatMeshInstance | null = null;
  let collider: Group | null = null;
  let colliderMaterial: MeshBasicMaterial | null = null;

  if (config.mode === 'marble') {
    const splatStart = performance.now();
    console.info('[WorldLabs] loading splat...', {
      url: config.visualSrc,
    });
    try {
      const [probe, { SparkRenderer, SplatMesh }] = await Promise.all([
        assertResourceAvailable(publicAssetUrl(config.visualSrc)),
        import('@sparkjsdev/spark'),
      ]);
      console.info('[WorldLabs] splat resource available', {
        url: config.visualSrc,
        contentLength: probe.contentLength,
        contentType: probe.contentType,
      });
      const sharedSparkClock = {
        getElapsedTime: () => timer.getElapsed(),
      } as Clock;
      sparkRenderer = new SparkRenderer({
        renderer,
        clock: sharedSparkClock,
        ...(MOBILE ? { lodSplatCount: mobileBudget.renderSplats, maxPagedSplats: mobileBudget.pagedSplats, numLodFetchers: 1, lodRenderScale: 1.5 } : {}),
      });
      sparkRenderer.name = 'spark-renderer';
      scene.add(sparkRenderer);

      const isRadLodFile = /\.rad(?:$|\?)/i.test(publicAssetUrl(config.visualSrc));
      splat = new SplatMesh({
        url: publicAssetUrl(config.visualSrc),
        onProgress,
        paged: isRadLodFile,
        lod: isRadLodFile ? undefined : true,
        raycastable: false,
      });
      splat.name = 'world-labs-marble-splat';
      splat.userData.worldLabsVisual = true;
      visualLayer.add(splat);
      await splat.initialized;
      activeMode = 'marble';
      console.info('[WorldLabs] splat loaded', {
        url: config.visualSrc,
        elapsed: formatMs(performance.now() - splatStart),
      });
    } catch (error) {
      fallbackReason =
        `Splat failed to load from "${config.visualSrc}": ${formatError(error)}`;
      console.warn('[WorldLabs] splat failed', {
        url: config.visualSrc,
        error,
      });
      console.warn(`[WorldLabs] ${fallbackReason} Using placeholder world.`);
      splat?.removeFromParent();
      splat?.dispose();
      splat = null;
      sparkRenderer?.removeFromParent();
      sparkRenderer?.dispose();
      sparkRenderer = null;
    }
  }

  if (activeMode === 'placeholder') {
    createPlaceholderWorld(visualLayer, criticalGameplayColliders);
  }

  if (config.mode === 'marble') {
    const colliderStart = performance.now();
    const colliderTimeoutMs =
      MOONTOLOGY_CONFIG.loading.worldColliderTimeoutMs;
    console.info('[WorldLabs] loading collider...', {
      url: config.colliderSrc,
      timeoutMs: colliderTimeoutMs,
    });
    try {
      const probe = await withTimeout(
        assertResourceAvailable(publicAssetUrl(config.colliderSrc)),
        colliderTimeoutMs,
        `World Labs collider resource check timed out for "${config.colliderSrc}"`,
      );
      console.info('[WorldLabs] collider resource available', {
        url: config.colliderSrc,
        contentLength: probe.contentLength,
        contentType: probe.contentType,
      });
      const gltf = await withTimeout(
        new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(publicAssetUrl(config.colliderSrc)),
        colliderTimeoutMs,
        `World Labs collider initialization timed out for "${config.colliderSrc}"`,
      );
      collider = gltf.scene;
      collider.name = 'world-labs-collider-mesh';
      collider.userData.worldCollision = true;
      collider.userData.generatedByWorldLabs = true;

      colliderMaterial = new MeshBasicMaterial({
        color: 0x35e6c1,
        wireframe: true,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        visible: false,
      });
      collider.traverse((child) => {
        if (child instanceof Mesh) {
          child.material = colliderMaterial!;
          child.castShadow = false;
          child.receiveShadow = false;
          child.userData.worldCollision = true;
        }
      });

      generatedColliderLayer.add(collider);
      console.info('[WorldLabs] collider loaded', {
        url: config.colliderSrc,
        elapsed: formatMs(performance.now() - colliderStart),
      });
    } catch (error) {
      console.warn('[WorldLabs] collider failed', {
        url: config.colliderSrc,
        error,
      });
    }
  }

  const setColliderVisible = (visible: boolean): void => {
    const showCollider = Boolean(collider) && visible;
    generatedColliderLayer.visible = showCollider;
    if (colliderMaterial) {
      colliderMaterial.visible = showCollider;
    }
  };

  const layout = activeMode === 'marble' && collider && config.layout
    ? new WorldLayout(config.layout, worldRoot, collider) : null;
  if (layout?.supportFloor) criticalGameplayColliders.add(layout.supportFloor);

  return {
    layout,
    root: worldRoot,
    visualLayer,
    collisionLayer,
    generatedColliderLayer,
    criticalGameplayColliders,
    requestedMode: config.mode,
    activeMode,
    colliderAvailable: collider !== null,
    fallbackReason,
    setColliderVisible,
    dispose: () => {
      layout?.dispose();
      splat?.dispose();
      sparkRenderer?.dispose();
      colliderMaterial?.dispose();
      worldRoot.removeFromParent();
      sparkRenderer?.removeFromParent();
    },
  };
};

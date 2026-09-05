import './style.css';
import './go2/mapPanel.css';
import {
  ACESFilmicToneMapping,
  Color,
  Group,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationSystem } from './animation/AnimationSystem';
import { AssetLoader } from './assets/AssetLoader';
import { AssetRegistry } from './assets/AssetRegistry';
import { PlacementController } from './debug/PlacementController';
import { PlacementPanel } from './debug/PlacementPanel';
import { Go2Agent } from './go2/Go2Agent';
import type { Go2Controller } from './go2/Go2Controller';
import { Go2MapPanel } from './go2/Go2MapPanel';
import { ManualGo2Controller } from './go2/ManualGo2Controller';
import { level1 } from './levels/level1';
import { loadWorld, type WorldHandle } from './world/loadWorld';
import { createStagingLights } from './world/placeholderWorld';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Application root "#app" was not found.');
}

app.innerHTML = `
  <canvas id="scene-canvas" aria-label="Interactive lunar robotics staging scene"></canvas>
  <div id="scene-status" class="scene-status" role="status">Initializing Level 1…</div>
  <div id="debug-ui"></div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas');
const status = document.querySelector<HTMLDivElement>('#scene-status');
const debugHost = document.querySelector<HTMLDivElement>('#debug-ui');

if (!canvas || !status || !debugHost) {
  throw new Error('Required application elements could not be created.');
}

const scene = new Scene();
scene.name = 'level-1-scene';
scene.background = new Color(0x090b0e);

const camera = new PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  2000,
);
camera.position.set(13, 10, 17);

const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.075;
orbitControls.target.set(0, 1.25, 1);
orbitControls.minDistance = 1.5;
orbitControls.maxDistance = 250;
orbitControls.update();

const assetLayer = new Group();
assetLayer.name = 'interactive-asset-layer';

const debugLayer = new Group();
debugLayer.name = 'debug-placement-layer';

scene.add(createStagingLights(), assetLayer, debugLayer);

const timer = new Timer();
timer.connect(document);
const animations = new AnimationSystem();
const registry = new AssetRegistry(level1.assets);
const assetLoader = new AssetLoader(assetLayer, registry, animations);

let world: WorldHandle | null = null;
let placementController: PlacementController | null = null;
let placementPanel: PlacementPanel | null = null;
let go2Agent: Go2Agent | null = null;
let go2Controller: Go2Controller | null = null;
let go2Panel: Go2MapPanel | null = null;
let disposed = false;

const resize = (): void => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener('resize', resize);

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const deltaSeconds = Math.min(timer.getDelta(), 0.1);
  animations.update(deltaSeconds);
  if (go2Agent && go2Controller) {
    go2Controller.update(deltaSeconds, go2Agent);
    go2Agent.updateVisualFromAgentRoot(deltaSeconds);
    go2Panel?.update();
  }
  orbitControls.update();
  renderer.render(scene, camera);
});

const disposeSceneResources = (): void => {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  scene.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    meshMaterials.forEach((material) => materials.add(material));
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
};

const dispose = (): void => {
  disposed = true;
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', resize);
  placementController?.dispose();
  placementPanel?.dispose();
  go2Controller?.dispose();
  go2Panel?.dispose();
  animations.dispose();
  orbitControls.dispose();
  disposeSceneResources();
  world?.dispose();
  registry.clear();
  timer.dispose();
  renderer.dispose();
};

const bootstrap = async (): Promise<void> => {
  status.textContent =
    level1.world.mode === 'marble'
      ? 'Loading World Labs lunar environment…'
      : 'Loading placeholder lunar environment…';
  world = await loadWorld({
    config: level1.world,
    renderer,
    scene,
    timer,
  });

  if (disposed) {
    world.dispose();
    return;
  }

  if (import.meta.env.DEV) {
    placementPanel = new PlacementPanel(
      debugHost,
      world,
      registry,
      level1.assets.length,
    );
    placementController = new PlacementController(
      camera,
      canvas,
      orbitControls,
      debugLayer,
      registry,
      (id, root) => placementPanel?.setSelection(id, root),
    );
    placementPanel.setDeselectHandler(placementController.deselect);
  }

  status.textContent = 'Loading configured Level 1 assets…';
  let go2LoadError: unknown = null;
  const go2Load = level1.go2Agent
    ? Go2Agent.create(level1.go2Agent, (loaded, total) => {
        status.textContent =
          `Loading Go2 visual meshes… ${loaded} / ${total}`;
      }).catch((error: unknown) => {
        go2LoadError = error;
        console.warn(
          '[go2] Go2Agent failed to load; Level 1 remains usable.',
          error,
        );
        return null;
      })
    : Promise.resolve(null);

  const [loadedAssets, loadedGo2Agent] = await Promise.all([
    assetLoader.loadAll(level1.assets, () => {
      placementPanel?.setAssetCount(registry.size, level1.assets.length);
    }),
    go2Load,
  ]);

  if (disposed) {
    return;
  }

  placementPanel?.setAssetCount(registry.size, level1.assets.length);

  if (loadedGo2Agent) {
    go2Agent = loadedGo2Agent;
    assetLayer.add(go2Agent.object);
    go2Agent.syncVisualFromAgentRoot();
    go2Controller = new ManualGo2Controller();

    if (import.meta.env.DEV) {
      go2Panel = new Go2MapPanel(debugHost, go2Agent);
    }
  }

  if (go2LoadError) {
    status.textContent = 'Level 1 loaded, but Go2Agent failed — see console';
    status.classList.add('scene-status--error');
  } else if (go2Agent) {
    status.textContent =
      `${loadedAssets.length} Level 1 assets + Go2Agent loaded`;
    window.setTimeout(() => {
      status.classList.add('scene-status--hidden');
    }, 2200);
  } else if (loadedAssets.length === 0) {
    status.textContent =
      'No model sources configured — add models and update src/levels/level1.ts';
  } else {
    status.textContent = `${loadedAssets.length} Level 1 asset${
      loadedAssets.length === 1 ? '' : 's'
    } loaded`;
    window.setTimeout(() => {
      status.classList.add('scene-status--hidden');
    }, 2200);
  }
};

void bootstrap().catch((error: unknown) => {
  console.error('[app] Level 1 failed to initialize.', error);
  status.textContent = 'Level 1 initialization failed — see console';
  status.classList.add('scene-status--error');
});

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}

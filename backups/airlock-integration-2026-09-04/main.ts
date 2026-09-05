import './style.css';
import { SceneRehearsalPanel } from './ui/SceneRehearsalPanel';
import './ui/glass.css';
import './ui/dockablePanel.css';
import './go2/mapPanel.css';
import './static-assets/staticSystems.css';
import './ui/operationalIntelligence.css';
import {
  ACESFilmicToneMapping,
  Color,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationSystem } from './animation/AnimationSystem';
import { AssetLoader, type AssetLoadEvent } from './assets/AssetLoader';
import { AssetRegistry } from './assets/AssetRegistry';
import { MOONTOLOGY_CONFIG } from './config/moontologyConfig';
import { MoonControlSystem } from './controls/MoonControlSystem';
import { HumanoidFleetPanel } from './debug/HumanoidFleetPanel';
import { PlacementController } from './debug/PlacementController';
import { PlacementPanel } from './debug/PlacementPanel';
import { Go2Agent } from './go2/Go2Agent';
import { Go2MapPanel } from './go2/Go2MapPanel';
import {
  createGo2TelemetryClientFromEnvironment,
  type Go2BridgeRuntimeApi,
  type Go2TelemetryClient,
} from './go2/Go2TelemetryClient';
import { Go2SceneRegistrationDebug } from './go2/Go2SceneRegistrationDebug';
import { Go2SyncDebugPanel } from './go2/Go2SyncDebugPanel';
import { ManualGo2Controller } from './go2/ManualGo2Controller';
import { HumanoidFleet } from './humanoids/HumanoidFleet';
import { HUMANOID_FLEET_SCALE, level1 } from './levels/level1';
import {
  AIRLOCK_APPROACH_TRIGGER,
  AIRLOCK_THRESHOLD_TRIGGER,
  FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL,
  FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL,
  SCENE_2_WORLD,
} from './levels/scene2';
import {
  SCENE_1_CALIBRATION,
  SCENE_2_CALIBRATION,
  applyRobotSpawn,
  applyWorldCalibration,
  type SceneRobotCalibration,
} from './levels/sceneRobotCalibration';
import { createLunarBaseOntologySeed } from './ontology/demoOntology';
import { OntologyStore } from './ontology/OntologyStore';
import { PerformanceGovernor } from './runtime/PerformanceGovernor';
import { StaticAssetRoot } from './static-assets/StaticAssetRoot';
import {
  StaticAssetSystem,
  type StaticSceneRuntimeApi,
} from './static-assets/StaticAssetSystem';
import { StaticSystemsDebugPanel } from './static-assets/StaticSystemsDebugPanel';
import { OperationalIntelligenceOverlay } from './ui/OperationalIntelligenceOverlay';
import { DockablePanel } from './ui/DockablePanel';
import { AirlockTransitionController } from './world/airlockTransition';
import { loadWorld, type WorldHandle } from './world/loadWorld';
import { createStagingLights } from './world/placeholderWorld';
import { SceneEntityHighlighter } from './world/SceneEntityHighlighter';

declare global {
  interface Window {
    moontology: OntologyStore;
    moontologyScene: StaticSceneRuntimeApi;
    moontologyGo2?: Go2BridgeRuntimeApi;
    moontologyEnterScene2?: () => void;
  }
}

const DEBUG_UI = false;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Application root "#app" was not found.');
}

app.innerHTML = `
  <canvas id="scene-canvas" aria-label="Interactive lunar robotics staging scene"></canvas>
  <div id="operations-ui"></div>
  <div id="debug-ui"></div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas');
const operationsHost = document.querySelector<HTMLDivElement>('#operations-ui');
const debugHost = document.querySelector<HTMLDivElement>('#debug-ui');
const status = document.createElement('div');
status.id = 'scene-status';
status.className = 'scene-status';
status.setAttribute('role', 'status');
status.textContent = 'Initializing Level 1…';

if (!canvas || !operationsHost || !debugHost) {
  throw new Error('Required application elements could not be created.');
}

const statusDock = DEBUG_UI
  ? new DockablePanel({
      id: 'scene-status',
      title: 'SCENE STATUS',
      host: debugHost,
      className: 'scene-status-dock',
      defaultMode: 'bottom-right',
      extraInsets: { x: 268 },
      zBase: 12,
    })
  : null;
statusDock?.body.append(status);
if (!statusDock) {
  status.classList.add('scene-loading-status');
  app.append(status);
}

const ontologySeed = createLunarBaseOntologySeed(level1);
const ontologyObjectIds = new Set(
  ontologySeed.objects.map((object) => object.id),
);
const ontology = new OntologyStore(ontologySeed);
window.moontology = ontology;
const operationalOverlay = new OperationalIntelligenceOverlay(
  operationsHost,
  ontology,
);
const launchQuery = new URLSearchParams(window.location.search);
const developmentToolsEnabled =
  DEBUG_UI && import.meta.env.DEV && launchQuery.has('debugPanels');
const startInScene2 = launchQuery.has('scene2');
const go2CalibrateEnabled =
  DEBUG_UI && launchQuery.has('go2Calibrate');
const showGo2SyncTools =
  go2CalibrateEnabled ||
  (DEBUG_UI &&
    import.meta.env.DEV &&
    (developmentToolsEnabled || startInScene2));

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
const performanceGovernor = new PerformanceGovernor(renderer, camera);

const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.075;
orbitControls.target.set(0, 1.25, 1);
orbitControls.minDistance = 1.5;
orbitControls.maxDistance = 250;
orbitControls.update();

const assetLayer = new Group();
assetLayer.name = 'interactive-asset-layer';
const humanoidFleet = new HumanoidFleet(HUMANOID_FLEET_SCALE);
const staticAssetRoot = new StaticAssetRoot();
assetLayer.add(humanoidFleet.root, staticAssetRoot.root);

const debugLayer = new Group();
debugLayer.name = 'debug-placement-layer';
const sceneEntityHighlighter = new SceneEntityHighlighter();
debugLayer.add(sceneEntityHighlighter.object);

scene.add(createStagingLights(), assetLayer, debugLayer);

const timer = new Timer();
timer.connect(document);
const animations = new AnimationSystem();
const registry = new AssetRegistry(level1.assets);
const staticAssetSystem = new StaticAssetSystem(
  staticAssetRoot.root,
  registry,
  level1,
  developmentToolsEnabled,
);
window.moontologyScene = staticAssetSystem.api;
const assetLoader = new AssetLoader(
  assetLayer,
  registry,
  animations,
  humanoidFleet,
  staticAssetRoot.root,
);

let world: WorldHandle | null = null;
let airlockTransition: AirlockTransitionController | null = null;
let placementController: PlacementController | null = null;
let placementPanel: PlacementPanel | null = null;
let humanoidFleetPanel: HumanoidFleetPanel | null = null;
let staticSystemsPanel: StaticSystemsDebugPanel | null = null;
let go2Agent: Go2Agent | null = null;
let go2Controller: ManualGo2Controller | null = null;
let go2TelemetryClient: Go2TelemetryClient | null = null;
let go2Panel: Go2MapPanel | null = null;
let go2SyncPanel: Go2SyncDebugPanel | null = null;
let go2RegistrationDebug: Go2SceneRegistrationDebug | null = null;
let activeCalibration: SceneRobotCalibration = startInScene2
  ? SCENE_2_CALIBRATION
  : SCENE_1_CALIBRATION;
let moonControlSystem: MoonControlSystem | null = null;
let rehearsalPanel: SceneRehearsalPanel | null = null;
let disposed = false;
let spatialSyncElapsed = 0;

const worldPosition = new Vector3();

const syncOntologySelection = (): void => {
  const snapshot = ontology.getSnapshot();
  const selectedId = snapshot.selectedEntityId;
  const target =
    selectedId === 'GO2-01'
      ? go2Agent?.object ?? null
      : registry.get(selectedId)?.root ?? null;
  sceneEntityHighlighter.select(
    target,
    snapshot.discrepancyIds.includes(selectedId),
  );
};

const unsubscribeOntologySelection = ontology.subscribe(
  syncOntologySelection,
);

const renderLoopStarted = performanceGovernor.start((time) => {
  timer.update(time);
  const deltaSeconds = Math.min(timer.getDelta(), 0.1);

  airlockTransition?.update();
  staticAssetSystem.update(deltaSeconds);
  humanoidFleetPanel?.update();
  if (go2Agent) {
    go2Controller?.setExternalControlActive(
      go2TelemetryClient?.isDriving() ?? false,
    );
    go2Controller?.update(deltaSeconds, go2Agent);
    go2TelemetryClient?.update(go2Agent.agentRoot, deltaSeconds);
    go2Agent.updateVisualFromAgentRoot(deltaSeconds);
    go2Panel?.update();
    go2SyncPanel?.update();
  }
  const bridgeState = go2TelemetryClient?.getState();
  rehearsalPanel?.update(timer.getDelta(), go2Agent?.agentRoot ?? null,
    activeCalibration.id !== SCENE_1_CALIBRATION.id ||
      (airlockTransition && airlockTransition.getState() !== 'scene1')
      ? 'Scene 1 rehearsal stopped for scene transition.'
      : bridgeState?.telemetryActive && !bridgeState.robotConnected
        ? 'Robot telemetry lost. Resume after reconnection.'
        : null);
  animations.update(deltaSeconds);
  sceneEntityHighlighter.update();
  spatialSyncElapsed += deltaSeconds;
  if (spatialSyncElapsed >= 0.25) {
    spatialSyncElapsed = 0;
    for (const { config, root } of registry.values()) {
      if (!ontologyObjectIds.has(config.id)) {
        continue;
      }
      root.getWorldPosition(worldPosition);
      ontology.updatePosition(config.id, {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      });
    }
    if (go2Agent) {
      go2Agent.agentRoot.getWorldPosition(worldPosition);
      ontology.updatePosition('GO2-01', {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      });
    }
  }
  orbitControls.update();
  renderer.render(scene, camera);
});

if (!renderLoopStarted) {
  status.textContent =
    'Render loop blocked because another Moon render loop is already active';
  status.classList.add('scene-status--error');
}

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
  unsubscribeOntologySelection();
  operationalOverlay.dispose();
  rehearsalPanel?.dispose();
  sceneEntityHighlighter.dispose();
  moonControlSystem?.dispose();
  performanceGovernor.dispose();
  placementController?.dispose();
  placementPanel?.dispose();
  humanoidFleetPanel?.dispose();
  staticSystemsPanel?.dispose();
  staticAssetSystem.dispose();
  go2TelemetryClient?.dispose();
  delete window.moontologyGo2;
  delete window.moontologyEnterScene2;
  go2Controller?.dispose();
  go2Panel?.dispose();
  go2SyncPanel?.dispose();
  go2RegistrationDebug?.dispose();
  statusDock?.dispose();
  animations.dispose();
  orbitControls.dispose();
  disposeSceneResources();
  world?.dispose();
  airlockTransition = null;
  registry.clear();
  timer.dispose();
  renderer.dispose();
};

const bootstrap = async (): Promise<void> => {
  if (!renderLoopStarted) {
    return;
  }

  const bootstrapWorld = startInScene2 ? SCENE_2_WORLD : level1.world;
  status.textContent =
    bootstrapWorld.mode === 'marble'
      ? startInScene2
        ? 'Loading World Labs Scene 2…'
        : 'Loading World Labs lunar environment…'
      : 'Loading placeholder lunar environment…';
  world = await loadWorld({
    config: bootstrapWorld,
    renderer,
    scene,
    timer,
  });
  if (startInScene2) {
    applyWorldCalibration(world.root, SCENE_2_CALIBRATION);
    console.info('[WORLD2] scene loaded');
    console.info('[WORLD2] calibration applied');
  }

  if (disposed) {
    world.dispose();
    return;
  }
  console.info('[app] world ready', {
    requestedMode: world.requestedMode,
    activeMode: world.activeMode,
    colliderAvailable: world.colliderAvailable,
    fallbackReason: world.fallbackReason,
  });

  if (developmentToolsEnabled) {
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
      (id, root) => {
        placementPanel?.setSelection(id, root);
        if (id && ontologyObjectIds.has(id)) {
          ontology.selectEntity(id);
        }
      },
    );
    placementPanel.setDeselectHandler(placementController.deselect);
    humanoidFleetPanel = new HumanoidFleetPanel(
      debugHost,
      registry,
      (id) => {
        placementController?.select(id);
      },
    );
  }

  status.textContent = 'Loading configured Level 1 assets…';
  const updateAssetLoadStatus = (event: AssetLoadEvent): void => {
    if (event.phase === 'loading') {
      status.textContent =
        `Loading ${event.id} (${event.index} / ${event.total})…`;
      return;
    }

    if (event.phase === 'failed') {
      status.textContent =
        `Skipped ${event.id}: ${event.message ?? 'asset failed to load'}`;
    }
  };
  let go2LoadError: unknown = null;
  const go2Config = level1.go2Agent
    ? startInScene2
      ? {
          ...level1.go2Agent,
          position: [
            SCENE_2_CALIBRATION.robotSpawnPosition.x,
            SCENE_2_CALIBRATION.robotGroundY,
            SCENE_2_CALIBRATION.robotSpawnPosition.z,
          ] as const,
          yaw: SCENE_2_CALIBRATION.robotSpawnYaw,
        }
      : level1.go2Agent
    : undefined;
  const go2Load = go2Config
    ? withTimeout(
        Go2Agent.create(go2Config, (loaded, total) => {
          status.textContent =
            `Loading Go2 visual meshes… ${loaded} / ${total}`;
        }),
        MOONTOLOGY_CONFIG.loading.go2TimeoutMs,
        'Go2Agent load timed out',
      ).catch((error: unknown) => {
        go2LoadError = error;
        console.warn(
          `[go2] Go2Agent failed to load; Level 1 remains usable: ${formatError(error)}`,
          error,
        );
        return null;
      })
    : Promise.resolve(null);

  const [loadedAssets, loadedGo2Agent] = await Promise.all([
    assetLoader.loadAll(
      level1.assets,
      () => {
        placementPanel?.setAssetCount(registry.size, level1.assets.length);
      },
      updateAssetLoadStatus,
    ),
    go2Load,
  ]);

  if (disposed) {
    return;
  }

  rehearsalPanel = new SceneRehearsalPanel(debugHost, registry,
    level1.assets.filter(asset => asset.type === 'humanoid').map(asset => asset.id));
  staticAssetSystem.initialize();
  placementPanel?.setAssetCount(registry.size, level1.assets.length);
  if (developmentToolsEnabled) {
    staticSystemsPanel = new StaticSystemsDebugPanel(
      debugHost,
      staticAssetSystem.api,
    );
  }

  if (loadedGo2Agent) {
    go2Agent = loadedGo2Agent;
    assetLayer.add(go2Agent.object);
    go2Agent.syncVisualFromAgentRoot();
    go2Controller = new ManualGo2Controller();
    go2TelemetryClient = createGo2TelemetryClientFromEnvironment(
      activeCalibration,
    );
    go2TelemetryClient.attach(go2Agent.agentRoot);
    window.moontologyGo2 = go2TelemetryClient.api;
    moonControlSystem = new MoonControlSystem({
      host: debugHost,
      showUi: true,
      camera,
      go2Root: go2Agent.agentRoot,
      orbitControls,
      robotController: go2Controller,
      placementController,
    });

    if (developmentToolsEnabled) {
      go2Panel = new Go2MapPanel(debugHost, go2Agent);
    }

    const registeredGo2 = go2Agent;
    const enterScene2Registration = (nextWorld: WorldHandle | null): void => {
      activeCalibration = SCENE_2_CALIBRATION;
      applyRobotSpawn(registeredGo2.agentRoot, SCENE_2_CALIBRATION);
      registeredGo2.acknowledgeAgentRootSnap();
      go2TelemetryClient?.setCalibration(SCENE_2_CALIBRATION);
      go2TelemetryClient?.attach(registeredGo2.agentRoot);
      go2TelemetryClient?.resetPhysicalOrigin();
      if (showGo2SyncTools) {
        go2RegistrationDebug ??= new Go2SceneRegistrationDebug();
        go2RegistrationDebug.attach(
          scene,
          nextWorld?.root ?? null,
          registeredGo2.agentRoot,
          SCENE_2_CALIBRATION,
        );
      } else {
        go2RegistrationDebug?.detach();
      }
      moonControlSystem?.recenterOnGo2();
    };

    if (startInScene2) {
      humanoidFleet.root.visible = false;
      staticAssetRoot.root.visible = false;
      enterScene2Registration(world);
      console.info('[GO2] Scene 2 spawn applied');
    } else {
      airlockTransition = new AirlockTransitionController({
        scene,
        go2Root: go2Agent.agentRoot,
        airlockAnchor:
          registry.get(level1.staticSystems?.airlock.assetId ?? '')?.root ??
          null,
        approachTrigger: AIRLOCK_APPROACH_TRIGGER,
        approachTriggerLocal: FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL,
        thresholdTrigger: AIRLOCK_THRESHOLD_TRIGGER,
        thresholdTriggerLocal: FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL,
        airlock: staticAssetSystem.api,
        getScene1World: () => world,
        clearScene1World: () => {
          world = null;
        },
        loadWorldLabsWorld: async (url) =>
          loadWorld({
            config: {
              ...SCENE_2_WORLD,
              visualSrc: url,
            },
            renderer,
            scene,
            timer,
          }),
        scene2Url: SCENE_2_WORLD.visualSrc,
        scene2Calibration: SCENE_2_CALIBRATION,
        onScene2World: (nextWorld) => {
          world = nextWorld;
        },
        onGo2Moved: () => {
          go2Agent?.acknowledgeAgentRootSnap();
        },
        onEnteredScene2: () => {
          enterScene2Registration(world);
        },
        hideScene1Actors: () => {
          humanoidFleet.root.visible = false;
          staticAssetRoot.root.visible = false;
        },
        initializeScene2Humanoids: () => {
          // Scene 2 humanoids are optional for this transition.
        },
      });
      window.moontologyEnterScene2 = () => airlockTransition?.enterScene2();
    }

    if (showGo2SyncTools) {
      go2RegistrationDebug ??= new Go2SceneRegistrationDebug();
      if (startInScene2 && world && go2Agent) {
        go2RegistrationDebug.attach(
          scene,
          world.root,
          go2Agent.agentRoot,
          SCENE_2_CALIBRATION,
        );
      }
      go2SyncPanel = new Go2SyncDebugPanel(
        debugHost,
        go2TelemetryClient,
        go2RegistrationDebug,
      );
    }
  }
  syncOntologySelection();
  if (!statusDock && !go2LoadError) status.hidden = true;

  if (go2LoadError) {
    status.textContent =
      `Level 1 loaded, but Go2Agent failed: ${formatError(go2LoadError)}`;
    status.classList.add('scene-status--error');
  } else if (go2Agent) {
    status.textContent =
      `${registry.size} Level 1 assets + Go2Agent loaded`;
    window.setTimeout(() => {
      statusDock?.setCollapsed(true);
    }, 2200);
  } else if (loadedAssets.length === 0) {
    status.textContent =
      'No model sources configured — add models and update src/levels/level1.ts';
  } else {
    status.textContent = `${registry.size} Level 1 asset${
      registry.size === 1 ? '' : 's'
    } loaded`;
    window.setTimeout(() => {
      statusDock?.setCollapsed(true);
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

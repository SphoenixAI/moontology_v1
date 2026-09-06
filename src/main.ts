import { MOBILE } from './runtime/deviceProfile';
import { ASSET_STANDOFF_RADII, REGION_STANDOFF_RADII, approachPlan, planStandoffDetailed, regionCentroid } from './relay/approach';
import { connectLiveMapRelay } from './relay/LiveMapRelay';
import { SceneGrounding } from './world/SceneGrounding';
import type { LayoutRehearsal } from './debug/LayoutRehearsal';
import type { DemoRouteRehearsal } from './debug/DemoRouteRehearsal';
import './style.css';
import { BackgroundTraffic } from './vehicles/BackgroundTraffic';
import { HumanoidProximityOverlay } from './ui/HumanoidProximityOverlay';
import type { AirlockRehearsal } from './debug/AirlockRehearsal';
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
  Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationSystem } from './animation/AnimationSystem';
import { AssetLoader, type AssetLoadEvent } from './assets/AssetLoader';
import { AssetRegistry } from './assets/AssetRegistry';
import { ControlModes, MOONTOLOGY_CONFIG } from './config/moontologyConfig';
import { MoonControlSystem } from './controls/MoonControlSystem';
import { useKeyboardDemo } from './controls/keyboardDemo';
import { ProjectLinks } from './ui/ProjectLinks';
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
    /** Dev-only: rendered-rig vs authoritative-pose diagnostics for gait/smoothing verification. */
    moontologyGo2Visual?: () => { lag: number; root: number[]; rig: number[]; yaw: number; follow: string; gait: Record<string, unknown> } | null;
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

let designBookOpen = false;
let webglLost = false;
const projectLinks = new ProjectLinks(app, open => { designBookOpen = open; if (MOBILE) performanceGovernor.setSuspended(open || webglLost); });

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
  antialias: !MOBILE,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
const performanceGovernor = new PerformanceGovernor(renderer, camera);
canvas.dataset.quality = MOBILE ? 'mobile' : 'full';
app.dataset.quality = canvas.dataset.quality;
canvas.dataset.pixelRatio = String(renderer.getPixelRatio());
// Do not attempt an automatic reload loop if the OS revokes this GPU context.
if (MOBILE && import.meta.env.MODE === 'public') {
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    webglLost = true;
    performanceGovernor.setSuspended(true);
    go2Controller?.setExternalControlActive(true);
    const notice = document.createElement('div');
    notice.className = 'mobile-render-notice glass-surface';
    notice.setAttribute('role', 'alert');
    notice.innerHTML = '<p>The browser paused the 3D map.</p><button type="button">Reload map</button>';
    notice.querySelector('button')!.onclick = () => location.reload();
    app.append(notice);
  }, { once: true });
}

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
let layoutRehearsal: LayoutRehearsal | null = null;
let airlockRehearsal: AirlockRehearsal | null = null;
let demoRouteRehearsal: DemoRouteRehearsal | null = null;
let rehearsalPanel: SceneRehearsalPanel | null = null;
let disposed = false;
let spatialSyncElapsed = 0;
let sceneGrounding: SceneGrounding | null = null;
let backgroundTraffic: BackgroundTraffic | null = null;
let humanoidProximity: HumanoidProximityOverlay | null = null;
let mapBlock: string | null = null;
let physicalMapHold: string | null = null;
const previousMapPosition = new Vector3();
ontology.setLayoutProvider(() => world?.layout?.observation() ?? null);

const frameMetrics = { frames: 0, last_frame_ms: 0, max_frame_ms: 0 };
let previousFrameTime = 0;
const liveMapRelay = import.meta.env.DEV ? connectLiveMapRelay({
  registry, ontology,
  performance: () => ({ ...frameMetrics, render_age_ms: previousFrameTime ? performance.now() - previousFrameTime : null, visible: document.visibilityState === 'visible' }),
  planApproach: (targetId = 'EXC-01') => {
    if (!world?.layout || !go2Agent) return null;
    const start = go2Agent.agentRoot.getWorldPosition(new Vector3());
    const asset = registry.get(targetId)?.root;
    // The bridge needs to know whether the waypoint is the standoff goal or an intermediate
    // grid node: only a goal within a fraction of one physical step counts as arrival.
    const detail = (plan: ReturnType<typeof approachPlan>) => plan && { x: plan.waypoint.x, y: plan.waypoint.y, z: plan.waypoint.z, kind: plan.kind, radius: plan.radius };
    if (asset) {
      const target = asset.getWorldPosition(new Vector3());
      if (targetId === 'EXC-01') return detail(approachPlan(world.layout, start, target));
      // Other assets: nearest standoff with a straight clear lane; footprints differ per asset.
      return detail(planStandoffDetailed(world.layout, start, target, ASSET_STANDOFF_RADII, 2));
    }
    // Layout regions (buildings, walkways, doorways) are targets too: aim at the centroid.
    const region = world.layout.observation().regions.find(r => r.id === targetId);
    if (!region) return null;
    return detail(planStandoffDetailed(world.layout, start, regionCentroid(region.polygon, start.y), REGION_STANDOFF_RADII, 3));
  },
  resetDemo: () => {
    // Name the guard so an operator/agent can act on it instead of guessing.
    if (activeCalibration.id !== 'SCENE_1') return `scene_is_${activeCalibration.id}`;
    if (!go2Agent) return 'robot_model_still_loading';
    if (!world?.layout) return 'layout_not_loaded';
    if (physicalMapHold) return `physical_hold: ${physicalMapHold}`;
    if (go2TelemetryClient?.isDriving()) return 'legacy_telemetry_driving';
    applyRobotSpawn(go2Agent.agentRoot, SCENE_1_CALIBRATION);
    const support = world.layout.sample(go2Agent.agentRoot.position.x, go2Agent.agentRoot.position.z);
    if (support.height !== null) go2Agent.agentRoot.position.y = support.height;
    go2Agent.acknowledgeAgentRootSnap(); rehearsalPanel?.director.reset();
    // A rehearsal that reached the doorway left the facade door open ('opening'); re-arm it so the
    // next run can reach the airlock again.
    airlockTransition?.resetScene1();
    frameMetrics.frames = 0; frameMetrics.max_frame_ms = 0;
    return null;
  },
  robot: () => go2Agent?.agentRoot ?? null,
  world: () => ({
    // World phase, not the raw door state: the facade door opening ('opening') is still Scene 1, so
    // a Go2 parked at the doorway standoff keeps a stable identity and a ready map.
    identity: `${activeCalibration.id}:${world?.activeMode ?? 'loading'}:${airlockTransition?.getWorldPhase() ?? 'initial'}`,
    ready: !!world?.layout && !!go2Agent && !world.fallbackReason && registry.size === level1.assets.length &&
      (!airlockTransition || ['scene1', 'scene2'].includes(airlockTransition.getWorldPhase())),
    hold: physicalMapHold,
    metersToWorldUnits: activeCalibration.metersToWorldUnits,
  }),
  legacyTelemetryActive: () => !!go2TelemetryClient?.getState().bridgeConnected || !!go2TelemetryClient?.isDriving(),
  applyPose: (position, yaw) => {
    if (!go2Agent || !world?.layout) return 'map_not_ready';
    const requested = new Vector3(position.x, position.y, position.z);
    const result = world.layout.constrain(go2Agent.agentRoot.position, requested);
    if (result.blocked) return `map_boundary: ${result.blocked}`;
    go2Agent.agentRoot.position.copy(result.position);
    go2Agent.agentRoot.rotation.y = yaw;
    go2Agent.recordAuthoritativePose();
    return null;
  },
  applyJoints: (angles) => go2Agent?.setTelemetryJoints(angles) ?? false,
  jointSource: () => go2Agent?.gaitState.jointSource ?? null,
}) : null;

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
  if (previousFrameTime) {
    frameMetrics.last_frame_ms = time - previousFrameTime;
    frameMetrics.max_frame_ms = Math.max(frameMetrics.max_frame_ms, frameMetrics.last_frame_ms);
  }
  previousFrameTime = time; frameMetrics.frames++;
  if (frameMetrics.frames % 30 === 0) canvas.dataset.renderedFrames = String(frameMetrics.frames);
  timer.update(time);
  const deltaSeconds = Math.min(timer.getDelta(), 0.1);

  ontology.tickIntelligence();
  const semanticHold = ontology.getMissionState().holdReasons[0] ?? null;
  if (semanticHold && !physicalMapHold && go2TelemetryClient?.getState().telemetryActive) {
    physicalMapHold = `Ontology safety hold: ${semanticHold}`;
    go2TelemetryClient.api.stop();
  }
  layoutRehearsal?.update();
  airlockRehearsal?.update(deltaSeconds);
  staticAssetSystem.update(deltaSeconds);
  humanoidFleetPanel?.update();
  if (go2Agent) {
    liveMapRelay?.state.tick();
    previousMapPosition.copy(go2Agent.agentRoot.position);
    go2Controller?.setExternalControlActive(
      designBookOpen || !!semanticHold || !!physicalMapHold || !ontology.canAnimate('GO2-01') || !!liveMapRelay?.state.ownsPose() || (go2TelemetryClient?.isDriving() ?? false) ||
      airlockTransition?.getState() === 'entering' || airlockTransition?.getState() === 'loading',
    );
    const transitioning = airlockTransition?.getState() === 'entering' || airlockTransition?.getState() === 'loading';
    const keyboardBlock = semanticHold ?? physicalMapHold ??
      (!ontology.canAnimate('GO2-01') ? 'Go2 is held by the mission.' :
        transitioning ? 'World transition in progress.' :
          liveMapRelay?.state.ownsPose() ? 'Robot session owns Go2’s position. Keyboard movement is paused.' :
            go2TelemetryClient?.isDriving() ? 'Robot telemetry controls Go2. Keyboard movement is paused.' : null);
    moonControlSystem?.setKeyboardBlock(keyboardBlock,
      !!liveMapRelay?.state.ownsPose() && !semanticHold && !physicalMapHold && !transitioning &&
      !(go2TelemetryClient?.isDriving() ?? false));
    go2Controller?.update(deltaSeconds, go2Agent);
    if (!physicalMapHold && !liveMapRelay?.state.ownsPose() && airlockTransition?.getState() !== 'entering' && airlockTransition?.getState() !== 'loading') {
      go2TelemetryClient?.update(go2Agent.agentRoot, deltaSeconds);
    }
    if (world?.layout) {
      const requested = go2Agent.agentRoot.position.clone();
      const result = world.layout.constrain(previousMapPosition, requested);
      go2Agent.agentRoot.position.copy(result.position);
      const support = world.layout.sample(result.position.x, result.position.z);
      go2Agent.agentRoot.userData.surfaceRegion = support.regionId;
      mapBlock = result.blocked ?? mapBlock;
      if (result.blocked && go2TelemetryClient?.isDriving() && !physicalMapHold) {
        physicalMapHold = `Map/telemetry mismatch: ${result.blocked}. Mission held; revalidate physical alignment.`;
        go2Agent.agentRoot.userData.rejectedTelemetryPose = requested.toArray();
        go2TelemetryClient.api.stop();
      }
    } else if (world?.requestedMode === 'marble') {
      go2Agent.agentRoot.position.copy(previousMapPosition);
      mapBlock = 'Map boundaries unavailable. Movement held.';
      if (!physicalMapHold && go2TelemetryClient?.getState().telemetryActive) {
        physicalMapHold = mapBlock;
        go2TelemetryClient.api.stop();
      }
    }
    world?.layout?.setRobotState({ position: go2Agent.agentRoot.position.toArray(),
      regionId: go2Agent.agentRoot.userData.surfaceRegion ?? null, blocked: mapBlock, physicalHold: physicalMapHold,
      rejectedTelemetryPose: go2Agent.agentRoot.userData.rejectedTelemetryPose ?? null });
    go2Agent.updateVisualFromAgentRoot(deltaSeconds);
    go2Panel?.update();
    go2SyncPanel?.update();
  }
  airlockTransition?.update();
  if (!physicalMapHold && go2TelemetryClient?.getState().telemetryActive &&
    (airlockTransition?.getState() === 'entering' || airlockTransition?.getState() === 'loading')) {
    physicalMapHold = 'World transition: physical mission held. Revalidate alignment before resuming.';
    go2TelemetryClient.api.stop();
  }
  const bridgeState = go2TelemetryClient?.getState();
  if (!physicalMapHold && bridgeState?.telemetryActive && !bridgeState.robotConnected) {
    physicalMapHold = 'Telemetry lost: physical mission held. Revalidate alignment before resuming.';
    go2TelemetryClient?.api.stop();
  }
  rehearsalPanel?.update(timer.getDelta(), go2Agent?.agentRoot ?? null,
    activeCalibration.id !== SCENE_1_CALIBRATION.id ||
      (airlockTransition && airlockTransition.getWorldPhase() !== 'scene1')
      ? 'Scene 1 rehearsal stopped for scene transition.'
      : semanticHold ?? physicalMapHold ?? (sceneGrounding?.issues.size ? 'Placement blocked: ' + [...sceneGrounding.issues].map(([id, reason]) => `${id}: ${reason}`).join('; ') : null) ?? (!world?.layout ? 'Waiting for measured map boundaries.' : null) ?? (bridgeState?.telemetryActive && !bridgeState.robotConnected
        ? 'Robot telemetry lost. Resume after reconnection.'
        : null));
  backgroundTraffic?.update(timer.getDelta(), go2Agent?.agentRoot ?? null,
    activeCalibration.id === SCENE_1_CALIBRATION.id && (!airlockTransition || airlockTransition.getWorldPhase() === 'scene1') &&
    !physicalMapHold && !liveMapRelay?.state.isMissionHeld());
  for (const { config, root } of registry.values()) {
    root.userData.semanticPaused = !ontology.canAnimate(config.id);
    root.userData.authoritativeState = ontology.getAssetState(config.id)?.authoritativeState;
  }
  animations.update(deltaSeconds);
  if (activeCalibration.id === SCENE_1_CALIBRATION.id) sceneGrounding?.update();
  sceneEntityHighlighter.update();
  spatialSyncElapsed += deltaSeconds;
  if (spatialSyncElapsed >= 0.25) {
    spatialSyncElapsed = 0;
    ontology.batch(() => {
    ontology.syncLayoutRegions();
    ontology.syncSceneRegistry(registry.values().map(({ config, root }) => {
      root.getWorldPosition(worldPosition);
      return { id: config.id, type: config.type === 'humanoid' ? 'Humanoid' as const : 'Facility' as const,
        label: config.role ?? config.id, position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z } };
    }));
    for (const { config, root } of registry.values()) {
      ontologyObjectIds.add(config.id);
      ontology.updateSurface(config.id, root.userData.surfaceRegion ?? 'UNKNOWN', root.userData.layoutStatus ?? 'REGISTERED');
      root.getWorldPosition(worldPosition);
      ontology.updatePosition(config.id, {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      });
    }
    if (go2Agent) {
      go2Agent.agentRoot.getWorldPosition(worldPosition);
      ontology.updateSurface('GO2-01', go2Agent.agentRoot.userData.surfaceRegion ?? 'UNKNOWN', physicalMapHold ? 'HELD' : mapBlock ? 'BLOCKED' : 'GROUNDED');
      ontology.updatePosition('GO2-01', {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      });
    }
    });
  }
  if (orbitControls.enabled) orbitControls.update();
  moonControlSystem?.update(deltaSeconds);
  humanoidProximity?.update(go2Agent?.agentRoot ?? null, activeCalibration.id === SCENE_1_CALIBRATION.id &&
    (!airlockTransition || airlockTransition.getWorldPhase() === 'scene1'));
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
  const textures = new Set<Texture>();
  materials.forEach((material) => {
    Object.values(material).forEach(value => { if (value instanceof Texture) textures.add(value); });
    material.dispose();
  });
  textures.forEach(texture => {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  });
};

const dispose = (): void => {
  disposed = true;
  liveMapRelay?.dispose();
  assetLoader.dispose();
  projectLinks.dispose();
  unsubscribeOntologySelection();
  operationalOverlay.dispose();
  backgroundTraffic?.dispose();
  humanoidProximity?.dispose();
  rehearsalPanel?.dispose();
  demoRouteRehearsal?.dispose();
  airlockTransition?.dispose();
  airlockRehearsal?.dispose();
  layoutRehearsal?.dispose();
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
  // Public assets download alongside the world, with at most two source decodes.
  // Local presentation registration and loading order remain unchanged.
  if (import.meta.env.MODE === 'public' && !MOBILE) void assetLoader.preload(level1.assets);
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
    onProgress: event => {
      const downloaded = `${Math.round(event.loaded / 1048576)} MB`;
      const progress = event.lengthComputable && event.total > 0
        ? `${Math.min(100, Math.round(event.loaded / event.total * 100))}%`
        : downloaded;
      status.textContent = event.lengthComputable && event.loaded >= event.total
        ? 'Preparing lunar environment…'
        : `Loading lunar environment · ${progress}`;
    },
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
  canvas.dataset.worldReadyMs = String(Math.round(performance.now()));

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
      import.meta.env.DEV && (launchQuery.has('airlockTest') || launchQuery.has('layoutTest')) && launchQuery.has('airlockOnly')
        ? level1.assets.filter(asset => asset.procedural)
        : level1.assets,
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
    level1.assets.filter(asset => asset.type === 'humanoid').map(asset => asset.id), ontology, scene);
  staticAssetSystem.initialize();
  if (!startInScene2 && world?.layout) {
    sceneGrounding = new SceneGrounding(registry, world.layout);
    sceneGrounding.update();
    backgroundTraffic = new BackgroundTraffic(registry, world.layout, ontology,
      document.querySelector<HTMLElement>('.scene-rehearsal-panel .dock-panel__body') ?? undefined);
    humanoidProximity = new HumanoidProximityOverlay(registry, ontology, camera);
    sceneGrounding.update();
  }
  rehearsalPanel.setGroundSampler((x, z) => world?.layout?.sample(x, z, false).height ?? null);
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
    const support = world?.layout?.sample(go2Agent.agentRoot.position.x, go2Agent.agentRoot.position.z);
    if (support?.height !== null && support?.height !== undefined) go2Agent.agentRoot.position.y = support.height;
    go2Agent.setMotionResolver((from, requested) => {
      if (physicalMapHold || !world?.layout) return from.clone();
      const result = world.layout.constrain(from, requested);
      mapBlock = result.blocked; return result.position;
    });
    go2Agent.acknowledgeAgentRootSnap();
    go2Controller = new ManualGo2Controller();
    go2TelemetryClient = createGo2TelemetryClientFromEnvironment(
      activeCalibration,
    );
    go2TelemetryClient.attach(go2Agent.agentRoot);
    window.moontologyGo2 = go2TelemetryClient.api;
    if (import.meta.env.DEV) {
      const agent = go2Agent;
      window.moontologyGo2Visual = () => ({ lag: agent.visualLag, root: agent.agentRoot.position.toArray(),
        rig: agent.visualRig.position.toArray(), yaw: agent.visualRig.rotation.y, follow: agent.visualFollowSource, gait: { ...agent.gaitState } });
    }
    moonControlSystem = new MoonControlSystem({
      host: debugHost,
      showUi: true,
      camera,
      go2Root: go2Agent.agentRoot,
      orbitControls,
      robotController: go2Controller,
      placementController,
      requestKeyboardDemo: () => liveMapRelay ? useKeyboardDemo(liveMapRelay.state, {
        physicalHold: physicalMapHold,
        legacyTelemetryActive: !!go2TelemetryClient?.getState().bridgeConnected || !!go2TelemetryClient?.isDriving(),
        transitioning: airlockTransition?.getState() === 'entering' || airlockTransition?.getState() === 'loading',
      }) : 'The authoritative map connection is unavailable.',
    });

    if (import.meta.env.DEV && launchQuery.has('layoutTest')) {
      const { LayoutRehearsal, describeTextures } = await import('./debug/LayoutRehearsal');
      layoutRehearsal = new LayoutRehearsal(go2Agent, camera, orbitControls,
        () => moonControlSystem?.setMode(ControlModes.CAMERA),
        () => moonControlSystem?.setMode(ControlModes.ROBOT),
        () => !!go2TelemetryClient?.getState().bridgeConnected || !!go2TelemetryClient?.isDriving(),
        (x, z) => !!world?.layout?.footprint(x, z).traversable,
        () => ({ world: world?.layout?.definition.id, revision: world?.layout?.definition.revision,
          robot: world?.layout?.observation().robotState,
          assets: registry.values().filter(a => a.config.src).map(a => ({ id: a.config.id,
            position: a.root.getWorldPosition(new Vector3()).toArray().map(n => Number(n.toFixed(3))),
            surface: a.root.userData.surfaceRegion, contactY: a.root.userData.surfaceY, status: a.root.userData.layoutStatus, textures: describeTextures(a.model) })),
          issues: [...sceneGrounding?.issues ?? []], traffic: backgroundTraffic?.report() }));
    }

    if (import.meta.env.DEV && new URLSearchParams(location.search).has('routeTest')) {
      const { DemoRouteRehearsal } = await import('./debug/DemoRouteRehearsal');
      if (!disposed) demoRouteRehearsal = new DemoRouteRehearsal(go2Agent, rehearsalPanel.director,
        () => !!go2TelemetryClient?.getState().robotConnected || !!go2TelemetryClient?.isDriving() ||
          activeCalibration.id !== SCENE_1_CALIBRATION.id || !!airlockTransition && airlockTransition.getWorldPhase() !== 'scene1');
    }

    if (developmentToolsEnabled) {
      go2Panel = new Go2MapPanel(debugHost, go2Agent);
    }

    const registeredGo2 = go2Agent;
    const enterScene2Registration = (nextWorld: WorldHandle | null): void => {
      activeCalibration = SCENE_2_CALIBRATION;
      ontology.setSceneLabel('World Labs · Scene 2');
      ontology.selectEntity('GO2-01');
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
      moonControlSystem?.setInteriorCamera(true);
      moonControlSystem?.recenterOnGo2();
    };

    if (startInScene2) {
      humanoidFleet.root.visible = false;
      staticAssetRoot.root.visible = false;
      enterScene2Registration(world);
      console.info('[GO2] Scene 2 spawn applied');
    } else {
      let scene2Staging = new Scene();
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
        canTrigger: () => {
          if (!ontology.canAnimate('Airlock-2A')) return false;
          const state = go2TelemetryClient?.getState();
          return !document.hidden && !physicalMapHold && !!world?.layout && !(state?.telemetryActive && !state.robotConnected);
        },
        activateScene2World: () => scene.add(...scene2Staging.children),
        loadWorldLabsWorld: async (url) => {
          scene2Staging = new Scene();
          return loadWorld({
            config: {
              ...SCENE_2_WORLD,
              visualSrc: url,
            },
            renderer,
            scene: scene2Staging,
            timer,
          });
        },
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
      if (import.meta.env.DEV && launchQuery.has('airlockTest')) {
        const anchor = registry.get('Airlock-2A')?.root;
        const { AirlockRehearsal } = await import('./debug/AirlockRehearsal');
        if (anchor && !disposed) airlockRehearsal = new AirlockRehearsal(
          anchor, go2Agent, camera, orbitControls, airlockTransition,
          () => Boolean(go2TelemetryClient?.isDriving() || go2TelemetryClient?.getState().bridgeConnected), staticAssetSystem?.api);
      }
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
  canvas.dataset.sceneReadyMs = String(Math.round(performance.now()));
  canvas.dataset.assetCount = String(registry.size);
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

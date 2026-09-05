import './style.css';
import '../ui/glass.css';
import '../ui/dockablePanel.css';
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationSystem } from '../animation/AnimationSystem';
import { AssetLoader } from '../assets/AssetLoader';
import { AssetRegistry } from '../assets/AssetRegistry';
import {
  getNeutralJointAngle,
  identifyGo2LegJoints,
  logGo2LegJoints,
} from '../go2/go2Joints';
import { loadOfficialGo2 } from '../go2/loadOfficialGo2';
import { level1 } from '../levels/level1';
import type { LevelAssetConfig } from '../levels/types';
import { Go2DebugPanel } from './Go2DebugPanel';
import { DockablePanel } from '../ui/DockablePanel';

const app = document.querySelector<HTMLDivElement>('#go2-test');
if (!app) {
  throw new Error('Go2 test root was not found.');
}

app.innerHTML = `
  <canvas id="go2-canvas" aria-label="Unitree Go2 URDF articulation test"></canvas>
  <div id="go2-panel-host"></div>
  <div id="go2-status" role="status">Loading official Unitree Go2 URDF…</div>
  <a class="go2-back-link" href="/">Back to Level 1</a>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#go2-canvas');
const panelHost = document.querySelector<HTMLDivElement>('#go2-panel-host');
const status = document.querySelector<HTMLDivElement>('#go2-status');
const backLink = document.querySelector<HTMLAnchorElement>('.go2-back-link');

if (!canvas || !panelHost || !status || !backLink) {
  throw new Error('Go2 test UI could not be initialized.');
}

const statusDock = new DockablePanel({
  id: 'go2-status',
  title: 'STATUS',
  host: panelHost,
  className: 'go2-status-dock',
  defaultMode: 'bottom-left',
});
statusDock.body.append(status);

const backDock = new DockablePanel({
  id: 'go2-back',
  title: 'NAVIGATION',
  host: panelHost,
  className: 'go2-back-dock',
  defaultMode: 'top-left',
});
backDock.body.append(backLink);

const scene = new Scene();
scene.name = 'isolated-go2-urdf-test';
scene.background = new Color(0x101317);

const camera = new PerspectiveCamera(
  48,
  window.innerWidth / window.innerHeight,
  0.01,
  100,
);
camera.position.set(2.7, 1.65, 3.15);

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

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.target.set(0, 0.72, 0);
controls.minDistance = 0.55;
controls.maxDistance = 12;
controls.update();

const hemisphere = new HemisphereLight(0xd9e5f0, 0x252a30, 1.55);
const keyLight = new DirectionalLight(0xffffff, 2.8);
keyLight.position.set(3, 5, 3);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 15;

const floor = new Mesh(
  new PlaneGeometry(8, 8),
  new MeshStandardMaterial({
    color: 0x62676d,
    roughness: 0.94,
    metalness: 0.02,
  }),
);
floor.name = 'go2-test-floor';
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;

const grid = new GridHelper(8, 32, 0x9ca4ac, 0x777e86);
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.22;

const robotPoseRoot = new Group();
robotPoseRoot.name = 'independent-go2-visual-pose-root';
robotPoseRoot.position.x = 0.62;

const urdfCoordinateRoot = new Group();
urdfCoordinateRoot.name = 'urdf-z-up-to-three-y-up';
urdfCoordinateRoot.rotation.x = -Math.PI / 2;
robotPoseRoot.add(urdfCoordinateRoot);

const humanoidLayer = new Group();
humanoidLayer.name = 'existing-humanoid-scale-reference';

scene.add(
  hemisphere,
  keyLight,
  floor,
  grid,
  robotPoseRoot,
  humanoidLayer,
);

const timer = new Timer();
timer.connect(document);
const humanoidAnimations = new AnimationSystem();
let debugPanel: Go2DebugPanel | null = null;
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
  humanoidAnimations.update(Math.min(timer.getDelta(), 0.1));
  controls.update();
  renderer.render(scene, camera);
});

const loadHumanoidReference = async (): Promise<void> => {
  const source = level1.assets.find(({ id }) => id === 'digging-bot');
  if (!source?.src) {
    console.warn(
      '[go2-test] Existing digging humanoid is unavailable; continuing without scale reference.',
    );
    return;
  }

  const config: LevelAssetConfig = {
    ...source,
    id: 'go2-test-humanoid-reference',
    position: [-0.82, 0, 0],
    rotation: [0, 0, 0],
  };
  const registry = new AssetRegistry([config]);
  const loader = new AssetLoader(
    humanoidLayer,
    registry,
    humanoidAnimations,
  );
  await loader.load(config);
};

const placeRobotOnFloor = (): Vector3 => {
  robotPoseRoot.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(robotPoseRoot);
  robotPoseRoot.position.y -= bounds.min.y;
  robotPoseRoot.updateWorldMatrix(true, true);
  return new Box3().setFromObject(robotPoseRoot).getSize(new Vector3());
};

const bootstrap = async (): Promise<void> => {
  const [loadedGo2] = await Promise.all([
    loadOfficialGo2((loaded, total) => {
      status.textContent = `Loading Go2 visual meshes… ${loaded} / ${total}`;
    }),
    loadHumanoidReference().catch((error: unknown) => {
      console.warn(
        '[go2-test] Humanoid scale reference failed to load.',
        error,
      );
    }),
  ]);
  const { robot, visualMeshCount } = loadedGo2;

  if (disposed) {
    return;
  }

  robot.name = 'official-unitree-go2-urdf';
  urdfCoordinateRoot.add(robot);

  const legJoints = identifyGo2LegJoints(robot);
  for (const entry of legJoints) {
    entry.joint.setJointValue(getNeutralJointAngle(entry));
  }

  const dimensions = placeRobotOnFloor();
  logGo2LegJoints(legJoints);
  console.info('[go2-test] URDF hierarchy validation', {
    robotName: robot.robotName,
    links: Object.keys(robot.links).length,
    joints: Object.keys(robot.joints).length,
    actuatedLegJoints: legJoints.map(({ name }) => name),
    visualMeshes: visualMeshCount,
    dimensionsMeters: dimensions.toArray(),
  });

  debugPanel = new Go2DebugPanel(panelHost, robotPoseRoot, legJoints);
  status.textContent = `${visualMeshCount} Go2 visual meshes loaded · 12 / 12 leg joints ready`;
  status.classList.add('go2-status--ready');
};

const dispose = (): void => {
  disposed = true;
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', resize);
  debugPanel?.dispose();
  statusDock.dispose();
  backDock.dispose();
  humanoidAnimations.dispose();
  controls.dispose();
  timer.dispose();
  renderer.dispose();
};

void bootstrap().catch((error: unknown) => {
  console.error('[go2-test] Validation failed.', error);
  status.textContent =
    error instanceof Error ? error.message : 'Go2 URDF validation failed.';
  status.classList.add('go2-status--error');
});

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}

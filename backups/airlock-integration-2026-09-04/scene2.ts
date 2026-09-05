import { Box3, Vector3 } from 'three';
import {
  SCENE_2_CALIBRATION,
  toRobotSpawn,
  toScene2Transform,
  toWorldTransformConfig,
} from './sceneRobotCalibration';
import type { WorldConfig } from './types';

const worldMode = import.meta.env.VITE_WORLD_MODE === 'placeholder'
  ? 'placeholder'
  : 'marble';

/**
 * Scene 2 World Labs interior. Loaded through the existing `loadWorld`
 * path after the airlock transition disposes Scene 1.
 *
 * Tune SCENE_2_CALIBRATION — not the Spark loader — to register the Go2.
 */
export const SCENE_2_WORLD: WorldConfig = {
  mode: worldMode,
  visualSrc:
    '/worldlabs/scene-2/Futuristic%20Museum%20Interiors.spz',
  colliderSrc:
    '/worldlabs/scene-2/Futuristic%20Museum%20Interiors_collider.glb',
  transform: toWorldTransformConfig(SCENE_2_CALIBRATION),
};

export const SCENE_2_TRANSFORM = toScene2Transform(SCENE_2_CALIBRATION);

export const SCENE_2_GO2_SPAWN = toRobotSpawn(SCENE_2_CALIBRATION);

/**
 * Trigger volumes are authored in facadeAirlockAnchor-local coordinates.
 * The world-space boxes are deterministic fallbacks if the visual facade is
 * unavailable; normal runtime checks transform Go2 into the anchor's space.
 */
export const FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL = new Box3(
  new Vector3(-2, -2, 0.7),
  new Vector3(2, 0.75, 3.8),
);

export const FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL = new Box3(
  new Vector3(-1.15, -2, -0.65),
  new Vector3(1.15, 0.75, 0.65),
);

export const AIRLOCK_APPROACH_TRIGGER = new Box3(
  new Vector3(-2.05, 0.15, -12.615),
  new Vector3(0.15, 1.6625, -10.91),
);

export const AIRLOCK_THRESHOLD_TRIGGER = new Box3(
  new Vector3(-1.5825, 0.15, -13.3575),
  new Vector3(-0.3175, 1.6625, -12.6425),
);

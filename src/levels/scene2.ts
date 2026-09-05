import { SCENE_2_LAYOUT } from './sceneLayouts';
import { APPROACH_LOCAL, THRESHOLD_LOCAL, APPROACH_WORLD, THRESHOLD_WORLD } from './airlockPlacement';
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
  layout: SCENE_2_LAYOUT,
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
export const FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL = APPROACH_LOCAL;
export const FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL = THRESHOLD_LOCAL;
export const AIRLOCK_APPROACH_TRIGGER = APPROACH_WORLD;
export const AIRLOCK_THRESHOLD_TRIGGER = THRESHOLD_WORLD;

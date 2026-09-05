import { SCENE_1_LAYOUT } from './sceneLayouts';
import { SCENE_1_STOPS, SCENE_1_ROUTE_SPAWN } from './scene1DemoRoute';
import type {
  LevelConfig,
  WorldMode,
  WorldTransformConfig,
} from './types';
import {
  SCENE_1_STATIC_ASSETS,
  SCENE_1_STATIC_SYSTEMS,
  SCENE_1_WORK_GROUPS,
} from './scene1StaticAssets';

const worldMode: WorldMode =
  import.meta.env.VITE_WORLD_MODE === 'placeholder'
    ? 'placeholder'
    : 'marble';

export const WORLD_LABS_TRANSFORM: WorldTransformConfig = {
  position: { x: 0, y: 0, z: 0 },
  rotationY: 0,
  scale: 1,
};

export const GO2_SPAWN = SCENE_1_ROUTE_SPAWN;

export const HUMANOID_FLEET_SCALE = 1;

/**
 * Level 1 is the single source of truth for interactive asset placement.
 *
 * Replace each null `src` with the public URL of its real model. GLB/GLTF is
 * preferred, and FBX is supported for incoming assets that have not been
 * converted.
 */
export const level1: LevelConfig = {
  id: 'level-1',
  world: {
    layout: SCENE_1_LAYOUT,
    mode: worldMode,
    visualSrc:
      '/worldlabs/lunar-base/Moon%20Base%20with%20Habitats.spz',
    colliderSrc:
      '/worldlabs/lunar-base/Moon%20Base%20with%20Habitats_collider.glb',
    transform: WORLD_LABS_TRANSFORM,
  },
  go2Agent: {
    id: 'GO2-01',
    position: [GO2_SPAWN.x, GO2_SPAWN.y, GO2_SPAWN.z],
    yaw: GO2_SPAWN.rotationY,
    visible: true,
  },
  assets: [
    {
      id: 'H01',
      type: 'humanoid',
      src: '/models/humanoids/full-detail-glb/Dig%20And%20Plant%20Seeds.glb',
      position: [-7.5, 0, -3],
      rotation: [0, 0.3, 0],
      scale: [1, 1, 1],
      role: 'Regolith Excavation',
      state: 'WORKING',
      animation: 'Armature|mixamo.com|Layer0',
      animationSpeed: 1,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H04',
      type: 'humanoid',
      src: '/models/humanoids/full-detail-glb/Shared%20Worker%20Actions.glb',
      position: [3.75, 0, -3.6],
      rotation: [0, -0.25, 0],
      scale: [1, 1, 1],
      role: 'Logistics Inventory',
      state: 'WORKING',
      animation: 'Writing',
      animationSpeed: 0.92,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H02',
      type: 'humanoid',
      src: '/models/humanoids/full-detail-glb/Shared%20Worker%20Actions.glb',
      position: [-3.75, 0, -3.2],
      rotation: [0, 0.15, 0],
      scale: [1, 1, 1],
      role: 'Power / Cable Inspection',
      state: 'WORKING',
      animation: 'Kneeling Inspecting',
      animationSpeed: 0.88,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H03',
      type: 'humanoid',
      src: '/models/humanoids/full-detail-glb/Shared%20Worker%20Actions.glb',
      position: [0, 0, -3.1],
      rotation: [0, 0.28, 0],
      scale: [1, 1, 1],
      role: 'Dust Mitigation / Surface Maintenance',
      state: 'WORKING',
      animation: 'h01-sweat',
      animationSpeed: 0.9,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H06',
      type: 'humanoid',
      src: '/models/humanoids/full-detail-glb/Shared%20Worker%20Actions.glb',
      position: [10.5, 0, -3.4],
      rotation: [0, -0.32, 0],
      scale: [1, 1, 1],
      role: 'Emergency Support',
      state: 'WORKING',
      animation: 'Defeat',
      animationSpeed: 1,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    ...SCENE_1_STATIC_ASSETS,
  ],
  workGroups: SCENE_1_WORK_GROUPS,
  staticSystems: SCENE_1_STATIC_SYSTEMS,
};

for (const stop of SCENE_1_STOPS) {
  const actor = level1.assets.find(asset => asset.id === stop.id);
  if (actor) {
    actor.position = [...stop.position];
    actor.rotation = [0, stop.yaw, 0];
    actor.role = stop.title;
    actor.state = 'AWAITING_CUE';
    actor.loop = false;
    actor.association = { entityId: stop.id, taskId: stop.taskId, relatedEntityIds: [stop.equipment], workGroupIds: [] };
  }
}

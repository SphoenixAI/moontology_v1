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

export const GO2_SPAWN = {
  x: 1.5,
  y: 0,
  z: 1.5,
  rotationY: -Math.PI / 2,
};

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
      src: '/models/humanoids/optimized/Dig%20And%20Plant%20Seeds.glb',
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
      src: '/models/humanoids/optimized/Writing.glb',
      position: [3.75, 0, -3.6],
      rotation: [0, -0.25, 0],
      scale: [1, 1, 1],
      role: 'Logistics Inventory',
      state: 'WORKING',
      animation: 'Armature|mixamo.com|Layer0',
      animationSpeed: 0.92,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H02',
      type: 'humanoid',
      src: '/models/humanoids/optimized/Kneeling%20Inspecting.glb',
      position: [-3.75, 0, -3.2],
      rotation: [0, 0.15, 0],
      scale: [1, 1, 1],
      role: 'Power / Cable Inspection',
      state: 'WORKING',
      animation: 'Armature|mixamo.com|Layer0',
      animationSpeed: 0.88,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H05',
      type: 'humanoid',
      src: '/models/humanoids/optimized/h01-kicking.glb',
      position: [7.2, 0, -3.5],
      rotation: [0, -0.2, 0],
      scale: [1, 1, 1],
      role: 'Cable Deployment',
      state: 'WORKING',
      animation: 'Armature|mixamo.com|Layer0',
      animationSpeed: 0.95,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H03',
      type: 'humanoid',
      src: '/models/humanoids/optimized/h01-sweat.glb',
      position: [0, 0, -3.1],
      rotation: [0, 0.28, 0],
      scale: [1, 1, 1],
      role: 'Dust Mitigation / Surface Maintenance',
      state: 'WORKING',
      animation: 'Armature|mixamo.com|Layer0',
      animationSpeed: 0.9,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'H06',
      type: 'humanoid',
      src: '/models/humanoids/optimized/Defeat.glb',
      position: [10.5, 0, -3.4],
      rotation: [0, -0.32, 0],
      scale: [1, 1, 1],
      role: 'Emergency Support',
      state: 'WORKING',
      animation: 'Armature|mixamo.com|Layer0',
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

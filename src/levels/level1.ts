import type {
  LevelConfig,
  WorldMode,
  WorldTransformConfig,
} from './types';

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
    id: 'go2-agent-01',
    position: [GO2_SPAWN.x, GO2_SPAWN.y, GO2_SPAWN.z],
    yaw: GO2_SPAWN.rotationY,
    visible: true,
  },
  assets: [
    {
      id: 'digging-bot',
      type: 'humanoid',
      src: '/models/humanoids/Dig%20And%20Plant%20Seeds.fbx',
      position: [-6, 0, -3],
      rotation: [0, 0, 0],
      scale: [0.01, 0.01, 0.01],
      animationSpeed: 1,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'maintenance-bot',
      type: 'humanoid',
      src: null,
      todo:
        'Set src to /models/humanoids/<maintenance-humanoid>.glb or .fbx.',
      position: [-2, 0, -3],
      rotation: [0, 0, 0],
      scale: [0.01, 0.01, 0.01],
      animationSpeed: 1,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'inspection-bot',
      type: 'humanoid',
      src: null,
      todo:
        'Set src to /models/humanoids/<inspection-humanoid>.glb or .fbx.',
      position: [2, 0, -3],
      rotation: [0, 0, 0],
      scale: [0.01, 0.01, 0.01],
      animationSpeed: 1,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'cargo-handler',
      type: 'humanoid',
      src: null,
      todo:
        'Set src to /models/humanoids/<cargo-handling-humanoid>.glb or .fbx.',
      position: [6, 0, -3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      animationSpeed: 1,
      loop: true,
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'rover-1',
      type: 'rover',
      src: '/models/rovers/lunar%20excavator.glb',
      position: [-4, 0, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'rover-2',
      type: 'rover',
      src: null,
      todo: 'Set src to /models/rovers/<rover-2>.glb or .fbx.',
      position: [4, 0, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'cargo-boxes',
      type: 'cargo',
      src: null,
      todo: 'Set src to /models/cargo/<cargo-boxes>.glb or .fbx.',
      position: [-3, 0, 6],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: 'equipment-placeholder',
      type: 'equipment',
      src: null,
      todo: 'Set src to /models/equipment/<equipment>.glb or .fbx.',
      position: [3, 0, 6],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      castShadow: true,
      receiveShadow: true,
    },
  ],
};

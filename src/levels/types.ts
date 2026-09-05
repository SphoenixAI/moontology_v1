export type Vector3Tuple = readonly [number, number, number];

export type AssetType =
  | 'humanoid'
  | 'rover'
  | 'cargo'
  | 'equipment'
  | 'go2';

export type WorldMode = 'placeholder' | 'marble';

export interface TransformConfig {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface WorldTransformConfig {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotationY: number;
  scale: number;
}

export interface LevelAssetConfig extends TransformConfig {
  id: string;
  type: AssetType;
  /**
   * Public URL for a .glb, .gltf, or .fbx model.
   * Leave null until a model is available; the rest of the level still loads.
   */
  src: string | null;
  todo?: string;
  visible?: boolean;
  animation?: string;
  animationSpeed?: number;
  loop?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface WorldConfig {
  mode: WorldMode;
  visualSrc: string;
  colliderSrc: string;
  /**
   * The only coordinate-system correction applied to World Labs exports.
   * Interactive assets always remain in normal Three.js world coordinates.
   */
  transform: WorldTransformConfig;
}

export interface Go2AgentConfig {
  id: string;
  position: Vector3Tuple;
  yaw: number;
  visible?: boolean;
}

export interface LevelConfig {
  id: string;
  world: WorldConfig;
  assets: readonly LevelAssetConfig[];
  go2Agent?: Go2AgentConfig;
}

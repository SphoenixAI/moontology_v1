import type { LayoutDefinition } from './sceneLayouts';
export type Vector3Tuple = readonly [number, number, number];

export type AssetType =
  | 'humanoid'
  | 'rover'
  | 'airlock'
  | 'infrastructure'
  | 'cargo'
  | 'equipment'
  | 'go2';

export type WorldMode = 'placeholder' | 'marble';
export type ProceduralAssetType =
  | 'facade-airlock-anchor'
  | 'airlock-leak-origin'
  | 'cable-endpoint';
export type CableTaskState = 'NOT_STARTED' | 'PARTIAL' | 'CONNECTED';

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

export interface LevelAssetAssociationConfig {
  entityId: string;
  assignedWorker?: string;
  assignedWorkers?: readonly string[];
  taskId?: string;
  workGroupIds: readonly string[];
  relatedEntityIds?: readonly string[];
}

export interface LevelAssetConfig extends TransformConfig {
  id: string;
  type: AssetType;
  /**
   * Public URL for a .glb, .gltf, .fbx, or supported image asset.
   * Procedural placement anchors intentionally use null.
   */
  src: string | null;
  todo?: string;
  visible?: boolean;
  role?: string;
  state?: string;
  sceneTags?: readonly string[];
  association?: LevelAssetAssociationConfig;
  procedural?: ProceduralAssetType;
  parentAssetId?: string;
  animation?: string;
  animationSpeed?: number;
  loop?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  targetHeightMeters?: number;
  targetLengthMeters?: number;
  groundY?: number;
}

export interface SceneWorkGroupConfig {
  id: string;
  role: string;
  memberEntityIds: readonly string[];
  sceneTags: readonly string[];
  interactionPoints?: readonly {
    id: string;
    role: string;
    position: Vector3Tuple;
    sceneTags: readonly string[];
  }[];
}

export interface CableDeploymentVisualConfig {
  enabled: boolean;
  roverAssetId: string;
  endpointAssetId: string;
  cableEntityId: string;
  taskId: string;
  outletPosition: Vector3Tuple;
  initialState: CableTaskState;
  partialRatio: number;
}

export interface AirlockInteractionConfig {
  assetId: string;
  leakOriginAssetId: string;
  closedPosition: Vector3Tuple;
  openPosition: Vector3Tuple;
  moveDurationSeconds: number;
  purgeDurationSeconds: number;
  emergencyFaultHoldSeconds: number;
  emergencyOpenHoldSeconds: number;
  leakParticleCount: number;
}

export interface StaticSystemsConfig {
  cable: CableDeploymentVisualConfig;
  airlock: AirlockInteractionConfig;
}

export interface WorldConfig {
  layout?: LayoutDefinition;
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
  workGroups?: readonly SceneWorkGroupConfig[];
  staticSystems?: StaticSystemsConfig;
  go2Agent?: Go2AgentConfig;
}

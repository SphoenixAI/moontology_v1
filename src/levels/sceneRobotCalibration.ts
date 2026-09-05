import { Euler, Vector3, type Object3D } from 'three';
import type { WorldTransformConfig } from './types';
import { GO2_SPAWN, WORLD_LABS_TRANSFORM } from './level1';

export type PlanarAxis = 'x' | 'z' | '-x' | '-z';
export type PhysicalPlanarAxes = 'xy' | 'xz';
export type SceneCalibrationId = 'SCENE_1' | 'SCENE_2';

/**
 * Per-scene registration for the virtual Go2.
 *
 * World Labs scenes do not share origin, yaw, scale, or floor height.
 * AgentRoot owns world translation and yaw. VisualRig / URDF meshes never
 * perform world motion.
 */
export interface SceneRobotCalibration {
  id: SceneCalibrationId;
  worldPosition: { x: number; y: number; z: number };
  worldRotationY: number;
  worldScale: number;
  robotSpawnPosition: { x: number; z: number };
  robotSpawnYaw: number;
  robotGroundY: number;
  metersToWorldUnits: number;
  physicalPlanarAxes: PhysicalPlanarAxes;
  physicalForwardAxis: PlanarAxis;
  physicalLateralAxis: PlanarAxis;
  smoothingFactor: number;
}

export const SCENE_1_CALIBRATION: SceneRobotCalibration = {
  id: 'SCENE_1',
  worldPosition: { ...WORLD_LABS_TRANSFORM.position },
  worldRotationY: WORLD_LABS_TRANSFORM.rotationY,
  worldScale: WORLD_LABS_TRANSFORM.scale,
  robotSpawnPosition: { x: GO2_SPAWN.x, z: GO2_SPAWN.z },
  robotSpawnYaw: GO2_SPAWN.rotationY,
  robotGroundY: GO2_SPAWN.y,
  metersToWorldUnits: 1,
  physicalPlanarAxes: 'xy',
  physicalForwardAxis: 'x',
  physicalLateralAxis: '-z',
  smoothingFactor: 0.18,
};

/**
 * Scene 2 collider AABB after GLTFLoader's coordinate conversion:
 *   X [-6.48, 9.87]  Y [-0.14, 18.56]  Z [-39.97, 8.09]
 * The central walkable floor is near Y=0 and extends from the entrance at
 * Z≈0 into the interior along -Z.
 */
export const SCENE_2_CALIBRATION: SceneRobotCalibration = {
  id: 'SCENE_2',
  worldPosition: { x: 0, y: 0, z: 0 },
  worldRotationY: 0,
  worldScale: 1,
  robotSpawnPosition: { x: 0, z: 0 },
  robotSpawnYaw: Math.PI / 2,
  robotGroundY: 0,
  metersToWorldUnits: 1,
  physicalPlanarAxes: 'xy',
  physicalForwardAxis: '-z',
  physicalLateralAxis: '-x',
  smoothingFactor: 0.18,
};

export const toWorldTransformConfig = (
  calibration: SceneRobotCalibration,
): WorldTransformConfig => ({
  position: { ...calibration.worldPosition },
  rotationY: calibration.worldRotationY,
  scale: calibration.worldScale,
});

export const toScene2Transform = (calibration: SceneRobotCalibration) => ({
  position: new Vector3(
    calibration.worldPosition.x,
    calibration.worldPosition.y,
    calibration.worldPosition.z,
  ),
  rotation: new Euler(0, calibration.worldRotationY, 0),
  scale: new Vector3(
    calibration.worldScale,
    calibration.worldScale,
    calibration.worldScale,
  ),
});

export const toRobotSpawn = (calibration: SceneRobotCalibration) => ({
  position: new Vector3(
    calibration.robotSpawnPosition.x,
    calibration.robotGroundY,
    calibration.robotSpawnPosition.z,
  ),
  yaw: calibration.robotSpawnYaw,
});

export const applyWorldCalibration = (
  worldRoot: Object3D,
  calibration: SceneRobotCalibration,
): void => {
  worldRoot.position.set(
    calibration.worldPosition.x,
    calibration.worldPosition.y,
    calibration.worldPosition.z,
  );
  worldRoot.rotation.set(0, calibration.worldRotationY, 0);
  worldRoot.scale.setScalar(calibration.worldScale);
  worldRoot.updateMatrixWorld(true);
};

export const applyRobotSpawn = (
  go2Root: Object3D,
  calibration: SceneRobotCalibration,
): void => {
  go2Root.position.set(
    calibration.robotSpawnPosition.x,
    calibration.robotGroundY,
    calibration.robotSpawnPosition.z,
  );
  go2Root.rotation.set(0, calibration.robotSpawnYaw, 0);
  go2Root.updateMatrixWorld(true);
};

import { Vector3 } from 'three';
import type {
  PlanarAxis,
  SceneRobotCalibration,
} from '../levels/sceneRobotCalibration';

export interface PhysicalPose {
  position: { x: number; y: number; z: number };
  yaw: number;
}

const axisToXZ = (axis: PlanarAxis): readonly [number, number] => {
  switch (axis) {
    case 'x':
      return [1, 0];
    case '-x':
      return [-1, 0];
    case 'z':
      return [0, 1];
    case '-z':
      return [0, -1];
  }
};

export const normalizeAngle = (angle: number): number =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

export const lerpAngle = (
  current: number,
  target: number,
  t: number,
): number => current + normalizeAngle(target - current) * t;

/**
 * Map a physical planar delta into the active World Labs scene.
 * Physical vertical displacement is discarded.
 */
export const mapPhysicalDeltaToScene = (
  physicalDelta: Vector3,
  calibration: SceneRobotCalibration,
): Vector3 => {
  const forward = axisToXZ(calibration.physicalForwardAxis);
  const lateral = axisToXZ(calibration.physicalLateralAxis);
  const planar =
    calibration.physicalPlanarAxes === 'xz'
      ? { forward: physicalDelta.x, lateral: physicalDelta.z }
      : { forward: physicalDelta.x, lateral: physicalDelta.y };

  return new Vector3(
    planar.forward * forward[0] + planar.lateral * lateral[0],
    0,
    planar.forward * forward[1] + planar.lateral * lateral[1],
  ).multiplyScalar(calibration.metersToWorldUnits);
};

export const mapPhysicalPoseToVirtual = (
  pose: PhysicalPose,
  origin: PhysicalPose,
  virtualOrigin: { position: Vector3; yaw: number },
  calibration: SceneRobotCalibration,
): { position: Vector3; yaw: number } => {
  const physicalDelta = new Vector3(
    pose.position.x - origin.position.x,
    pose.position.y - origin.position.y,
    pose.position.z - origin.position.z,
  );
  const mappedDelta = mapPhysicalDeltaToScene(physicalDelta, calibration);
  return {
    position: new Vector3(
      virtualOrigin.position.x + mappedDelta.x,
      calibration.robotGroundY,
      virtualOrigin.position.z + mappedDelta.z,
    ),
    yaw: normalizeAngle(
      virtualOrigin.yaw + normalizeAngle(pose.yaw - origin.yaw),
    ),
  };
};

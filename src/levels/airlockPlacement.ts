import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';

/** Single manually authored facade registration, shared by art and triggers. */
export const AIRLOCK_PLACEMENT = {
  position: [-0.9, 0.95, -18.35] as const,
  rotation: [0, 0, 0] as const,
  scale: [0.45, 0.45, 0.45] as const,
};
export const APPROACH_LOCAL = new Box3(new Vector3(-2, -5, 0.7), new Vector3(2, 1, 5));
export const THRESHOLD_LOCAL = new Box3(new Vector3(-1.15, -5, -0.65), new Vector3(1.15, 1, 0.65));
const matrix = new Matrix4().compose(
  new Vector3().fromArray(AIRLOCK_PLACEMENT.position),
  new Quaternion().setFromEuler(new Euler(...AIRLOCK_PLACEMENT.rotation)),
  new Vector3().fromArray(AIRLOCK_PLACEMENT.scale),
);
export const APPROACH_WORLD = APPROACH_LOCAL.clone().applyMatrix4(matrix);
export const THRESHOLD_WORLD = THRESHOLD_LOCAL.clone().applyMatrix4(matrix);

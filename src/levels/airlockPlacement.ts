import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';

/** Single manually authored facade registration, shared by art and triggers. */
export const AIRLOCK_PLACEMENT = {
  position: [-0.6, 0.95, -18.35] as const,
  rotation: [0, 0, 0] as const,
  scale: [0.45, 0.45, 0.45] as const,
};
/** Meters: art, floor cutout and entry triggers share one clear opening. */
export const AIRLOCK_APERTURE = { width: 1.8, height: 1.85, floorY: -0.23 } as const;
const halfWidth = AIRLOCK_APERTURE.width / 2 / AIRLOCK_PLACEMENT.scale[0];
export const APPROACH_LOCAL = new Box3(new Vector3(-halfWidth, -5, 0.7), new Vector3(halfWidth, 3, 7));
// Entry starts at the sill, before the footprint reaches the back of the portal.
export const THRESHOLD_LOCAL = new Box3(new Vector3(-halfWidth, -5, -0.65), new Vector3(halfWidth, 3, 0.9));
export const AIRLOCK_PASSAGE = {
  minX: AIRLOCK_PLACEMENT.position[0] - AIRLOCK_APERTURE.width / 2,
  maxX: AIRLOCK_PLACEMENT.position[0] + AIRLOCK_APERTURE.width / 2,
  backZ: AIRLOCK_PLACEMENT.position[2] - 0.65,
  frontZ: AIRLOCK_PLACEMENT.position[2] + 3.5,
} as const;
const matrix = new Matrix4().compose(
  new Vector3().fromArray(AIRLOCK_PLACEMENT.position),
  new Quaternion().setFromEuler(new Euler(...AIRLOCK_PLACEMENT.rotation)),
  new Vector3().fromArray(AIRLOCK_PLACEMENT.scale),
);
export const APPROACH_WORLD = APPROACH_LOCAL.clone().applyMatrix4(matrix);
export const THRESHOLD_WORLD = THRESHOLD_LOCAL.clone().applyMatrix4(matrix);

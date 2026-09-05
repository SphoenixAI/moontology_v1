import { Group } from 'three';

/**
 * Stable home for hand-authored gameplay colliders. Generated World Labs
 * geometry must never be added here or treated as authoritative for Go2.
 */
export const createCriticalGameplayColliders = (): Group => {
  const group = new Group();
  group.name = 'critical-gameplay-colliders';
  group.userData.authoritativeGameplayCollision = true;
  return group;
};

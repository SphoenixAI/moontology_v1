import { Group } from 'three';

/**
 * Transform parent for non-humanoid Level 1 assets. It intentionally remains
 * separate from HumanoidFleetRoot so fleet-wide scaling never affects props.
 */
export class StaticAssetRoot {
  readonly root = new Group();

  constructor() {
    this.root.name = 'StaticAssetRoot';
  }
}

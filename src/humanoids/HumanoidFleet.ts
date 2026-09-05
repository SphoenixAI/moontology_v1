import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from 'three';

const TARGET_STANDING_HEIGHT_METERS = 1.75;

export interface HumanoidNormalization {
  nativeHeight: number;
  normalizedHeight: number;
  normalizationScale: number;
}

export class HumanoidFleet {
  readonly root = new Group();

  constructor(scale: number) {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(
        `[humanoids] HUMANOID_FLEET_SCALE must be greater than zero; received ${scale}.`,
      );
    }

    this.root.name = 'HumanoidFleetRoot';
    this.root.scale.setScalar(scale);
  }

  add(
    assetRoot: Group,
    model: Object3D,
  ): HumanoidNormalization | null {
    // SkinnedMesh updates its inverse bind transform in updateMatrixWorld.
    // updateWorldMatrix alone leaves cloned rigs with stale bind transforms.
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model, true);
    const nativeSize = bounds.getSize(new Vector3());
    const nativeHeight = nativeSize.y;

    if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) {
      console.warn(
        `[humanoids] Could not measure "${assetRoot.name}". It remains at native scale.`,
      );
      assetRoot.add(model);
      this.root.add(assetRoot);
      return null;
    }

    const normalizationScale =
      TARGET_STANDING_HEIGHT_METERS / nativeHeight;
    const normalizationRoot = new Group();
    normalizationRoot.name = `${assetRoot.name}-normalization`;
    normalizationRoot.scale.setScalar(normalizationScale);
    normalizationRoot.position.y = -bounds.min.y * normalizationScale;
    const selectionProxy = new Mesh(
      new BoxGeometry(nativeSize.x, nativeSize.y, nativeSize.z),
      new MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        opacity: 0,
        transparent: true,
      }),
    );
    selectionProxy.name = `${assetRoot.name}-selection-proxy`;
    selectionProxy.position.copy(bounds.getCenter(new Vector3()));
    selectionProxy.userData.humanoidSelectionProxy = true;
    normalizationRoot.add(model, selectionProxy);
    assetRoot.add(normalizationRoot);
    this.root.add(assetRoot);
    assetRoot.updateWorldMatrix(true, true);

    console.info(
      `[humanoids] "${assetRoot.name}" normalized from ${nativeHeight.toFixed(3)} native units to ${TARGET_STANDING_HEIGHT_METERS.toFixed(2)} m (factor ${normalizationScale.toFixed(6)}).`,
    );

    return {
      nativeHeight,
      normalizedHeight: TARGET_STANDING_HEIGHT_METERS,
      normalizationScale,
    };
  }
}

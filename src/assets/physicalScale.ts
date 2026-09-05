import { Box3, Vector3, type Object3D } from 'three';

export interface ScaleResult {
  originalMeters: number;
  finalMeters: number;
  factor: number;
}

export const scaleObjectToHeight = (
  object: Object3D,
  targetHeightMeters: number,
): ScaleResult | null => {
  object.updateWorldMatrix(true, true);
  const originalHeight = new Box3()
    .setFromObject(object)
    .getSize(new Vector3()).y;

  if (!Number.isFinite(originalHeight) || originalHeight <= 0) {
    console.warn(`[Scale] Invalid height for ${object.name || 'object'}.`);
    return null;
  }

  const factor = targetHeightMeters / originalHeight;
  object.scale.multiplyScalar(factor);
  object.updateWorldMatrix(true, true);
  const finalHeight = new Box3()
    .setFromObject(object)
    .getSize(new Vector3()).y;

  console.info(
    `[Scale] ${object.name || 'object'} height ${originalHeight.toFixed(3)} → ${finalHeight.toFixed(3)} m (factor ${factor.toFixed(4)})`,
  );
  return {
    originalMeters: originalHeight,
    finalMeters: finalHeight,
    factor,
  };
};

export const scaleObjectToLength = (
  object: Object3D,
  targetLengthMeters: number,
): ScaleResult | null => {
  object.updateWorldMatrix(true, true);
  const originalSize = new Box3()
    .setFromObject(object)
    .getSize(new Vector3());
  const originalLength = Math.max(originalSize.x, originalSize.z);

  if (!Number.isFinite(originalLength) || originalLength <= 0) {
    console.warn(`[Scale] Invalid length for ${object.name || 'object'}.`);
    return null;
  }

  const factor = targetLengthMeters / originalLength;
  object.scale.multiplyScalar(factor);
  object.updateWorldMatrix(true, true);
  const finalSize = new Box3()
    .setFromObject(object)
    .getSize(new Vector3());
  const finalLength = Math.max(finalSize.x, finalSize.z);

  console.info(
    `[Scale] ${object.name || 'object'} length ${originalLength.toFixed(3)} → ${finalLength.toFixed(3)} m (factor ${factor.toFixed(4)})`,
  );
  return {
    originalMeters: originalLength,
    finalMeters: finalLength,
    factor,
  };
};

export const placeObjectBottomAtY = (
  object: Object3D,
  groundY = 0,
): number | null => {
  object.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(object);
  if (!Number.isFinite(bounds.min.y)) {
    console.warn(`[Ground] Invalid bounds for ${object.name || 'object'}.`);
    return null;
  }

  const worldDeltaY = groundY - bounds.min.y;
  const targetWorldPosition = object.getWorldPosition(new Vector3());
  targetWorldPosition.y += worldDeltaY;
  if (object.parent) {
    object.parent.worldToLocal(targetWorldPosition);
  }
  object.position.copy(targetWorldPosition);
  object.updateWorldMatrix(true, true);

  console.info(
    `[Ground] ${object.name || 'object'} bottom aligned to Y=${groundY.toFixed(3)}.`,
  );
  return worldDeltaY;
};

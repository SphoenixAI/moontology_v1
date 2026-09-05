export interface Go2MotionTarget {
  moveForward(distanceMeters: number): void;
  rotateYaw(angleRadians: number): void;
}

/**
 * Movement-source boundary for the authoritative AgentRoot.
 *
 * Manual input implements this now. A future DimOS/navigation adapter can
 * implement the same contract without changing Go2Agent or the scene.
 */
export interface Go2Controller {
  update(deltaSeconds: number, target: Go2MotionTarget): void;
  dispose(): void;
}

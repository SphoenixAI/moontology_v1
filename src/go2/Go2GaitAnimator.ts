import { Group, MathUtils } from 'three';
import type { Go2LegJoint } from './go2Joints';

export const Go2JointMotionModes = {
  PROCEDURAL_GAIT: 'PROCEDURAL_GAIT',
  TELEMETRY: 'TELEMETRY',
} as const;

export type Go2JointMotionMode =
  (typeof Go2JointMotionModes)[keyof typeof Go2JointMotionModes];

export interface Go2GaitInput {
  forwardVelocity: number;
  angularVelocity: number;
  deltaSeconds: number;
}

export interface Go2GaitDebugState {
  movementSpeed: number;
  forwardVelocity: number;
  angularVelocity: number;
  phase: number;
  frequency: number;
  mode: Go2JointMotionMode;
  moving: boolean;
}

interface JointState {
  entry: Go2LegJoint;
  restAngle: number;
  offset: number;
}

const TWO_PI = Math.PI * 2;

/**
 * Lightweight visual-only gait. It never changes AgentRoot and never reads or
 * writes joint axes; all articulation goes through each URDF joint's value API.
 */
export class Go2GaitAnimator {
  private readonly joints: readonly JointState[];
  private readonly bodyMotionRoot: Group;
  private phase = 0;
  private bodyBob = 0;
  private bodyPitch = 0;
  private mode: Go2JointMotionMode =
    Go2JointMotionModes.PROCEDURAL_GAIT;
  private state: Go2GaitDebugState = {
    movementSpeed: 0,
    forwardVelocity: 0,
    angularVelocity: 0,
    phase: 0,
    frequency: 0,
    mode: Go2JointMotionModes.PROCEDURAL_GAIT,
    moving: false,
  };

  constructor(joints: readonly Go2LegJoint[], bodyMotionRoot: Group) {
    this.joints = joints.map((entry) => ({
      entry,
      restAngle: entry.joint.angle,
      offset: 0,
    }));
    this.bodyMotionRoot = bodyMotionRoot;
  }

  get debugState(): Readonly<Go2GaitDebugState> {
    return this.state;
  }

  get motionMode(): Go2JointMotionMode {
    return this.mode;
  }

  setMotionMode(mode: Go2JointMotionMode): void {
    if (this.mode === mode) {
      return;
    }

    this.restoreRestPose();
    this.mode = mode;
    this.state = {
      ...this.state,
      mode,
      frequency: 0,
      moving: false,
    };
  }

  update({
    forwardVelocity,
    angularVelocity,
    deltaSeconds,
  }: Go2GaitInput): void {
    const linearSpeed = Math.abs(forwardVelocity);
    const turningSpeedEquivalent = Math.abs(angularVelocity) * 0.18;
    const gaitDriveSpeed = Math.hypot(
      linearSpeed,
      turningSpeedEquivalent,
    );
    const moving = linearSpeed > 0.025 || Math.abs(angularVelocity) > 0.05;

    if (this.mode === Go2JointMotionModes.TELEMETRY) {
      this.state = {
        movementSpeed: linearSpeed,
        forwardVelocity,
        angularVelocity,
        phase: this.phase,
        frequency: 0,
        mode: this.mode,
        moving,
      };
      return;
    }

    const frequency = moving
      ? MathUtils.clamp(0.9 + gaitDriveSpeed * 1.45, 0.9, 2.5)
      : 0;
    if (moving) {
      this.phase =
        (this.phase + TWO_PI * frequency * deltaSeconds) % TWO_PI;
    }

    const turnOnly = linearSpeed < 0.04 && Math.abs(angularVelocity) > 0.05;
    const travelDirection = forwardVelocity < 0 ? -1 : 1;
    const turnDirection = angularVelocity < 0 ? -1 : 1;
    const speedRatio = MathUtils.clamp(gaitDriveSpeed / 0.8, 0, 1);
    const amplitude = moving
      ? (0.62 + speedRatio * 0.38) * (turnOnly ? 0.52 : 1)
      : 0;
    const smoothingRate = moving ? 12 : 7;
    const blend = 1 - Math.exp(-smoothingRate * deltaSeconds);

    for (const state of this.joints) {
      const { entry } = state;
      const pairOffset =
        entry.leg === 'front-left' || entry.leg === 'rear-right'
          ? 0
          : Math.PI;
      const sideDirection =
        entry.leg === 'front-left' || entry.leg === 'rear-left'
          ? 1
          : -1;
      const legPhase = turnOnly
        ? this.phase * turnDirection * sideDirection + pairOffset
        : this.phase * travelDirection + pairOffset;
      const wave = Math.sin(legPhase);
      const swing = Math.max(0, wave);
      const stance = Math.max(0, -wave);

      const targetOffset =
        entry.role === 'thigh'
          ? wave * 0.24 * amplitude
          : entry.role === 'calf'
            ? (-swing * 0.3 + stance * 0.065) * amplitude
            : Math.cos(legPhase) *
              sideDirection *
              0.025 *
              amplitude;

      state.offset = MathUtils.lerp(
        state.offset,
        targetOffset,
        blend,
      );
      const angle = MathUtils.clamp(
        state.restAngle + state.offset,
        entry.joint.limit.lower,
        entry.joint.limit.upper,
      );
      entry.joint.setJointValue(angle);
    }

    const bodyDirection = turnOnly ? turnDirection : travelDirection;
    const targetBob = moving
      ? (0.003 + Math.abs(Math.sin(this.phase * 2)) * 0.004) *
        amplitude
      : 0;
    const targetPitch = moving
      ? Math.sin(this.phase * 2) * bodyDirection * 0.009 * amplitude
      : 0;
    this.bodyBob = MathUtils.lerp(this.bodyBob, targetBob, blend);
    this.bodyPitch = MathUtils.lerp(
      this.bodyPitch,
      targetPitch,
      blend,
    );
    this.bodyMotionRoot.position.y = this.bodyBob;
    this.bodyMotionRoot.rotation.z = this.bodyPitch;

    this.state = {
      movementSpeed: linearSpeed,
      forwardVelocity,
      angularVelocity,
      phase: this.phase,
      frequency,
      mode: this.mode,
      moving,
    };
  }

  restoreRestPose(): void {
    for (const state of this.joints) {
      state.offset = 0;
      state.entry.joint.setJointValue(state.restAngle);
    }
    this.bodyBob = 0;
    this.bodyPitch = 0;
    this.bodyMotionRoot.position.y = 0;
    this.bodyMotionRoot.rotation.z = 0;
  }
}

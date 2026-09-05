import { Group, MathUtils } from 'three';
import type { Go2LegJoint, LegKey } from './go2Joints';

export const Go2JointMotionModes = {
  PROCEDURAL_GAIT: 'PROCEDURAL_GAIT',
  TELEMETRY: 'TELEMETRY',
} as const;

export type Go2JointMotionMode =
  (typeof Go2JointMotionModes)[keyof typeof Go2JointMotionModes];

export interface Go2GaitInput {
  /** Body-frame forward velocity of the rendered rig (scene units / s). */
  forwardVelocity: number;
  /** Yaw rate of the rendered rig (rad / s, positive = left turn). */
  angularVelocity: number;
  deltaSeconds: number;
  /** Wall-clock milliseconds, used to age joint telemetry. */
  nowMs?: number;
}

export interface Go2GaitDebugState {
  movementSpeed: number;
  forwardVelocity: number;
  angularVelocity: number;
  phase: number;
  frequency: number;
  mode: Go2JointMotionMode;
  moving: boolean;
  /** Active source of the 12 joint angles this frame. */
  jointSource: 'procedural' | 'telemetry' | 'rest';
  strideMeters: number;
  telemetryJointAgeMs: number | null;
}

interface JointState {
  entry: Go2LegJoint;
  restAngle: number;
  angle: number;
}

interface LegGeometry {
  key: LegKey;
  /** Hip joint origin in the URDF body frame (x forward, y left), metres. */
  hipX: number;
  hipY: number;
  /** Diagonal pair phase offset: FL+RR lead, FR+RL trail by pi. */
  pairOffset: number;
}

const TWO_PI = Math.PI * 2;

/**
 * Official go2_description geometry (public/models/go2/go2_description/urdf):
 * hip joints at (+-0.1934, +-0.0465), thigh joint 0.0955 further outboard,
 * thigh and calf links both 0.213 m along -z.
 */
export const GO2_LEG_LINK_METERS = 0.213;
export const GO2_LEGS: readonly LegGeometry[] = [
  { key: 'front-left', hipX: 0.1934, hipY: 0.0465 + 0.0955, pairOffset: 0 },
  { key: 'rear-right', hipX: -0.1934, hipY: -(0.0465 + 0.0955), pairOffset: 0 },
  { key: 'front-right', hipX: 0.1934, hipY: -(0.0465 + 0.0955), pairOffset: Math.PI },
  { key: 'rear-left', hipX: -0.1934, hipY: 0.0465 + 0.0955, pairOffset: Math.PI },
];

/**
 * Unitree LowState motor order for the Go2 (unitree_sdk2 go2 constants):
 * FR 0-2, FL 3-5, RR 6-8, RL 9-11; hip, thigh, calf within each leg.
 */
export const UNITREE_MOTOR_ORDER: ReadonlyArray<{ leg: LegKey; role: Go2LegJoint['role'] }> = [
  { leg: 'front-right', role: 'hip' }, { leg: 'front-right', role: 'thigh' }, { leg: 'front-right', role: 'calf' },
  { leg: 'front-left', role: 'hip' }, { leg: 'front-left', role: 'thigh' }, { leg: 'front-left', role: 'calf' },
  { leg: 'rear-right', role: 'hip' }, { leg: 'rear-right', role: 'thigh' }, { leg: 'rear-right', role: 'calf' },
  { leg: 'rear-left', role: 'hip' }, { leg: 'rear-left', role: 'thigh' }, { leg: 'rear-left', role: 'calf' },
];

/** Joint telemetry older than this falls back to the procedural gait. */
export const TELEMETRY_JOINT_FRESH_MS = 350;
/** Longest realistic Go2 step (metres) before the feet visibly slide. */
const MAX_STRIDE_METERS = 0.14;
const MIN_TROT_HZ = 1.4;
const MAX_TROT_HZ = 3.0;

/**
 * Forward kinematics of one sagittal leg: thigh angle t1 and calf angle t2
 * (URDF convention, both about +y) give the foot offset from the thigh joint.
 */
export const legForwardKinematics = (t1: number, t2: number, link = GO2_LEG_LINK_METERS) => ({
  x: -link * Math.sin(t1) - link * Math.sin(t1 + t2),
  z: -link * Math.cos(t1) - link * Math.cos(t1 + t2),
});

/**
 * Two-link planar inverse kinematics with the knee bending backward (calf angle
 * negative, as the go2_description calf limits require). Reproduces the neutral
 * stand (thigh 0.80, calf -1.55 -> foot 0.304 m below the thigh joint).
 */
export const legInverseKinematics = (x: number, z: number, link = GO2_LEG_LINK_METERS) => {
  const reach = MathUtils.clamp(Math.hypot(x, z), 0.08, 2 * link - 0.004);
  const knee = Math.acos(MathUtils.clamp(1 - (reach * reach) / (2 * link * link), -1, 1));
  const thigh = Math.atan2(-x, -z) + (Math.PI - knee) / 2;
  const calf = -(Math.PI - knee);
  return { thigh, calf };
};

/**
 * Visual-only articulation of the 12 URDF leg joints. It never changes
 * AgentRoot; all motion goes through each URDF joint's value API.
 *
 * Two sources feed the joints:
 * - measured joint angles from the robot's LowState when they are fresh;
 * - otherwise a trot synthesised from the rig's own velocity: diagonal leg
 *   pairs alternate, each stance foot travels opposite to the body motion
 *   (including the yaw component, so in-place turns step left/right legs in
 *   opposite directions) and each swing foot returns along a lifted arc.
 */
export class Go2GaitAnimator {
  private readonly joints: readonly JointState[];
  private readonly bodyMotionRoot: Group;
  private readonly restFoot: { x: number; z: number };
  private phase = 0;
  private bodyBob = 0;
  private bodyPitch = 0;
  private smoothedForward = 0;
  private smoothedAngular = 0;
  private mode: Go2JointMotionMode = Go2JointMotionModes.PROCEDURAL_GAIT;
  private telemetryAngles: Float64Array | null = null;
  private telemetryReceivedMs = -Infinity;
  private state: Go2GaitDebugState = {
    movementSpeed: 0,
    forwardVelocity: 0,
    angularVelocity: 0,
    phase: 0,
    frequency: 0,
    mode: Go2JointMotionModes.PROCEDURAL_GAIT,
    moving: false,
    jointSource: 'rest',
    strideMeters: 0,
    telemetryJointAgeMs: null,
  };

  constructor(joints: readonly Go2LegJoint[], bodyMotionRoot: Group) {
    this.joints = joints.map((entry) => ({
      entry,
      restAngle: entry.joint.angle,
      angle: entry.joint.angle,
    }));
    this.bodyMotionRoot = bodyMotionRoot;
    const thigh = this.joints.find((j) => j.entry.leg === 'front-left' && j.entry.role === 'thigh');
    const calf = this.joints.find((j) => j.entry.leg === 'front-left' && j.entry.role === 'calf');
    this.restFoot = legForwardKinematics(thigh?.restAngle ?? 0.8, calf?.restAngle ?? -1.55);
  }

  get debugState(): Readonly<Go2GaitDebugState> {
    return this.state;
  }

  get motionMode(): Go2JointMotionMode {
    return this.mode;
  }

  /**
   * TELEMETRY prefers measured joints and only synthesises when they are stale;
   * PROCEDURAL_GAIT ignores measured joints entirely.
   */
  setMotionMode(mode: Go2JointMotionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.state = { ...this.state, mode };
  }

  /**
   * Accept the robot's 12 measured joint angles (radians, Unitree LowState
   * motor order). Non-finite or wrongly sized payloads are ignored.
   */
  setTelemetryJoints(angles: ArrayLike<number>, receivedMs: number): boolean {
    if (angles.length !== UNITREE_MOTOR_ORDER.length) return false;
    const copy = new Float64Array(angles.length);
    for (let i = 0; i < angles.length; i++) {
      const value = Number(angles[i]);
      if (!Number.isFinite(value)) return false;
      copy[i] = value;
    }
    this.telemetryAngles = copy;
    this.telemetryReceivedMs = receivedMs;
    this.setMotionMode(Go2JointMotionModes.TELEMETRY);
    return true;
  }

  update({ forwardVelocity, angularVelocity, deltaSeconds, nowMs = performance.now() }: Go2GaitInput): void {
    const dt = MathUtils.clamp(deltaSeconds, 0, 0.1);
    // Low-pass the drive so a single late frame cannot flicker the gait.
    const velocityBlend = 1 - Math.exp(-dt / 0.08);
    this.smoothedForward = MathUtils.lerp(this.smoothedForward, forwardVelocity, velocityBlend);
    this.smoothedAngular = MathUtils.lerp(this.smoothedAngular, angularVelocity, velocityBlend);
    const v = Math.abs(this.smoothedForward) < 0.005 ? 0 : this.smoothedForward;
    const w = Math.abs(this.smoothedAngular) < 0.01 ? 0 : this.smoothedAngular;
    const linearSpeed = Math.abs(v);
    const moving = linearSpeed > 0.02 || Math.abs(w) > 0.04;

    const telemetryAge = this.telemetryAngles ? nowMs - this.telemetryReceivedMs : null;
    const useTelemetry = this.mode === Go2JointMotionModes.TELEMETRY && this.telemetryAngles !== null &&
      telemetryAge !== null && telemetryAge >= 0 && telemetryAge <= TELEMETRY_JOINT_FRESH_MS;

    let frequency = 0;
    let stride = 0;
    let jointSource: Go2GaitDebugState['jointSource'] = 'rest';
    const targets = new Map<JointState, number>();

    if (useTelemetry) {
      jointSource = 'telemetry';
      UNITREE_MOTOR_ORDER.forEach((slot, index) => {
        const joint = this.joints.find((j) => j.entry.leg === slot.leg && j.entry.role === slot.role);
        if (joint) targets.set(joint, this.telemetryAngles![index]);
      });
    } else if (moving) {
      jointSource = 'procedural';
      // Cadence rises with body-relative speed; a Go2 trots at roughly 1.5-3 Hz.
      frequency = MathUtils.clamp(MIN_TROT_HZ + linearSpeed * 1.6 + Math.abs(w) * 0.5, MIN_TROT_HZ, MAX_TROT_HZ);
      this.phase = (this.phase + TWO_PI * frequency * dt) % TWO_PI;
      const stanceSeconds = 0.5 / frequency;
      const speedRatio = MathUtils.clamp(Math.hypot(linearSpeed, Math.abs(w) * 0.18) / 0.8, 0, 1);
      const lift = 0.045 + 0.035 * speedRatio;

      for (const leg of GO2_LEGS) {
        // Ground velocity seen from the body at this hip: -(v + w x r_hip).
        let strideX = (w * leg.hipY - v) * stanceSeconds;
        let strideY = -w * leg.hipX * stanceSeconds;
        const magnitude = Math.hypot(strideX, strideY);
        if (magnitude > MAX_STRIDE_METERS) {
          strideX *= MAX_STRIDE_METERS / magnitude;
          strideY *= MAX_STRIDE_METERS / magnitude;
        }
        stride = Math.max(stride, Math.hypot(strideX, strideY));
        const legPhase = (this.phase + leg.pairOffset) % TWO_PI;
        let progress: number; // -0.5 .. +0.5 along the stride vector
        let footLift = 0;
        if (legPhase < Math.PI) {
          // Swing: return from the end of stance to its start on a lifted arc.
          const s = legPhase / Math.PI;
          progress = 0.5 - (1 - Math.cos(s * Math.PI)) / 2;
          footLift = lift * Math.sin(s * Math.PI);
        } else {
          // Stance: move with the ground, from stride start to stride end.
          const s = (legPhase - Math.PI) / Math.PI;
          progress = -0.5 + s;
        }
        const footX = this.restFoot.x + strideX * progress;
        const footY = strideY * progress;
        const footZ = this.restFoot.z + footLift;
        const { thigh, calf } = legInverseKinematics(footX, footZ);
        const hip = Math.asin(MathUtils.clamp(footY / Math.max(0.15, -footZ), -0.5, 0.5));
        for (const joint of this.joints) {
          if (joint.entry.leg !== leg.key) continue;
          targets.set(joint, joint.entry.role === 'hip' ? hip : joint.entry.role === 'thigh' ? thigh : calf);
        }
      }
    }

    // Slew each joint toward its target so source changes and sample gaps stay
    // continuous; measured joints track fast, synthesised joints a little softer.
    const jointRate = jointSource === 'telemetry' ? 28 : jointSource === 'procedural' ? 18 : 8;
    const jointBlend = 1 - Math.exp(-jointRate * dt);
    for (const joint of this.joints) {
      const target = targets.get(joint) ?? joint.restAngle;
      joint.angle = MathUtils.lerp(joint.angle, target, jointBlend);
      const clamped = MathUtils.clamp(joint.angle, joint.entry.joint.limit.lower, joint.entry.joint.limit.upper);
      joint.entry.joint.setJointValue(clamped);
    }

    // Small body bob/pitch keyed to the diagonal-pair cadence (visual only).
    const proceduralMoving = jointSource === 'procedural';
    const targetBob = proceduralMoving ? 0.003 + Math.abs(Math.sin(this.phase * 2)) * 0.004 : 0;
    const targetPitch = proceduralMoving ? Math.sin(this.phase * 2) * Math.sign(v || 1) * 0.008 : 0;
    const bodyBlend = 1 - Math.exp(-10 * dt);
    this.bodyBob = MathUtils.lerp(this.bodyBob, targetBob, bodyBlend);
    this.bodyPitch = MathUtils.lerp(this.bodyPitch, targetPitch, bodyBlend);
    this.bodyMotionRoot.position.y = this.bodyBob;
    this.bodyMotionRoot.rotation.z = this.bodyPitch;

    this.state = {
      movementSpeed: linearSpeed,
      forwardVelocity: v,
      angularVelocity: w,
      phase: this.phase,
      frequency,
      mode: this.mode,
      moving,
      jointSource,
      strideMeters: stride,
      telemetryJointAgeMs: telemetryAge === null || !Number.isFinite(telemetryAge) ? null : telemetryAge,
    };
  }

  restoreRestPose(): void {
    for (const joint of this.joints) {
      joint.angle = joint.restAngle;
      joint.entry.joint.setJointValue(joint.restAngle);
    }
    this.smoothedForward = 0;
    this.smoothedAngular = 0;
    this.bodyBob = 0;
    this.bodyPitch = 0;
    this.bodyMotionRoot.position.y = 0;
    this.bodyMotionRoot.rotation.z = 0;
  }
}

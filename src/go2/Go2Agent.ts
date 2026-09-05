import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { URDFRobot } from 'urdf-loader';
import type { Go2AgentConfig } from '../levels/types';
import type { Go2MotionTarget } from './Go2Controller';
import {
  Go2GaitAnimator,
  type Go2GaitDebugState,
  type Go2JointMotionMode,
} from './Go2GaitAnimator';
import {
  getNeutralJointAngle,
  identifyGo2LegJoints,
  logGo2LegJoints,
  type Go2LegJoint,
} from './go2Joints';
import { loadOfficialGo2 } from './loadOfficialGo2';

const UP = new Vector3(0, 1, 0);
/**
 * The rendered rig follows AgentRoot through a critically damped spring instead
 * of snapping. Physical telemetry arrives in discrete samples (about 10 Hz);
 * without this the avatar juts forward once per sample and the gait sees a
 * velocity spike followed by zeros, which reads as sliding legs. A second-order
 * follower keeps the rig's velocity continuous (a first-order lerp still jumps
 * its velocity at every sample). Steady-state lag behind a pose moving at v is
 * 2v/VISUAL_FOLLOW_OMEGA; the rig never runs ahead of a measured pose, and
 * observations/collision keep using AgentRoot.
 */
export const VISUAL_FOLLOW_OMEGA = 12; // rad/s, ~1.9 Hz, for sampled telemetry gaps
const VISUAL_FOLLOW_OMEGA_CONTINUOUS = 28; // per-frame (keyboard/rehearsal) motion: tight follow
const VISUAL_SUBSTEP_SECONDS = 1 / 120;
/**
 * Sampled telemetry is rendered one sample interval behind and linearly
 * interpolated between the two bracketing samples (render-behind, as network
 * games do): constant velocity between updates, no extrapolation past the
 * newest measured pose. Falls back to the spring when samples stop.
 */
export const TELEMETRY_INTERPOLATION_MIN_DELAY_MS = 60;
export const TELEMETRY_INTERPOLATION_MAX_AGE_MS = 450;
const TELEMETRY_SAMPLE_HISTORY = 6;
interface PoseSample { t: number; x: number; y: number; z: number; yaw: number }
/** Larger jumps are teleports (spawn, reset, scene load): snap instead of glide. */
export const VISUAL_SNAP_DISTANCE = 2.5;
export const VISUAL_SNAP_YAW = 1.2;
const GO2_TARGET_LENGTH_METERS = 0.7;
const GO2_TARGET_WIDTH_METERS = 0.31;
const GO2_TARGET_HEIGHT_METERS = 0.4;

/**
 * Map-facing Go2 entity.
 *
 * AgentRoot is authoritative for game-world position and yaw. VisualRig is a
 * sibling that mirrors AgentRoot and contains the articulated URDF only.
 */
export class Go2Agent implements Go2MotionTarget {
  readonly object = new Group();
  readonly agentRoot = new Group();
  readonly visualRig = new Group();
  readonly collisionProxy: Mesh;
  readonly robot: URDFRobot;
  readonly legJoints: readonly Go2LegJoint[];
  readonly visualMeshCount: number;
  readonly gaitAnimator: Go2GaitAnimator;

  private readonly bodyMotionRoot = new Group();
  private readonly visualCoordinateRoot = new Group();
  private readonly forward = new Vector3();
  private readonly previousPosition = new Vector3();
  private readonly frameDisplacement = new Vector3();
  private readonly visualContactBounds = new Box3();
  /** Smoothed presentation pose (world frame of AgentRoot's parent). */
  private readonly visualPosition = new Vector3();
  private readonly visualVelocity = new Vector3();
  private visualYaw: number;
  private visualYawRate = 0;
  private readonly poseSamples: PoseSample[] = [];
  private visualSource: 'interpolated' | 'spring' | 'snap' = 'snap';
  private visualYOffset = 0;
  private motionResolver: ((from: Vector3, requested: Vector3) => Vector3) | null = null;
  private previousYaw: number;

  private constructor(
    config: Go2AgentConfig,
    robot: URDFRobot,
    visualMeshCount: number,
  ) {
    this.robot = robot;
    this.visualMeshCount = visualMeshCount;
    this.legJoints = identifyGo2LegJoints(robot);

    this.object.name = config.id;
    this.object.visible = config.visible ?? true;
    this.object.userData.go2AgentId = config.id;

    this.agentRoot.name = 'AgentRoot';
    this.agentRoot.userData.authoritativeGameTransform = true;
    this.agentRoot.position.fromArray(config.position);
    this.agentRoot.rotation.y = config.yaw;
    this.visualPosition.copy(this.agentRoot.position);
    this.visualYaw = config.yaw;

    this.visualRig.name = 'VisualRig';
    this.visualRig.userData.visualOnly = true;

    this.collisionProxy = new Mesh(
      new BoxGeometry(0.72, 0.42, 0.34),
      new MeshBasicMaterial({
        color: 0x36e4bf,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
      }),
    );
    this.collisionProxy.name = 'Go2AgentCollisionProxy';
    this.collisionProxy.position.y = 0.21;
    this.collisionProxy.visible = false;
    this.collisionProxy.userData.collisionProxy = true;
    this.agentRoot.add(this.collisionProxy);

    this.bodyMotionRoot.name = 'VisualGaitBodyMotion';
    this.visualCoordinateRoot.name = 'urdf-z-up-to-three-y-up';
    this.visualCoordinateRoot.rotation.x = -Math.PI / 2;
    this.visualCoordinateRoot.add(robot);
    this.bodyMotionRoot.add(this.visualCoordinateRoot);
    this.visualRig.add(this.bodyMotionRoot);

    for (const entry of this.legJoints) {
      entry.joint.setJointValue(getNeutralJointAngle(entry));
    }
    this.placeVisualFeetAtAgentFloor();
    this.gaitAnimator = new Go2GaitAnimator(
      this.legJoints,
      this.bodyMotionRoot,
    );

    this.object.add(this.agentRoot, this.visualRig);
    this.syncVisualFromAgentRoot();
    this.calibrateVisualRigToRealDimensions();
    this.previousPosition.copy(this.visualPosition);
    this.previousYaw = this.visualYaw;

    logGo2LegJoints(this.legJoints);
  }

  static async create(
    config: Go2AgentConfig,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Go2Agent> {
    const { robot, visualMeshCount } = await loadOfficialGo2(onProgress);
    return new Go2Agent(config, robot, visualMeshCount);
  }

  setMotionResolver(resolver: ((from: Vector3, requested: Vector3) => Vector3) | null): void {
    this.motionResolver = resolver;
  }

  moveForward(distanceMeters: number): void {
    this.forward
      .set(1, 0, 0)
      .applyAxisAngle(UP, this.agentRoot.rotation.y);
    const requested = this.agentRoot.position.clone().addScaledVector(this.forward, distanceMeters);
    this.agentRoot.position.copy(this.motionResolver
      ? this.motionResolver(this.agentRoot.position, requested) : requested);
  }

  rotateYaw(angleRadians: number): void {
    this.agentRoot.rotation.y += angleRadians;
  }

  /**
   * Record that AgentRoot was just set from a sampled telemetry pose. Call right
   * after the authoritative pose changes; enables render-behind interpolation.
   */
  recordAuthoritativePose(nowMs = performance.now()): void {
    const last = this.poseSamples[this.poseSamples.length - 1];
    if (last && nowMs - last.t < 1) return;
    this.poseSamples.push({ t: nowMs, x: this.agentRoot.position.x, y: this.agentRoot.position.y,
      z: this.agentRoot.position.z, yaw: this.agentRoot.rotation.y });
    if (this.poseSamples.length > TELEMETRY_SAMPLE_HISTORY) this.poseSamples.shift();
  }

  /** How the rig is currently being positioned (diagnostics). */
  get visualFollowSource(): 'interpolated' | 'spring' | 'snap' {
    return this.visualSource;
  }

  private interpolateTelemetry(nowMs: number): boolean {
    const samples = this.poseSamples;
    if (samples.length < 2) return false;
    const newest = samples[samples.length - 1];
    if (nowMs - newest.t > TELEMETRY_INTERPOLATION_MAX_AGE_MS) return false;
    // Render one typical interval behind the newest sample.
    let interval = 0;
    for (let i = 1; i < samples.length; i++) interval += samples[i].t - samples[i - 1].t;
    interval /= samples.length - 1;
    const renderTime = nowMs - Math.max(TELEMETRY_INTERPOLATION_MIN_DELAY_MS, interval * 1.1);
    let a = samples[0], b = samples[1];
    for (let i = 1; i < samples.length; i++) {
      a = samples[i - 1]; b = samples[i];
      if (renderTime <= b.t) break;
    }
    const span = b.t - a.t;
    const u = renderTime >= b.t ? 1 : renderTime <= a.t ? 0 : (renderTime - a.t) / span;
    const previousX = this.visualPosition.x, previousZ = this.visualPosition.z;
    this.visualPosition.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
    const yawDelta = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    this.visualYaw = a.yaw + yawDelta * u;
    // Keep the spring's state consistent for a seamless hand-back later.
    const step = Math.hypot(this.visualPosition.x - previousX, this.visualPosition.z - previousZ);
    if (span > 0) this.visualVelocity.set((b.x - a.x) / (span / 1000), 0, (b.z - a.z) / (span / 1000));
    if (step === 0 && u >= 1) this.visualVelocity.set(0, 0, 0);
    this.visualYawRate = span > 0 ? yawDelta / (span / 1000) : 0;
    return true;
  }

  updateVisualFromAgentRoot(deltaSeconds: number, nowMs = performance.now()): void {
    // Glide the presentation pose toward the authoritative pose.
    const gap = this.agentRoot.position.distanceTo(this.visualPosition);
    const yawGap = Math.atan2(
      Math.sin(this.agentRoot.rotation.y - this.visualYaw),
      Math.cos(this.agentRoot.rotation.y - this.visualYaw),
    );
    if (gap > VISUAL_SNAP_DISTANCE || Math.abs(yawGap) > VISUAL_SNAP_YAW || deltaSeconds <= 0) {
      this.visualPosition.copy(this.agentRoot.position);
      this.visualVelocity.set(0, 0, 0);
      this.visualYaw = this.agentRoot.rotation.y;
      this.visualYawRate = 0;
      this.poseSamples.length = 0;
      this.visualSource = 'snap';
    } else if (this.interpolateTelemetry(nowMs)) {
      this.visualSource = 'interpolated';
    } else {
      this.visualSource = 'spring';
      // Critically damped spring, semi-implicit Euler in fixed substeps so long
      // frames stay stable: a'' = w^2 (target - x) - 2 w x'.
      let remaining = Math.min(deltaSeconds, 0.25);
      const recentSample = this.poseSamples.length > 0 &&
        nowMs - this.poseSamples[this.poseSamples.length - 1].t < 2 * TELEMETRY_INTERPOLATION_MAX_AGE_MS;
      const w = recentSample ? VISUAL_FOLLOW_OMEGA : VISUAL_FOLLOW_OMEGA_CONTINUOUS;
      while (remaining > 0) {
        const h = Math.min(VISUAL_SUBSTEP_SECONDS, remaining);
        remaining -= h;
        const ax = w * w * (this.agentRoot.position.x - this.visualPosition.x) - 2 * w * this.visualVelocity.x;
        const ay = w * w * (this.agentRoot.position.y - this.visualPosition.y) - 2 * w * this.visualVelocity.y;
        const az = w * w * (this.agentRoot.position.z - this.visualPosition.z) - 2 * w * this.visualVelocity.z;
        this.visualVelocity.x += ax * h; this.visualVelocity.y += ay * h; this.visualVelocity.z += az * h;
        this.visualPosition.addScaledVector(this.visualVelocity, h);
        const yawError = Math.atan2(Math.sin(this.agentRoot.rotation.y - this.visualYaw), Math.cos(this.agentRoot.rotation.y - this.visualYaw));
        this.visualYawRate += (w * w * yawError - 2 * w * this.visualYawRate) * h;
        this.visualYaw += this.visualYawRate * h;
      }
      // Settle exactly instead of asymptotically.
      if (this.agentRoot.position.distanceTo(this.visualPosition) < 1e-4 && this.visualVelocity.lengthSq() < 1e-6) {
        this.visualPosition.copy(this.agentRoot.position); this.visualVelocity.set(0, 0, 0);
      }
    }

    // Gait drive = motion of the rendered rig itself, so it is continuous.
    this.frameDisplacement
      .copy(this.visualPosition)
      .sub(this.previousPosition);
    this.forward
      .set(1, 0, 0)
      .applyAxisAngle(UP, this.visualYaw);

    const forwardVelocity =
      deltaSeconds > 0
        ? this.frameDisplacement.dot(this.forward) / deltaSeconds
        : 0;
    const yawDelta = Math.atan2(
      Math.sin(this.visualYaw - this.previousYaw),
      Math.cos(this.visualYaw - this.previousYaw),
    );
    const angularVelocity =
      deltaSeconds > 0 ? yawDelta / deltaSeconds : 0;

    this.syncVisualFromAgentRoot();
    this.gaitAnimator.update({
      forwardVelocity,
      angularVelocity,
      deltaSeconds,
    });
    // Gait can extend a toe below the neutral calibration. Lift only the
    // visual wrapper; AgentRoot remains the navigation/telemetry authority.
    this.object.updateWorldMatrix(true, true);
    this.visualContactBounds.setFromObject(this.visualRig);
    const floorY = this.agentRoot.getWorldPosition(this.forward).y;
    const penetration = floorY - this.visualContactBounds.min.y;
    const parentScaleY = this.object.getWorldScale(this.forward).y;
    if (penetration > 0 && parentScaleY > 0) this.visualRig.position.y += penetration / parentScaleY;

    this.previousPosition.copy(this.visualPosition);
    this.previousYaw = this.visualYaw;
  }

  get gaitState(): Readonly<Go2GaitDebugState> {
    return this.gaitAnimator.debugState;
  }

  setJointMotionMode(mode: Go2JointMotionMode): void {
    this.gaitAnimator.setMotionMode(mode);
  }

  /**
   * Measured joint angles from the robot's LowState (12 radians, Unitree motor
   * order). Returns false and keeps the procedural gait if the payload is invalid.
   */
  setTelemetryJoints(angles: ArrayLike<number>, receivedMs = performance.now()): boolean {
    return this.gaitAnimator.setTelemetryJoints(angles, receivedMs);
  }

  /** Metres the rendered rig currently trails the authoritative pose. */
  get visualLag(): number {
    return this.agentRoot.position.distanceTo(this.visualPosition);
  }

  syncVisualFromAgentRoot(): void {
    this.visualRig.position.copy(this.visualPosition);
    this.visualRig.position.y += this.visualYOffset;
    this.visualRig.rotation.set(0, this.visualYaw, 0);
  }

  /**
   * Keep gait integration from treating a scene teleport as one huge step.
   */
  acknowledgeAgentRootSnap(): void {
    this.visualPosition.copy(this.agentRoot.position);
    this.visualVelocity.set(0, 0, 0);
    this.visualYaw = this.agentRoot.rotation.y;
    this.visualYawRate = 0;
    this.poseSamples.length = 0;
    this.visualSource = 'snap';
    this.previousPosition.copy(this.visualPosition);
    this.previousYaw = this.visualYaw;
    this.gaitAnimator.restoreRestPose();
    this.syncVisualFromAgentRoot();
  }

  private calibrateVisualRigToRealDimensions(): void {
    this.visualRig.scale.setScalar(1);
    this.visualYOffset = 0;
    this.syncVisualFromAgentRoot();
    this.object.updateWorldMatrix(true, true);

    const getWorldAabbSize = (): Vector3 =>
      new Box3().setFromObject(this.visualRig).getSize(new Vector3());
    const getYawAlignedSize = (): Vector3 => {
      const currentYaw = this.visualRig.rotation.y;
      this.visualRig.rotation.y = 0;
      this.object.updateWorldMatrix(true, true);
      const size = getWorldAabbSize();
      this.visualRig.rotation.y = currentYaw;
      this.object.updateWorldMatrix(true, true);
      return size;
    };

    const originalWorldAabbSize = getWorldAabbSize();
    const originalSize = getYawAlignedSize();
    if (originalSize.x <= 0 || originalSize.y <= 0) {
      console.warn(
        '[go2] VisualRig scale calibration skipped: invalid bounds.',
        originalSize,
      );
      return;
    }

    const lengthScale =
      GO2_TARGET_LENGTH_METERS / originalSize.x;
    const heightScale =
      GO2_TARGET_HEIGHT_METERS / originalSize.y;
    const uniformScale = Math.sqrt(lengthScale * heightScale);
    this.visualRig.scale.setScalar(uniformScale);
    this.object.updateWorldMatrix(true, true);

    const scaledBounds = new Box3().setFromObject(this.visualRig);
    const agentGroundY = this.agentRoot.getWorldPosition(new Vector3()).y;
    const parentWorldScaleY = this.object.getWorldScale(new Vector3()).y;
    const worldYOffset = agentGroundY - scaledBounds.min.y;
    this.visualYOffset =
      parentWorldScaleY !== 0 ? worldYOffset / parentWorldScaleY : 0;
    this.syncVisualFromAgentRoot();
    this.object.updateWorldMatrix(true, true);

    const finalBounds = new Box3().setFromObject(this.visualRig);
    const finalWorldAabbSize = finalBounds.getSize(new Vector3());
    const finalSize = getYawAlignedSize();
    const dimensions = (size: Vector3) => ({
      length: Number(size.x.toFixed(4)),
      width: Number(size.z.toFixed(4)),
      height: Number(size.y.toFixed(4)),
    });
    const worldAabbDimensions = (size: Vector3) => ({
      x: Number(size.x.toFixed(4)),
      y: Number(size.y.toFixed(4)),
      z: Number(size.z.toFixed(4)),
    });

    console.info('[go2] VisualRig real-world scale calibration', {
      originalWorldSpaceAabbMeters: worldAabbDimensions(
        originalWorldAabbSize,
      ),
      originalBoundingBoxDimensionsMeters: dimensions(originalSize),
      targetDimensionsMeters: {
        length: GO2_TARGET_LENGTH_METERS,
        width: GO2_TARGET_WIDTH_METERS,
        height: GO2_TARGET_HEIGHT_METERS,
      },
      lengthScaleFactor: Number(lengthScale.toFixed(6)),
      heightScaleFactor: Number(heightScale.toFixed(6)),
      computedUniformScaleFactor: Number(uniformScale.toFixed(6)),
      finalWorldSpaceAabbMeters: worldAabbDimensions(finalWorldAabbSize),
      finalBoundingBoxDimensionsMeters: dimensions(finalSize),
      finalVisualYOffsetMeters: Number(this.visualYOffset.toFixed(6)),
    });
  }

  private placeVisualFeetAtAgentFloor(): void {
    this.visualCoordinateRoot.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(this.visualCoordinateRoot);
    this.visualCoordinateRoot.position.y -= bounds.min.y;
  }
}

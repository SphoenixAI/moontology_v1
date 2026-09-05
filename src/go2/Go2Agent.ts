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
  private visualYOffset = 0;
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
    this.previousPosition.copy(this.agentRoot.position);
    this.previousYaw = this.agentRoot.rotation.y;

    logGo2LegJoints(this.legJoints);
  }

  static async create(
    config: Go2AgentConfig,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Go2Agent> {
    const { robot, visualMeshCount } = await loadOfficialGo2(onProgress);
    return new Go2Agent(config, robot, visualMeshCount);
  }

  moveForward(distanceMeters: number): void {
    this.forward
      .set(1, 0, 0)
      .applyAxisAngle(UP, this.agentRoot.rotation.y);
    this.agentRoot.position.addScaledVector(
      this.forward,
      distanceMeters,
    );
  }

  rotateYaw(angleRadians: number): void {
    this.agentRoot.rotation.y += angleRadians;
  }

  updateVisualFromAgentRoot(deltaSeconds: number): void {
    this.frameDisplacement
      .copy(this.agentRoot.position)
      .sub(this.previousPosition);
    this.forward
      .set(1, 0, 0)
      .applyAxisAngle(UP, this.agentRoot.rotation.y);

    const forwardVelocity =
      deltaSeconds > 0
        ? this.frameDisplacement.dot(this.forward) / deltaSeconds
        : 0;
    const yawDelta = Math.atan2(
      Math.sin(this.agentRoot.rotation.y - this.previousYaw),
      Math.cos(this.agentRoot.rotation.y - this.previousYaw),
    );
    const angularVelocity =
      deltaSeconds > 0 ? yawDelta / deltaSeconds : 0;

    this.syncVisualFromAgentRoot();
    this.gaitAnimator.update({
      forwardVelocity,
      angularVelocity,
      deltaSeconds,
    });

    this.previousPosition.copy(this.agentRoot.position);
    this.previousYaw = this.agentRoot.rotation.y;
  }

  get gaitState(): Readonly<Go2GaitDebugState> {
    return this.gaitAnimator.debugState;
  }

  setJointMotionMode(mode: Go2JointMotionMode): void {
    this.gaitAnimator.setMotionMode(mode);
  }

  syncVisualFromAgentRoot(): void {
    this.visualRig.position.copy(this.agentRoot.position);
    this.visualRig.position.y += this.visualYOffset;
    this.visualRig.rotation.set(0, this.agentRoot.rotation.y, 0);
  }

  /**
   * Keep gait integration from treating a scene teleport as one huge step.
   */
  acknowledgeAgentRootSnap(): void {
    this.previousPosition.copy(this.agentRoot.position);
    this.previousYaw = this.agentRoot.rotation.y;
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

import {
  AxesHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Object3D,
  type Scene,
} from 'three';
import type { SceneRobotCalibration } from '../levels/sceneRobotCalibration';

export class Go2SceneRegistrationDebug {
  private readonly group = new Group();
  private readonly spawnMarker: Mesh;
  private readonly floorMarker: Mesh;
  private worldAxes: AxesHelper | null = null;
  private go2Axes: AxesHelper | null = null;
  private go2Root: Object3D | null = null;
  private enabled = false;

  constructor() {
    this.group.name = 'go2-registration-debug';
    this.spawnMarker = new Mesh(
      new SphereGeometry(0.08, 16, 16),
      new MeshBasicMaterial(),
    );
    this.spawnMarker.name = 'go2-spawn-marker';
    this.floorMarker = new Mesh(
      new SphereGeometry(0.06, 12, 12),
      new MeshBasicMaterial(),
    );
    this.floorMarker.name = 'go2-ground-marker';
    this.group.add(this.spawnMarker, this.floorMarker);
  }

  attach(
    scene: Scene,
    worldRoot: Object3D | null,
    go2Root: Object3D,
    calibration: SceneRobotCalibration,
  ): void {
    this.detach();
    this.go2Root = go2Root;
    this.spawnMarker.position.set(
      calibration.robotSpawnPosition.x,
      calibration.robotGroundY,
      calibration.robotSpawnPosition.z,
    );

    if (worldRoot) {
      this.worldAxes = new AxesHelper(2);
      this.worldAxes.name = 'scene-world-axes';
      worldRoot.add(this.worldAxes);
    }

    this.go2Axes = new AxesHelper(1);
    this.go2Axes.name = 'go2-root-axes';
    go2Root.add(this.go2Axes);
    this.floorMarker.position.set(
      calibration.robotSpawnPosition.x,
      calibration.robotGroundY,
      calibration.robotSpawnPosition.z,
    );

    scene.add(this.group);
    this.enabled = true;
    this.group.visible = true;
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.group.visible = visible;
    if (this.worldAxes) {
      this.worldAxes.visible = visible;
    }
    if (this.go2Axes) {
      this.go2Axes.visible = visible;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  snapshot(calibration: SceneRobotCalibration): {
    go2Position: { x: number; y: number; z: number };
    go2Yaw: number;
    robotGroundY: number;
    metersToWorldUnits: number;
    worldTransform: SceneRobotCalibration['worldPosition'] & {
      rotationY: number;
      scale: number;
    };
  } {
    const position = this.go2Root?.position;
    return {
      go2Position: {
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        z: position?.z ?? 0,
      },
      go2Yaw: this.go2Root?.rotation.y ?? 0,
      robotGroundY: calibration.robotGroundY,
      metersToWorldUnits: calibration.metersToWorldUnits,
      worldTransform: {
        ...calibration.worldPosition,
        rotationY: calibration.worldRotationY,
        scale: calibration.worldScale,
      },
    };
  }

  detach(): void {
    this.worldAxes?.removeFromParent();
    this.go2Axes?.removeFromParent();
    this.worldAxes = null;
    this.go2Axes = null;
    this.go2Root = null;
    this.group.removeFromParent();
    this.enabled = false;
  }

  dispose(): void {
    this.detach();
    this.spawnMarker.geometry.dispose();
    this.floorMarker.geometry.dispose();
    if (this.spawnMarker.material instanceof MeshBasicMaterial) {
      this.spawnMarker.material.dispose();
    }
    if (this.floorMarker.material instanceof MeshBasicMaterial) {
      this.floorMarker.material.dispose();
    }
  }
}

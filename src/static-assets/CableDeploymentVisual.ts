import {
  CatmullRomCurve3,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type {
  CableDeploymentVisualConfig,
  CableTaskState,
} from '../levels/types';

const CABLE_COLORS: Record<CableTaskState, number> = {
  NOT_STARTED: 0x4b4e50,
  PARTIAL: 0xe2a340,
  CONNECTED: 0x7bcf9b,
};

export class CableDeploymentVisual {
  readonly object = new Group();

  private readonly roverRoot: Group;
  private readonly endpointRoot: Group;
  private readonly config: CableDeploymentVisualConfig;
  private readonly material = new MeshStandardMaterial({
    color: CABLE_COLORS.PARTIAL,
    roughness: 0.62,
    metalness: 0.18,
    emissive: 0x4f2a08,
    emissiveIntensity: 0.42,
  });
  private readonly endMarker = new Mesh(
    new SphereGeometry(0.07, 12, 8),
    new MeshStandardMaterial({
      color: CABLE_COLORS.PARTIAL,
      emissive: CABLE_COLORS.PARTIAL,
      emissiveIntensity: 0.75,
      roughness: 0.4,
    }),
  );
  private readonly start = new Vector3();
  private readonly destination = new Vector3();
  private readonly previousStart = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly previousDestination = new Vector3(
    Number.POSITIVE_INFINITY,
    0,
    0,
  );
  private tube: Mesh | null = null;
  private state: CableTaskState;
  private dirty = true;

  constructor(
    roverRoot: Group,
    endpointRoot: Group,
    config: CableDeploymentVisualConfig,
  ) {
    this.roverRoot = roverRoot;
    this.endpointRoot = endpointRoot;
    this.config = config;
    this.state = config.initialState;
    this.object.name = 'CableRun-17-visual';
    this.object.visible = config.enabled;
    this.object.userData.entityId = config.cableEntityId;
    this.object.userData.taskId = config.taskId;
    this.object.userData.taskState = this.state;
    this.endMarker.raycast = () => undefined;
    this.object.add(this.endMarker);
    this.applyStateMaterial();
  }

  get taskState(): CableTaskState {
    return this.state;
  }

  setTaskState(state: CableTaskState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.object.userData.taskState = state;
    this.dirty = true;
    this.applyStateMaterial();
  }

  update(): void {
    if (!this.config.enabled) {
      return;
    }

    this.roverRoot.updateWorldMatrix(true, true);
    this.endpointRoot.updateWorldMatrix(true, true);
    this.object.updateWorldMatrix(true, false);
    this.start
      .fromArray(this.config.outletPosition)
      .applyMatrix4(this.roverRoot.matrixWorld);
    this.endpointRoot.getWorldPosition(this.destination);
    this.object.worldToLocal(this.start);
    this.object.worldToLocal(this.destination);

    if (
      !this.dirty &&
      this.start.distanceToSquared(this.previousStart) < 0.0001 &&
      this.destination.distanceToSquared(this.previousDestination) < 0.0001
    ) {
      return;
    }

    this.previousStart.copy(this.start);
    this.previousDestination.copy(this.destination);
    this.dirty = false;
    this.rebuildGeometry();
  }

  dispose(): void {
    this.tube?.geometry.dispose();
    this.material.dispose();
    this.endMarker.geometry.dispose();
    (this.endMarker.material as MeshStandardMaterial).dispose();
    this.object.removeFromParent();
  }

  private rebuildGeometry(): void {
    this.tube?.geometry.dispose();
    this.tube?.removeFromParent();
    this.tube = null;

    if (this.state === 'NOT_STARTED') {
      this.endMarker.visible = false;
      return;
    }

    const ratio =
      this.state === 'PARTIAL'
        ? Math.max(0.05, Math.min(0.95, this.config.partialRatio))
        : 1;
    const end = this.start.clone().lerp(this.destination, ratio);
    const firstControl = this.start.clone().lerp(end, 0.32);
    const secondControl = this.start.clone().lerp(end, 0.7);
    const groundBias = Math.max(
      0.035,
      Math.min(this.start.y, end.y) - 0.08,
    );
    firstControl.y = groundBias;
    secondControl.y = groundBias;

    const curve = new CatmullRomCurve3([
      this.start.clone(),
      firstControl,
      secondControl,
      end,
    ]);
    this.tube = new Mesh(
      new TubeGeometry(curve, 24, 0.025, 6, false),
      this.material,
    );
    this.tube.name = 'CableRun-17-tube';
    this.tube.raycast = () => undefined;
    this.endMarker.position.copy(end);
    this.endMarker.visible = true;
    this.object.add(this.tube);
  }

  private applyStateMaterial(): void {
    const color = CABLE_COLORS[this.state];
    this.material.color.setHex(color);
    this.material.emissive.setHex(
      this.state === 'PARTIAL' ? 0x4f2a08 : 0x102d1c,
    );
    const endMaterial = this.endMarker.material as MeshStandardMaterial;
    endMaterial.color.setHex(color);
    endMaterial.emissive.setHex(color);
  }
}

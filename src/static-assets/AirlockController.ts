import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
  type Box3,
  type Material,
  type Object3D,
} from 'three';
import {
  FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL,
  FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL,
} from '../levels/scene2';
import type { AirlockInteractionConfig } from '../levels/types';
import { AirlockLeakParticles } from './AirlockLeakParticles';

export const AirlockStates = {
  CLOSED: 'CLOSED',
  PURGING: 'PURGING',
  REOPENING: 'REOPENING',
  OPEN: 'OPEN',
  RESEATING: 'RESEATING',
  SEALED: 'SEALED',
  FAULT: 'FAULT',
} as const;

export type AirlockState =
  (typeof AirlockStates)[keyof typeof AirlockStates];

export const AirlockLightModes = {
  NOMINAL: 'NOMINAL',
  WARNING: 'WARNING',
  FAULT: 'FAULT',
  PURGING: 'PURGING',
  SEALED: 'SEALED',
} as const;

export type AirlockLightMode =
  (typeof AirlockLightModes)[keyof typeof AirlockLightModes];

export type AirlockOutputEvent =
  | 'AIRLOCK_STATE_CHANGED'
  | 'AIRLOCK_PURGE_COMPLETE'
  | 'AIRLOCK_PRESSURE_STABLE'
  | 'AIRLOCK_LEAK_CHANGED';

type EventEmitter = (
  type: AirlockOutputEvent,
  detail: Readonly<Record<string, unknown>>,
) => void;

type Sequence = 'NONE' | 'PURGE' | 'EMERGENCY';

const DOOR_DEPTH = 0.08;
const DOOR_WIDTH = 2.2;
const DOOR_HEIGHT = 2.8;
const DOOR_Z = 0.09;

export class AirlockController {
  private readonly config: AirlockInteractionConfig;
  private readonly emit: EventEmitter;
  private readonly closedPosition: Vector3;
  private openFraction = 0;
  private tweenStartFraction = 0;
  private readonly doorPanel: Mesh;
  private readonly portalMask: Mesh;
  private readonly headerMask: Mesh;
  private readonly approachTriggerAnchor: Group;
  private readonly thresholdTriggerAnchor: Group;
  private readonly removedSourceModel: Object3D;
  private readonly leakParticles: AirlockLeakParticles;
  private state: AirlockState = AirlockStates.CLOSED;
  private sequence: Sequence = 'NONE';
  private elapsed = 0;

  constructor(
    placementRoot: Group,
    sourceModel: Object3D,
    leakOrigin: Object3D,
    config: AirlockInteractionConfig,
    emit: EventEmitter,
  ) {
    this.config = config;
    this.emit = emit;
    this.closedPosition = new Vector3().fromArray(config.closedPosition);
    this.closedPosition.z = DOOR_Z;

    placementRoot.name = 'facadeAirlockAnchor';
    sourceModel.removeFromParent();
    sourceModel.visible = false;
    this.removedSourceModel = sourceModel;

    this.portalMask = new Mesh(
      new BoxGeometry(2.28, 2.9, 0.05),
      new MeshBasicMaterial({ color: 0x030304 }),
    );
    this.portalMask.name = 'portalMask';
    this.portalMask.position.z = 0.015;

    this.doorPanel = new Mesh(
      new BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, DOOR_DEPTH),
      new MeshStandardMaterial({
        color: 0x586166,
        metalness: 0.55,
        roughness: 0.38,
        emissive: 0x151b20,
        emissiveIntensity: 0.35,
      }),
    );
    this.doorPanel.name = 'doorPanel';
    this.doorPanel.position.copy(this.closedPosition);
    this.doorPanel.castShadow = true;
    this.doorPanel.receiveShadow = true;

    this.headerMask = new Mesh(
      new BoxGeometry(2.46, 0.42, 0.18),
      new MeshStandardMaterial({
        color: 0x202124,
        metalness: 0.62,
        roughness: 0.28,
      }),
    );
    this.headerMask.name = 'headerMask';
    this.headerMask.position.set(0, 1.61, 0.15);

    this.approachTriggerAnchor = createTriggerAnchor(
      'approachTriggerAnchor',
      FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL,
    );
    this.thresholdTriggerAnchor = createTriggerAnchor(
      'thresholdTriggerAnchor',
      FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL,
    );

    placementRoot.add(
      this.portalMask,
      this.doorPanel,
      this.headerMask,
      this.approachTriggerAnchor,
      this.thresholdTriggerAnchor,
    );

    this.leakParticles = new AirlockLeakParticles(
      leakOrigin,
      config.leakParticleCount,
    );
    this.leakParticles.object.raycast = () => undefined;
    placementRoot.add(this.leakParticles.object);
  }

  get currentState(): AirlockState {
    return this.state;
  }

  get leakActive(): boolean {
    return this.leakParticles.isActive;
  }

  setAirlockState(state: AirlockState): void {
    this.sequence = 'NONE';
    this.enterState(state);
  }

  triggerAirlockPurge(): void {
    this.sequence = 'PURGE';
    this.enterState(AirlockStates.PURGING);
  }

  triggerEmergencyHatchCycle(): void {
    this.sequence = 'EMERGENCY';
    this.setAirlockLeakActive(true);
    this.enterState(AirlockStates.FAULT);
  }

  openAirlock(): void {
    if (
      this.state === AirlockStates.REOPENING ||
      this.state === AirlockStates.OPEN
    ) {
      return;
    }
    this.sequence = 'NONE';
    this.enterState(AirlockStates.REOPENING);
  }

  closeAirlock(): void {
    if (
      this.state === AirlockStates.RESEATING ||
      this.state === AirlockStates.CLOSED ||
      this.state === AirlockStates.SEALED
    ) {
      return;
    }
    this.sequence = 'NONE';
    this.enterState(AirlockStates.RESEATING);
  }

  setAirlockLeakActive(active: boolean): void {
    if (this.leakParticles.isActive === active) {
      return;
    }
    this.leakParticles.setActive(active);
    this.emit('AIRLOCK_LEAK_CHANGED', { active });
  }

  setLightOverride(mode: AirlockLightMode | null): void {
    void mode;
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.leakParticles.update(deltaSeconds);

    if (
      this.state === AirlockStates.REOPENING ||
      this.state === AirlockStates.RESEATING
    ) {
      const duration = Math.max(this.config.moveDurationSeconds, 0.01);
      const progress = Math.min(this.elapsed / duration, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const target = this.state === AirlockStates.REOPENING ? 1 : 0;
      this.openFraction = this.tweenStartFraction + (target - this.tweenStartFraction) * eased;
      this.applyDoorPose();
      if (progress === 1) {
        if (this.state === AirlockStates.REOPENING) {
          this.enterState(AirlockStates.OPEN);
          if (this.sequence === 'PURGE') {
            this.sequence = 'NONE';
          }
        } else {
          const wasEmergency = this.sequence === 'EMERGENCY';
          this.enterState(AirlockStates.SEALED);
          this.sequence = 'NONE';
          if (wasEmergency) {
            this.setAirlockLeakActive(false);
          }
        }
      }
    } else if (
      this.state === AirlockStates.PURGING &&
      this.elapsed >= this.config.purgeDurationSeconds
    ) {
      this.emit('AIRLOCK_PURGE_COMPLETE', {
        state: AirlockStates.PURGING,
      });
      this.enterState(AirlockStates.REOPENING);
    } else if (
      this.state === AirlockStates.FAULT &&
      this.sequence === 'EMERGENCY' &&
      this.elapsed >= this.config.emergencyFaultHoldSeconds
    ) {
      this.enterState(AirlockStates.REOPENING);
    } else if (
      this.state === AirlockStates.OPEN &&
      this.sequence === 'EMERGENCY' &&
      this.elapsed >= this.config.emergencyOpenHoldSeconds
    ) {
      this.enterState(AirlockStates.RESEATING);
    }
  }

  dispose(): void {
    this.leakParticles.dispose();
    disposeMesh(this.doorPanel);
    disposeMesh(this.portalMask);
    disposeMesh(this.headerMask);
    this.approachTriggerAnchor.removeFromParent();
    this.thresholdTriggerAnchor.removeFromParent();
    disposeObjectResources(this.removedSourceModel);
  }

  private applyDoorPose(): void {
    // Retract into the lintel: the visible panel never rises above the facade.
    this.doorPanel.scale.y = Math.max(0.001, 1 - this.openFraction);
    this.doorPanel.position.copy(this.closedPosition);
    this.doorPanel.position.y += DOOR_HEIGHT * this.openFraction / 2;
  }

  private enterState(state: AirlockState): void {
    this.state = state;
    this.elapsed = 0;
    this.tweenStartFraction = this.openFraction;
    this.doorPanel.visible = state !== AirlockStates.OPEN;

    if (
      state === AirlockStates.CLOSED ||
      state === AirlockStates.SEALED
    ) {
      this.openFraction = 0;
      this.applyDoorPose();
    } else if (state === AirlockStates.OPEN) {
      this.openFraction = 1;
      this.applyDoorPose();
    }

    this.emit('AIRLOCK_STATE_CHANGED', { state });
    if (state === AirlockStates.SEALED) {
      this.emit('AIRLOCK_PRESSURE_STABLE', { state });
    }
  }
}

const createTriggerAnchor = (name: string, bounds: Box3): Group => {
  const anchor = new Group();
  anchor.name = name;
  anchor.position.copy(bounds.getCenter(new Vector3()));
  anchor.userData.triggerSize = bounds.getSize(new Vector3()).toArray();
  return anchor;
};

const disposeMesh = (mesh: Mesh): void => {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  materials.forEach((material) => material.dispose());
};

const disposeObjectResources = (root: Object3D): void => {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    object.geometry.dispose();
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      material.dispose();
    }
  });
};

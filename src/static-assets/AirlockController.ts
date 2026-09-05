import {
  Group,
  Mesh,
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
import { AirlockDoorVisual } from './AirlockDoorVisual';

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

export class AirlockController {
  private readonly config: AirlockInteractionConfig;
  private readonly emit: EventEmitter;
  private openFraction = 0;
  private tweenStartFraction = 0;
  private readonly visual: AirlockDoorVisual;
  private lightOverride: AirlockLightMode | null = null;
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

    placementRoot.name = 'facadeAirlockAnchor';
    sourceModel.removeFromParent();
    sourceModel.visible = false;
    this.removedSourceModel = sourceModel;

    this.visual = new AirlockDoorVisual();
    placementRoot.userData.hideSelectionHighlight = true;

    this.approachTriggerAnchor = createTriggerAnchor(
      'approachTriggerAnchor',
      FACADE_AIRLOCK_APPROACH_TRIGGER_LOCAL,
    );
    this.thresholdTriggerAnchor = createTriggerAnchor(
      'thresholdTriggerAnchor',
      FACADE_AIRLOCK_THRESHOLD_TRIGGER_LOCAL,
    );

    placementRoot.add(
      this.visual.object,
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
    this.lightOverride = mode;
    this.visual.setStatus(mode ?? this.state);
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
    this.visual.dispose();
    this.approachTriggerAnchor.removeFromParent();
    this.thresholdTriggerAnchor.removeFromParent();
    disposeObjectResources(this.removedSourceModel);
  }

  private applyDoorPose(): void {
    this.visual.setPose(this.openFraction);
  }

  private enterState(state: AirlockState): void {
    this.state = state;
    this.elapsed = 0;
    this.tweenStartFraction = this.openFraction;
    this.visual.setStatus(this.lightOverride ?? state);

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

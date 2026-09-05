import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';
import type { AssetRegistry, LoadedAsset } from '../assets/AssetRegistry';
import type {
  CableTaskState,
  LevelAssetConfig,
  LevelConfig,
} from '../levels/types';
import {
  AirlockController,
  AirlockLightModes,
  AirlockStates,
  type AirlockLightMode,
  type AirlockOutputEvent,
  type AirlockState,
} from './AirlockController';
import { CableDeploymentVisual } from './CableDeploymentVisual';

export const StaticSceneGameEvents = {
  GO2_HANDSHAKE_COMPLETE: 'GO2_HANDSHAKE_COMPLETE',
  GO2_POUNCE_COMPLETE: 'GO2_POUNCE_COMPLETE',
  AIRLOCK_PURGE_COMPLETE: 'AIRLOCK_PURGE_COMPLETE',
  AIRLOCK_PRESSURE_STABLE: 'AIRLOCK_PRESSURE_STABLE',
  AIRLOCK_STATE_CHANGED: 'AIRLOCK_STATE_CHANGED',
  AIRLOCK_LEAK_CHANGED: 'AIRLOCK_LEAK_CHANGED',
  CABLE_TASK_STATE_CHANGED: 'CABLE_TASK_STATE_CHANGED',
} as const;

export type StaticSceneGameEvent =
  (typeof StaticSceneGameEvents)[keyof typeof StaticSceneGameEvents];

const AIRLOCK_STATE_VALUES = new Set<string>(
  Object.values(AirlockStates),
);
const AIRLOCK_LIGHT_VALUES = new Set<string>(
  Object.values(AirlockLightModes),
);
const CABLE_STATE_VALUES = new Set<string>([
  'NOT_STARTED',
  'PARTIAL',
  'CONNECTED',
]);

export interface StaticSceneRuntimeApi {
  readonly events: EventTarget;
  dispatchGameEvent(
    event:
      | 'GO2_HANDSHAKE_COMPLETE'
      | 'GO2_POUNCE_COMPLETE',
  ): void;
  setAirlockState(state: AirlockState): void;
  triggerAirlockPurge(): void;
  triggerEmergencyHatchCycle(): void;
  openAirlock(): void;
  closeAirlock(): void;
  setAirlockLeakActive(active: boolean): void;
  setAirlockLightMode(mode: AirlockLightMode | null): void;
  setCableTaskState(state: CableTaskState): void;
  setLeakOriginDebugVisible(visible: boolean): void;
  getAirlockState(): AirlockState | null;
  getCableTaskState(): CableTaskState | null;
  getAirlockLeakActive(): boolean;
}

export class StaticAssetSystem {
  readonly events = new EventTarget();
  readonly api: StaticSceneRuntimeApi = {
    events: this.events,
    dispatchGameEvent: (event) => this.dispatchGameEvent(event),
    setAirlockState: (state) => this.setAirlockState(state),
    triggerAirlockPurge: () => this.triggerAirlockPurge(),
    triggerEmergencyHatchCycle: () =>
      this.triggerEmergencyHatchCycle(),
    openAirlock: () => this.openAirlock(),
    closeAirlock: () => this.closeAirlock(),
    setAirlockLeakActive: (active) =>
      this.setAirlockLeakActive(active),
    setAirlockLightMode: (mode) => this.setAirlockLightMode(mode),
    setCableTaskState: (state) => this.setCableTaskState(state),
    setLeakOriginDebugVisible: (visible) =>
      this.setLeakOriginDebugVisible(visible),
    getAirlockState: () => this.airlock?.currentState ?? null,
    getCableTaskState: () => this.cable?.taskState ?? null,
    getAirlockLeakActive: () => this.airlock?.leakActive ?? false,
  };

  private readonly root: Group;
  private readonly registry: AssetRegistry;
  private readonly level: LevelConfig;
  private readonly showDebugMarkers: boolean;
  private airlock: AirlockController | null = null;
  private cable: CableDeploymentVisual | null = null;
  private leakOriginMarker: Object3D | null = null;
  private initialized = false;

  constructor(
    root: Group,
    registry: AssetRegistry,
    level: LevelConfig,
    showDebugMarkers: boolean,
  ) {
    this.root = root;
    this.registry = registry;
    this.level = level;
    this.showDebugMarkers = showDebugMarkers;
    this.root.userData.workGroups = (level.workGroups ?? []).map(
      (group) => ({
        ...group,
        memberEntityIds: [...group.memberEntityIds],
        sceneTags: [...group.sceneTags],
      }),
    );
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    for (const config of this.level.assets) {
      if (config.procedural) {
        this.createProceduralAsset(config);
      }
    }
    this.applyWorkGroupMetadata();

    const systems = this.level.staticSystems;
    if (!systems) {
      return;
    }

    const airlockAsset = this.registry.get(systems.airlock.assetId);
    const leakOrigin = this.registry.get(
      systems.airlock.leakOriginAssetId,
    );
    if (airlockAsset && leakOrigin) {
      this.airlock = new AirlockController(
        airlockAsset.root,
        airlockAsset.model,
        leakOrigin.root,
        systems.airlock,
        (event, detail) => this.publish(event, detail),
      );
    } else {
      console.warn(
        '[static-assets] Airlock controller unavailable: facade anchor or leak-origin asset did not initialize.',
      );
    }

    const cableRover = this.registry.get(systems.cable.roverAssetId);
    const cableEndpoint = this.registry.get(
      systems.cable.endpointAssetId,
    );
    if (cableRover && cableEndpoint) {
      this.cable = new CableDeploymentVisual(
        cableRover.root,
        cableEndpoint.root,
        systems.cable,
      );
      this.root.add(this.cable.object);
      this.cable.update();
    } else if (systems.cable.enabled) {
      console.warn(
        '[static-assets] Cable visual unavailable: rover or endpoint asset did not load.',
      );
    }
  }

  update(deltaSeconds: number): void {
    this.airlock?.update(deltaSeconds);
    this.cable?.update();
  }

  dispose(): void {
    this.airlock?.dispose();
    this.cable?.dispose();
    this.airlock = null;
    this.cable = null;
  }

  dispatchGameEvent(
    event:
      | 'GO2_HANDSHAKE_COMPLETE'
      | 'GO2_POUNCE_COMPLETE',
  ): void {
    this.publish(event, { source: 'external-bridge' });
    if (event === StaticSceneGameEvents.GO2_HANDSHAKE_COMPLETE) {
      this.triggerAirlockPurge();
    } else if (event === StaticSceneGameEvents.GO2_POUNCE_COMPLETE) {
      this.triggerEmergencyHatchCycle();
    }
  }

  setAirlockState(state: AirlockState): void {
    if (!AIRLOCK_STATE_VALUES.has(state)) {
      console.warn(`[static-assets] Invalid airlock state: ${state}`);
      return;
    }
    this.airlock?.setAirlockState(state);
  }

  triggerAirlockPurge(): void {
    this.airlock?.triggerAirlockPurge();
  }

  triggerEmergencyHatchCycle(): void {
    this.airlock?.triggerEmergencyHatchCycle();
  }

  openAirlock(): void {
    this.airlock?.openAirlock();
  }

  closeAirlock(): void {
    this.airlock?.closeAirlock();
  }

  setAirlockLeakActive(active: boolean): void {
    this.airlock?.setAirlockLeakActive(active);
  }

  setAirlockLightMode(mode: AirlockLightMode | null): void {
    if (mode !== null && !AIRLOCK_LIGHT_VALUES.has(mode)) {
      console.warn(`[static-assets] Invalid airlock light mode: ${mode}`);
      return;
    }
    this.airlock?.setLightOverride(mode);
  }

  setCableTaskState(state: CableTaskState): void {
    if (!CABLE_STATE_VALUES.has(state)) {
      console.warn(`[static-assets] Invalid cable task state: ${state}`);
      return;
    }
    if (!this.cable || this.cable.taskState === state) {
      return;
    }
    this.cable.setTaskState(state);
    this.publish(StaticSceneGameEvents.CABLE_TASK_STATE_CHANGED, {
      state,
      taskId: this.level.staticSystems?.cable.taskId,
    });
  }

  setLeakOriginDebugVisible(visible: boolean): void {
    if (this.leakOriginMarker) {
      this.leakOriginMarker.visible = visible;
    }
  }

  private createProceduralAsset(config: LevelAssetConfig): void {
    const parent = config.parentAssetId
      ? this.registry.get(config.parentAssetId)?.root
      : this.root;
    if (!parent) {
      console.warn(
        `[static-assets] Procedural asset "${config.id}" has unavailable parent "${config.parentAssetId}".`,
      );
      return;
    }

    const root = new Group();
    root.name = config.id;
    root.position.fromArray(config.position);
    root.rotation.set(...config.rotation);
    root.scale.fromArray(config.scale);
    root.visible = config.visible ?? true;
    this.applyConfigMetadata(root, config);

    const model =
      config.procedural === 'facade-airlock-anchor'
        ? new Group()
        : config.procedural === 'airlock-leak-origin'
          ? this.createLeakOriginMarker()
          : this.createCableEndpointMarker();
    if (config.procedural === 'facade-airlock-anchor') {
      model.name = 'facade-airlock-procedural-source';
    }
    model.userData.levelAssetId = config.id;
    root.add(model);
    parent.add(root);

    const loaded: LoadedAsset = {
      config,
      root,
      model,
      normalization: null,
      animations: [],
      animation: null,
    };
    this.registry.register(loaded);

    if (config.procedural === 'airlock-leak-origin') {
      this.leakOriginMarker = model;
      model.visible = this.showDebugMarkers;
    }
  }

  private createLeakOriginMarker(): Mesh {
    const marker = new Mesh(
      new SphereGeometry(0.045, 12, 8),
      new MeshBasicMaterial({
        color: 0xff4055,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
        wireframe: true,
      }),
    );
    marker.name = 'airlock-leak-origin-debug-marker';
    marker.renderOrder = 1002;
    return marker;
  }

  private createCableEndpointMarker(): Group {
    const connector = new Group();
    connector.name = 'CableRun-17-destination-connector';
    const housing = new Mesh(
      new CylinderGeometry(0.11, 0.13, 0.16, 16),
      new MeshStandardMaterial({
        color: 0x6c7072,
        roughness: 0.55,
        metalness: 0.72,
      }),
    );
    const ring = new Mesh(
      new TorusGeometry(0.085, 0.018, 8, 20),
      new MeshStandardMaterial({
        color: 0xe1b66f,
        emissive: 0x493016,
        emissiveIntensity: 0.42,
        roughness: 0.42,
        metalness: 0.58,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    connector.add(housing, ring);
    return connector;
  }

  private applyConfigMetadata(
    root: Group,
    config: LevelAssetConfig,
  ): void {
    root.userData.levelAssetId = config.id;
    root.userData.levelAssetType = config.type;
    root.userData.role = config.role;
    root.userData.sceneTags = [...(config.sceneTags ?? [])];
    if (!config.association) {
      return;
    }
    root.userData.entityId = config.association.entityId;
    root.userData.assignedWorker = config.association.assignedWorker;
    root.userData.assignedWorkers = [
      ...(config.association.assignedWorkers ?? []),
    ];
    root.userData.taskId = config.association.taskId;
    root.userData.workGroupIds = [
      ...config.association.workGroupIds,
    ];
    root.userData.relatedEntityIds = [
      ...(config.association.relatedEntityIds ?? []),
    ];
  }

  private applyWorkGroupMetadata(): void {
    for (const group of this.level.workGroups ?? []) {
      for (const entityId of group.memberEntityIds) {
        const asset = this.registry.get(entityId);
        if (!asset) {
          continue;
        }
        const existing = Array.isArray(asset.root.userData.workGroupIds)
          ? (asset.root.userData.workGroupIds as string[])
          : [];
        asset.root.userData.workGroupIds = [
          ...new Set([...existing, group.id]),
        ];
      }
    }
  }

  private publish(
    type: StaticSceneGameEvent | AirlockOutputEvent,
    detail: Readonly<Record<string, unknown>>,
  ): void {
    const event = new CustomEvent(type, { detail });
    this.events.dispatchEvent(event);
    window.dispatchEvent(new CustomEvent(type, { detail }));
    console.info(`[static-assets] ${type}`, detail);
  }
}

export {
  AirlockLightModes,
  AirlockStates,
  type AirlockLightMode,
  type AirlockState,
};

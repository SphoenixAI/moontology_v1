import { MathUtils, Vector3, type Object3D } from 'three';
import type { SceneRobotCalibration } from '../levels/sceneRobotCalibration';
import { applyRobotSpawn } from '../levels/sceneRobotCalibration';
import {
  lerpAngle,
  mapPhysicalDeltaToScene,
  mapPhysicalPoseToVirtual,
  type PhysicalPose,
} from './physicalToVirtual';

export interface Go2Telemetry {
  timestamp: number;
  connected: boolean;
  battery?: number;
  pose?: {
    x: number;
    y: number;
    z: number;
  };
  orientation?: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
  yaw?: number;
  velocity?: {
    x: number;
    y: number;
    yaw: number;
  };
}

export interface Go2VelocityCommand {
  forward: number;
  lateral: number;
  yaw: number;
  durationMs: number;
}

export interface Go2BridgeState {
  bridgeConnected: boolean;
  robotConnected: boolean;
  commandsEnabled: boolean;
  telemetryActive: boolean;
  lastTelemetryTimestamp: number | null;
  battery: number | null;
  calibrationId: SceneRobotCalibration['id'];
  metersToWorldUnits: number;
  hasPhysicalOrigin: boolean;
}

export interface Go2BridgeRuntimeApi {
  getState(): Go2BridgeState;
  resetAlignment(): void;
  resetPhysicalOrigin(): void;
  stop(): boolean;
  sendVelocity(command: Go2VelocityCommand): boolean;
  applyPhysicalPose(pose: PhysicalPose): void;
  applyMockNudge(nudge: {
    forward?: number;
    lateral?: number;
    yaw?: number;
  }): void;
  setCalibration(calibration: SceneRobotCalibration): void;
  getCalibration(): SceneRobotCalibration;
  placeAtSceneSpawn(): void;
}

interface Go2TelemetryClientOptions {
  url?: string;
  token?: string;
  calibration: SceneRobotCalibration;
}

const TELEMETRY_STALE_MS = 2_000;
const RECONNECT_DELAY_MS = 2_000;
const DELTA_LOG_INTERVAL_MS = 1_000;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const quaternionYaw = (
  orientation: NonNullable<Go2Telemetry['orientation']>,
): number =>
  Math.atan2(
    2 *
      (orientation.w * orientation.z +
        orientation.x * orientation.y),
    1 -
      2 *
        (orientation.y * orientation.y +
          orientation.z * orientation.z),
  );

const readPosition = (
  value: unknown,
): { x: number; y: number; z: number } | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown };
  if (
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.z)
  ) {
    return null;
  }
  return { x: candidate.x, y: candidate.y, z: candidate.z };
};

const parseTelemetry = (value: unknown): Go2Telemetry | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<Go2Telemetry> & {
    type?: unknown;
    position?: unknown;
  };
  const pose = readPosition(candidate.pose) ?? readPosition(candidate.position);
  const hasYaw = isFiniteNumber(candidate.yaw);
  const hasOrientation = Boolean(candidate.orientation);
  if (!pose || (!hasYaw && !hasOrientation)) {
    return null;
  }
  if (candidate.type !== undefined && candidate.type !== 'telemetry') {
    return null;
  }
  if (
    candidate.connected !== undefined &&
    typeof candidate.connected !== 'boolean'
  ) {
    return null;
  }
  const { orientation, velocity, battery, yaw } = candidate;
  if (
    orientation &&
    (!isFiniteNumber(orientation.x) ||
      !isFiniteNumber(orientation.y) ||
      !isFiniteNumber(orientation.z) ||
      !isFiniteNumber(orientation.w))
  ) {
    return null;
  }
  if (
    velocity &&
    (!isFiniteNumber(velocity.x) ||
      !isFiniteNumber(velocity.y) ||
      !isFiniteNumber(velocity.yaw))
  ) {
    return null;
  }
  if (battery !== undefined && !isFiniteNumber(battery)) {
    return null;
  }
  return {
    timestamp: isFiniteNumber(candidate.timestamp)
      ? candidate.timestamp
      : Date.now(),
    connected: candidate.connected !== false,
    pose,
    orientation,
    yaw: hasYaw ? yaw : undefined,
    velocity,
    battery,
  };
};

const poseFromTelemetry = (telemetry: Go2Telemetry): PhysicalPose | null => {
  if (!telemetry.pose) {
    return null;
  }
  const yaw = isFiniteNumber(telemetry.yaw)
    ? telemetry.yaw
    : telemetry.orientation
      ? quaternionYaw(telemetry.orientation)
      : null;
  if (yaw === null) {
    return null;
  }
  return {
    position: telemetry.pose,
    yaw,
  };
};

export class Go2TelemetryClient {
  readonly api: Go2BridgeRuntimeApi;

  private readonly url: string | null;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private latestTelemetry: Go2Telemetry | null = null;
  private calibration: SceneRobotCalibration;
  private physicalOrigin: PhysicalPose | null = null;
  private virtualOriginPosition: Vector3 | null = null;
  private virtualOriginYaw = 0;
  private readonly targetPosition = new Vector3();
  private targetYaw = 0;
  private hasTarget = false;
  private mockActive = false;
  private readonly mockPhysical: PhysicalPose = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
  };
  private attachedRoot: Object3D | null = null;
  private bridgeConnected = false;
  private robotConnected = false;
  private commandsEnabled = false;
  private telemetryActive = false;
  private lastTelemetryReceivedAt = 0;
  private lastDeltaLogAt = 0;
  private loggedDisconnect = false;
  private disposed = false;

  constructor({ url, token, calibration }: Go2TelemetryClientOptions) {
    this.calibration = calibration;
    if (url) {
      const bridgeUrl = new URL(url, window.location.href);
      if (token) {
        bridgeUrl.searchParams.set('token', token);
      }
      this.url = bridgeUrl.toString();
    } else {
      this.url = null;
    }
    this.api = {
      getState: () => this.getState(),
      resetAlignment: () => this.resetPhysicalOrigin(),
      resetPhysicalOrigin: () => this.resetPhysicalOrigin(),
      stop: () => this.send({ type: 'stop' }),
      sendVelocity: (command) =>
        this.send({ type: 'velocity', ...command }),
      applyPhysicalPose: (pose) => this.applyPhysicalPose(pose, 'mock'),
      applyMockNudge: (nudge) => this.applyMockNudge(nudge),
      setCalibration: (next) => this.setCalibration(next),
      getCalibration: () => this.calibration,
      placeAtSceneSpawn: () => this.placeAtSceneSpawn(),
    };
    if (this.url) {
      this.connect();
    }
  }

  attach(agentRoot: Object3D): void {
    this.attachedRoot = agentRoot;
    this.targetPosition.copy(agentRoot.position);
    this.targetYaw = agentRoot.rotation.y;
  }

  setCalibration(calibration: SceneRobotCalibration): void {
    this.calibration = calibration;
    if (this.attachedRoot) {
      this.attachedRoot.position.y = calibration.robotGroundY;
    }
    this.targetPosition.y = calibration.robotGroundY;
  }

  getCalibration(): SceneRobotCalibration {
    return this.calibration;
  }

  placeAtSceneSpawn(): void {
    const root = this.attachedRoot;
    if (!root) {
      return;
    }
    applyRobotSpawn(root, this.calibration);
    this.targetPosition.copy(root.position);
    this.targetYaw = root.rotation.y;
    this.hasTarget = false;
    this.resetPhysicalOrigin();
    console.info(`[GO2] ${this.calibration.id} spawn applied`);
  }

  resetPhysicalOrigin(): void {
    this.physicalOrigin = null;
    this.virtualOriginPosition = null;
    this.mockActive = false;
    this.hasTarget = false;
    this.mockPhysical.position = { x: 0, y: 0, z: 0 };
    this.mockPhysical.yaw = 0;
    if (this.attachedRoot) {
      this.virtualOriginPosition = this.attachedRoot.position.clone();
      this.virtualOriginYaw = this.attachedRoot.rotation.y;
      this.targetPosition.copy(this.attachedRoot.position);
      this.targetPosition.y = this.calibration.robotGroundY;
      this.targetYaw = this.attachedRoot.rotation.y;
    }
    const livePose = this.latestLivePose();
    if (livePose) {
      this.captureOrigin(livePose);
    }
  }

  applyPhysicalPose(
    pose: PhysicalPose,
    source: 'live' | 'mock' = 'mock',
  ): void {
    const root = this.attachedRoot;
    if (!root) {
      return;
    }
    if (source === 'mock') {
      this.mockActive = true;
      this.mockPhysical.position = { ...pose.position };
      this.mockPhysical.yaw = pose.yaw;
      if (!this.physicalOrigin) {
        this.physicalOrigin = {
          position: { x: 0, y: 0, z: 0 },
          yaw: 0,
        };
        this.virtualOriginPosition = root.position.clone();
        this.virtualOriginYaw = root.rotation.y;
        console.info('[GO2 SYNC] physical origin captured');
      }
    }
    if (!this.physicalOrigin || !this.virtualOriginPosition) {
      this.captureOrigin(pose);
      return;
    }

    const mapped = mapPhysicalPoseToVirtual(
      pose,
      this.physicalOrigin,
      {
        position: this.virtualOriginPosition,
        yaw: this.virtualOriginYaw,
      },
      this.calibration,
    );
    this.targetPosition.copy(mapped.position);
    this.targetPosition.y = this.calibration.robotGroundY;
    this.targetYaw = mapped.yaw;
    this.hasTarget = true;

    const now = performance.now();
    if (now - this.lastDeltaLogAt >= DELTA_LOG_INTERVAL_MS) {
      this.lastDeltaLogAt = now;
      const physicalDelta = new Vector3(
        pose.position.x - this.physicalOrigin.position.x,
        pose.position.y - this.physicalOrigin.position.y,
        pose.position.z - this.physicalOrigin.position.z,
      );
      const mappedDelta = mapPhysicalDeltaToScene(
        physicalDelta,
        this.calibration,
      );
      console.info(
        '[GO2 SYNC] physical delta:',
        {
          x: Number(physicalDelta.x.toFixed(3)),
          y: Number(physicalDelta.y.toFixed(3)),
          z: Number(physicalDelta.z.toFixed(3)),
        },
      );
      console.info('[GO2 SYNC] mapped delta:', {
        x: Number(mappedDelta.x.toFixed(3)),
        z: Number(mappedDelta.z.toFixed(3)),
      });
    }
  }

  applyMockNudge(nudge: {
    forward?: number;
    lateral?: number;
    yaw?: number;
  }): void {
    if (!this.physicalOrigin) {
      this.physicalOrigin = {
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
      };
      if (this.attachedRoot) {
        this.virtualOriginPosition = this.attachedRoot.position.clone();
        this.virtualOriginYaw = this.attachedRoot.rotation.y;
      }
      console.info('[GO2 SYNC] physical origin captured');
    }
    this.mockPhysical.position.x += nudge.forward ?? 0;
    this.mockPhysical.position.y += nudge.lateral ?? 0;
    this.mockPhysical.yaw += nudge.yaw ?? 0;
    this.applyPhysicalPose(this.mockPhysical, 'mock');
  }

  isDriving(): boolean {
    return this.robotConnected || this.mockActive;
  }

  update(agentRoot: Object3D, deltaSeconds: number): void {
    this.attachedRoot = agentRoot;
    if (
      this.robotConnected &&
      performance.now() - this.lastTelemetryReceivedAt >
        TELEMETRY_STALE_MS
    ) {
      this.robotConnected = false;
      this.freezeOnDisconnect();
    }

    if (!this.hasTarget) {
      agentRoot.position.y = this.calibration.robotGroundY;
      return;
    }

    const alpha = MathUtils.clamp(
      1 - (1 - this.calibration.smoothingFactor) ** (deltaSeconds * 60),
      0,
      1,
    );
    agentRoot.position.x = MathUtils.lerp(
      agentRoot.position.x,
      this.targetPosition.x,
      alpha,
    );
    agentRoot.position.z = MathUtils.lerp(
      agentRoot.position.z,
      this.targetPosition.z,
      alpha,
    );
    agentRoot.position.y = this.calibration.robotGroundY;
    agentRoot.rotation.y = lerpAngle(
      agentRoot.rotation.y,
      this.targetYaw,
      alpha,
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, 'Moontology disposed');
    this.socket = null;
  }

  private captureOrigin(pose: PhysicalPose): void {
    this.physicalOrigin = {
      position: { ...pose.position },
      yaw: pose.yaw,
    };
    if (this.attachedRoot) {
      this.virtualOriginPosition = this.attachedRoot.position.clone();
      this.virtualOriginYaw = this.attachedRoot.rotation.y;
    } else {
      this.virtualOriginPosition = new Vector3(
        this.calibration.robotSpawnPosition.x,
        this.calibration.robotGroundY,
        this.calibration.robotSpawnPosition.z,
      );
      this.virtualOriginYaw = this.calibration.robotSpawnYaw;
    }
    this.targetPosition.set(
      this.virtualOriginPosition.x,
      this.calibration.robotGroundY,
      this.virtualOriginPosition.z,
    );
    this.targetYaw = this.virtualOriginYaw;
    this.hasTarget = false;
    console.info('[GO2 SYNC] physical origin captured');
  }

  private latestLivePose(): PhysicalPose | null {
    if (!this.robotConnected || !this.latestTelemetry?.connected) {
      return null;
    }
    return poseFromTelemetry(this.latestTelemetry);
  }

  private freezeOnDisconnect(): void {
    this.hasTarget = false;
    this.mockActive = false;
    if (!this.loggedDisconnect) {
      this.loggedDisconnect = true;
      console.warn('[GO2 SYNC] telemetry disconnected');
    }
  }

  private connect(): void {
    if (this.disposed || !this.url) {
      return;
    }
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.bridgeConnected = true;
      this.loggedDisconnect = false;
      console.info('[GO2 SYNC] WebSocket connected');
    });
    socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.bridgeConnected = false;
      this.robotConnected = false;
      this.freezeOnDisconnect();
      if (!this.disposed) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, RECONNECT_DELAY_MS);
      }
    });
    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      console.warn('[GO2 SYNC] ignored malformed telemetry message');
      return;
    }

    const telemetry = parseTelemetry(message);
    if (telemetry) {
      this.latestTelemetry = telemetry;
      this.robotConnected = telemetry.connected;
      this.lastTelemetryReceivedAt = performance.now();
      if (!this.telemetryActive) {
        this.telemetryActive = true;
        console.info('[GO2 SYNC] telemetry active');
      }
      if (!telemetry.connected) {
        this.freezeOnDisconnect();
        return;
      }
      this.loggedDisconnect = false;
      const pose = poseFromTelemetry(telemetry);
      if (pose) {
        this.applyPhysicalPose(pose, 'live');
      }
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }
    const event = message as Record<string, unknown>;
    if (event.type === 'status') {
      this.robotConnected = event.connected === true;
      this.commandsEnabled = event.commandsEnabled === true;
    } else if (event.type === 'command_ack') {
      console.info('[COMMAND] accepted', event.command);
    } else if (event.type === 'command_rejected') {
      console.warn('[COMMAND] rejected', event.reason);
    }
  }

  private send(payload: object): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[COMMAND] bridge is not connected');
      return false;
    }
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  getState(): Go2BridgeState {
    return {
      bridgeConnected: this.bridgeConnected,
      robotConnected: this.robotConnected,
      commandsEnabled: this.commandsEnabled,
      telemetryActive: this.telemetryActive,
      lastTelemetryTimestamp: this.latestTelemetry?.timestamp ?? null,
      battery: this.latestTelemetry?.battery ?? null,
      calibrationId: this.calibration.id,
      metersToWorldUnits: this.calibration.metersToWorldUnits,
      hasPhysicalOrigin: this.physicalOrigin !== null,
    };
  }
}

export const ROBOT_TELEMETRY_WS =
  import.meta.env.VITE_ROBOT_TELEMETRY_WS ||
  import.meta.env.VITE_GO2_BRIDGE_URL ||
  'ws://LAPTOP_2_IP:PORT';

export const resolveRobotTelemetryUrl = (): string | undefined => {
  if (ROBOT_TELEMETRY_WS.includes('LAPTOP_2_IP')) {
    return undefined;
  }
  return ROBOT_TELEMETRY_WS;
};

export const createGo2TelemetryClientFromEnvironment = (
  calibration: SceneRobotCalibration,
): Go2TelemetryClient =>
  new Go2TelemetryClient({
    url: resolveRobotTelemetryUrl(),
    token: import.meta.env.VITE_GO2_BRIDGE_TOKEN,
    calibration,
  });

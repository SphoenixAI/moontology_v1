import { MathUtils } from 'three';
import { DockablePanel } from '../ui/DockablePanel';
import type { SceneRobotCalibration } from '../levels/sceneRobotCalibration';
import type { Go2TelemetryClient } from './Go2TelemetryClient';
import type { Go2SceneRegistrationDebug } from './Go2SceneRegistrationDebug';

export class Go2SyncDebugPanel {
  private readonly dock: DockablePanel;
  private readonly positionValue = document.createElement('dd');
  private readonly yawValue = document.createElement('dd');
  private readonly groundValue = document.createElement('dd');
  private readonly scaleValue = document.createElement('dd');
  private readonly worldValue = document.createElement('dd');
  private readonly originValue = document.createElement('dd');
  private readonly connectionValue = document.createElement('dd');
  private readonly client: Go2TelemetryClient;
  private readonly registration: Go2SceneRegistrationDebug | null;

  constructor(
    host: HTMLElement,
    client: Go2TelemetryClient,
    registration: Go2SceneRegistrationDebug | null,
  ) {
    this.client = client;
    this.registration = registration;
    this.dock = new DockablePanel({
      id: 'go2-sync',
      title: 'GO2 SCENE 2 SYNC',
      host,
      className: 'go2-map-panel go2-sync-panel',
      defaultMode: 'top-left',
    });

    this.dock.body.innerHTML = `
      <p>Mock planar odometry. AgentRoot only. Physical height is ignored.</p>
      <div class="go2-sync-panel__actions"></div>
      <dl></dl>
    `;

    const actions = this.dock.body.querySelector('.go2-sync-panel__actions');
    const buttons: ReadonlyArray<[string, () => void]> = [
      ['+1m FWD', () => this.client.applyMockNudge({ forward: 1 })],
      ['-1m FWD', () => this.client.applyMockNudge({ forward: -1 })],
      ['+0.5m LAT', () => this.client.applyMockNudge({ lateral: 0.5 })],
      ['-0.5m LAT', () => this.client.applyMockNudge({ lateral: -0.5 })],
      ['+45° YAW', () => this.client.applyMockNudge({ yaw: Math.PI / 4 })],
      ['-45° YAW', () => this.client.applyMockNudge({ yaw: -Math.PI / 4 })],
      ['RESET ORIGIN', () => this.client.resetPhysicalOrigin()],
      ['RESPAWN', () => this.client.placeAtSceneSpawn()],
    ];
    for (const [label, onClick] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', onClick);
      actions?.append(button);
    }

    const values = this.dock.body.querySelector('dl');
    const rows: ReadonlyArray<[string, HTMLElement]> = [
      ['Go2 root', this.positionValue],
      ['Go2 yaw', this.yawValue],
      ['robotGroundY', this.groundValue],
      ['m → world', this.scaleValue],
      ['Scene world', this.worldValue],
      ['Physical origin', this.originValue],
      ['Telemetry', this.connectionValue],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      values?.append(term, value);
    }
    this.update();
  }

  update(): void {
    const calibration = this.client.getCalibration();
    const snapshot = this.registration?.snapshot(calibration);
    const position = snapshot?.go2Position;
    const yaw = snapshot?.go2Yaw ?? 0;
    this.positionValue.textContent = position
      ? `[${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}]`
      : '—';
    this.yawValue.textContent = `${MathUtils.radToDeg(yaw).toFixed(1)}°`;
    this.groundValue.textContent = calibration.robotGroundY.toFixed(3);
    this.scaleValue.textContent = String(calibration.metersToWorldUnits);
    this.worldValue.textContent = formatWorld(calibration);
    const state = this.client.getState();
    this.originValue.textContent = state.hasPhysicalOrigin ? 'captured' : 'pending';
    this.connectionValue.textContent = state.bridgeConnected
      ? state.robotConnected
        ? 'live'
        : 'socket'
      : 'mock only';
  }

  dispose(): void {
    this.dock.dispose();
  }
}

const formatWorld = (calibration: SceneRobotCalibration): string => {
  const { worldPosition, worldRotationY, worldScale } = calibration;
  return `[${worldPosition.x.toFixed(2)}, ${worldPosition.y.toFixed(2)}, ${worldPosition.z.toFixed(2)}] y${MathUtils.radToDeg(worldRotationY).toFixed(0)}° ×${worldScale}`;
};

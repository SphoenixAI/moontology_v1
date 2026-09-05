import { MathUtils } from 'three';
import { DockablePanel } from '../ui/DockablePanel';
import type { Go2Agent } from './Go2Agent';

export class Go2MapPanel {
  private readonly dock: DockablePanel;
  private readonly positionValue = document.createElement('dd');
  private readonly yawValue = document.createElement('dd');
  private readonly speedValue = document.createElement('dd');
  private readonly angularVelocityValue = document.createElement('dd');
  private readonly phaseValue = document.createElement('dd');
  private readonly frequencyValue = document.createElement('dd');
  private readonly modeValue = document.createElement('dd');
  private readonly movementValue = document.createElement('dd');
  private readonly agent: Go2Agent;

  constructor(host: HTMLElement, agent: Go2Agent) {
    this.agent = agent;
    this.dock = new DockablePanel({
      id: 'go2-map',
      title: 'GO2 PROCEDURAL GAIT TEST',
      host,
      className: 'go2-map-panel',
      defaultMode: 'top-right',
    });
    this.dock.body.innerHTML = `
      <p>AgentRoot is authoritative. VisualRig follows position and yaw.</p>
      <div class="go2-map-panel__keys" aria-label="Manual controls">
        <kbd>↑</kbd><span>Forward</span>
        <kbd>↓</kbd><span>Backward</span>
        <kbd>←</kbd><span>Rotate left</span>
        <kbd>→</kbd><span>Rotate right</span>
      </div>
      <dl></dl>
      <a href="/go2-test.html" target="_blank" rel="noreferrer">
        OPEN 12-JOINT ARTICULATION TEST
      </a>
    `;

    const values = this.dock.body.querySelector('dl');
    const rows: ReadonlyArray<[string, HTMLElement]> = [
      ['AgentRoot position', this.positionValue],
      ['AgentRoot yaw', this.yawValue],
      ['Movement speed', this.speedValue],
      ['Yaw velocity', this.angularVelocityValue],
      ['Gait phase', this.phaseValue],
      ['Gait frequency', this.frequencyValue],
      ['Joint motion mode', this.modeValue],
      ['Robot state', this.movementValue],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      values?.append(term, value);
    }

    this.update();
  }

  update(): void {
    const { agentRoot, gaitState } = this.agent;
    const { x, y, z } = agentRoot.position;
    this.positionValue.textContent =
      `[${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}]`;
    this.yawValue.textContent =
      `${MathUtils.radToDeg(agentRoot.rotation.y).toFixed(1)}°`;
    this.speedValue.textContent = `${gaitState.movementSpeed.toFixed(2)} m/s`;
    this.angularVelocityValue.textContent =
      `${gaitState.angularVelocity.toFixed(2)} rad/s`;
    this.phaseValue.textContent = `${gaitState.phase.toFixed(2)} rad`;
    this.frequencyValue.textContent = `${gaitState.frequency.toFixed(2)} Hz`;
    this.modeValue.textContent = gaitState.mode;
    this.movementValue.textContent = gaitState.moving ? 'MOVING' : 'STOPPED';
  }

  dispose(): void {
    this.dock.dispose();
  }
}

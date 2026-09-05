import type { CableTaskState } from '../levels/types';
import { DockablePanel } from '../ui/DockablePanel';
import type { StaticSceneRuntimeApi } from './StaticAssetSystem';

export class StaticSystemsDebugPanel {
  private readonly api: StaticSceneRuntimeApi;
  private readonly dock: DockablePanel;
  private readonly cableValue = document.createElement('strong');

  constructor(host: HTMLElement, api: StaticSceneRuntimeApi) {
    this.api = api;
    this.dock = new DockablePanel({
      id: 'static-systems',
      title: 'STATIC SYSTEMS',
      host,
      className: 'static-systems-panel',
      ariaLabel: 'Static lunar asset debug controls',
      defaultMode: 'bottom-right',
      extraInsets: { y: 86 },
    });

    const status = document.createElement('div');
    status.className = 'static-systems-panel__status';
    status.append(this.statusRow('Cable', this.cableValue));

    const cableControls = this.controlGroup('CABLE TASK', [
      this.button('NOT STARTED', () =>
        this.setCableState('NOT_STARTED'),
      ),
      this.button('PARTIAL', () => this.setCableState('PARTIAL')),
      this.button('CONNECTED', () =>
        this.setCableState('CONNECTED'),
      ),
    ]);

    this.dock.body.append(status, cableControls);
    this.api.events.addEventListener(
      'CABLE_TASK_STATE_CHANGED',
      this.handleRuntimeEvent,
    );
    this.refresh();
  }

  dispose(): void {
    this.api.events.removeEventListener(
      'CABLE_TASK_STATE_CHANGED',
      this.handleRuntimeEvent,
    );
    this.dock.dispose();
  }

  private setCableState(state: CableTaskState): void {
    this.api.setCableTaskState(state);
    this.refresh();
  }

  private refresh(): void {
    this.cableValue.textContent =
      this.api.getCableTaskState() ?? 'UNAVAILABLE';
  }

  private readonly handleRuntimeEvent = (): void => {
    this.refresh();
  };

  private statusRow(label: string, value: HTMLElement): HTMLElement {
    const row = document.createElement('span');
    row.append(`${label}: `, value);
    return row;
  }

  private controlGroup(
    label: string,
    controls: readonly HTMLButtonElement[],
  ): HTMLElement {
    const group = document.createElement('details');
    group.open = true;
    const heading = document.createElement('summary');
    const buttons = document.createElement('div');
    heading.textContent = label;
    buttons.className = 'static-systems-panel__buttons';
    buttons.append(...controls);
    group.append(heading, buttons);
    return group;
  }

  private button(
    label: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }
}

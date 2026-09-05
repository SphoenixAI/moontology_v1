import type { AssetRegistry } from '../assets/AssetRegistry';
import { DockablePanel } from '../ui/DockablePanel';

const formatPosition = (position: readonly number[]): string =>
  position.map((value) => value.toFixed(2)).join(', ');

export class HumanoidFleetPanel {
  private readonly registry: AssetRegistry;
  private readonly onSelect: (id: string) => void;
  private readonly dock: DockablePanel;
  private readonly list = document.createElement('div');
  private lastSnapshot = '';

  constructor(
    host: HTMLElement,
    registry: AssetRegistry,
    onSelect: (id: string) => void,
  ) {
    this.registry = registry;
    this.onSelect = onSelect;
    this.dock = new DockablePanel({
      id: 'humanoid-fleet',
      title: 'HUMANOID FLEET',
      host,
      className: 'humanoid-fleet-panel',
      ariaLabel: 'Humanoid fleet debug listing',
      defaultMode: 'top-right',
      extraInsets: { x: 316 },
    });
    this.list.className = 'humanoid-fleet-panel__list';
    this.dock.body.append(this.list);
    this.update();
  }

  update(): void {
    const humanoids = this.registry
      .values()
      .filter(({ config }) => config.type === 'humanoid');
    const snapshot = humanoids
      .map(({ animation, config, root }) =>
        [
          config.id,
          config.role ?? 'UNASSIGNED',
          config.state ?? 'UNSPECIFIED',
          animation?.clip.name ?? 'NONE',
          root.position.x,
          root.position.y,
          root.position.z,
        ].join('|'),
      )
      .join('\n');

    if (snapshot === this.lastSnapshot) {
      return;
    }
    this.lastSnapshot = snapshot;

    const rows = humanoids.map(({ animation, config, root }) => {
      const row = document.createElement('button');
      const id = document.createElement('strong');
      const role = document.createElement('span');
      const animationState = document.createElement('span');
      const position = document.createElement('span');

      row.type = 'button';
      row.className = 'humanoid-fleet-panel__row';
      row.addEventListener('click', () => {
        this.onSelect(config.id);
      });
      id.textContent = config.id;
      role.textContent = config.role ?? 'UNASSIGNED';
      animationState.textContent =
        `${config.state ?? 'UNSPECIFIED'} · ${animation?.clip.name ?? 'NO ANIMATION'}`;
      position.textContent =
        `position ${formatPosition(root.position.toArray())}`;
      row.append(id, role, animationState, position);
      return row;
    });

    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No humanoids loaded.';
      this.list.replaceChildren(empty);
      return;
    }

    this.list.replaceChildren(...rows);
  }

  dispose(): void {
    this.dock.dispose();
  }
}

import type { Group } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { DockablePanel } from '../ui/DockablePanel';
import type { WorldHandle } from '../world/loadWorld';
import {
  serializeAssetTransform,
  serializeLevelTransforms,
} from './serializeTransforms';

export class PlacementPanel {
  private readonly registry: AssetRegistry;
  private readonly dock: DockablePanel;
  private readonly selectedValue = document.createElement('strong');
  private readonly assetCount = document.createElement('span');
  private readonly copyButton = document.createElement('button');
  private readonly deselectButton = document.createElement('button');
  private readonly output = document.createElement('pre');
  private selectedId: string | null = null;
  private selectedRoot: Group | null = null;
  private deselectHandler: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    world: WorldHandle,
    registry: AssetRegistry,
    totalAssets: number,
  ) {
    this.registry = registry;
    this.dock = new DockablePanel({
      id: 'placement',
      title: 'LEVEL 1 PLACEMENT',
      host,
      className: 'placement-panel',
      ariaLabel: 'Level placement controls',
      defaultMode: 'bottom-left',
    });

    const worldBadge = document.createElement('div');
    worldBadge.className = `world-badge world-badge--${world.activeMode}`;
    worldBadge.textContent =
      world.activeMode === 'placeholder'
        ? 'PLACEHOLDER WORLD'
        : 'MARBLE WORLD';
    if (world.fallbackReason) {
      worldBadge.title = world.fallbackReason;
    }

    const countRow = document.createElement('div');
    countRow.className = 'panel-row panel-row--muted';
    countRow.append('Assets loaded: ', this.assetCount);
    this.assetCount.textContent = `0 / ${totalAssets}`;

    const selectedRow = document.createElement('div');
    selectedRow.className = 'panel-row';
    selectedRow.append('Selected: ', this.selectedValue);
    this.selectedValue.textContent = 'None';

    const shortcutHint = document.createElement('p');
    shortcutHint.className = 'shortcut-hint';
    shortcutHint.textContent = 'W move · E rotate · R scale';

    const actions = document.createElement('div');
    actions.className = 'placement-actions';

    this.copyButton.type = 'button';
    this.copyButton.textContent = 'COPY TRANSFORM';
    this.copyButton.disabled = true;
    this.copyButton.addEventListener('click', this.copyTransform);

    const printButton = document.createElement('button');
    printButton.type = 'button';
    printButton.textContent = 'PRINT ALL TRANSFORMS';
    printButton.addEventListener('click', this.printAllTransforms);

    this.deselectButton.type = 'button';
    this.deselectButton.textContent = 'DESELECT';
    this.deselectButton.disabled = true;
    this.deselectButton.addEventListener('click', this.deselect);

    actions.append(this.copyButton, printButton, this.deselectButton);

    const colliderLabel = document.createElement('label');
    colliderLabel.className = 'collider-toggle';
    const colliderToggle = document.createElement('input');
    colliderToggle.type = 'checkbox';
    colliderToggle.disabled = !world.colliderAvailable;
    colliderToggle.addEventListener('change', () => {
      world.setColliderVisible(colliderToggle.checked);
    });
    const colliderText = document.createElement('span');
    colliderText.textContent = world.colliderAvailable
      ? 'SHOW WORLD LABS COLLIDER'
      : 'SHOW WORLD LABS COLLIDER — UNAVAILABLE';
    colliderLabel.append(colliderToggle, colliderText);

    this.output.className = 'transform-output';
    this.output.textContent = 'Transforms will appear here.';

    this.dock.body.append(
      worldBadge,
      countRow,
      selectedRow,
      shortcutHint,
      actions,
      colliderLabel,
      this.output,
    );
  }

  setAssetCount(loaded: number, total: number): void {
    this.assetCount.textContent = `${loaded} / ${total}`;
  }

  setSelection(id: string | null, root: Group | null): void {
    this.selectedId = id;
    this.selectedRoot = root;
    this.selectedValue.textContent = id ?? 'None';
    this.copyButton.disabled = root === null;
    this.deselectButton.disabled = root === null;
  }

  setDeselectHandler(handler: () => void): void {
    this.deselectHandler = handler;
  }

  dispose(): void {
    this.copyButton.removeEventListener('click', this.copyTransform);
    this.deselectButton.removeEventListener('click', this.deselect);
    this.dock.dispose();
  }

  private readonly copyTransform = (): void => {
    if (!this.selectedId || !this.selectedRoot) {
      return;
    }

    const snippet = serializeAssetTransform(
      this.selectedId,
      this.selectedRoot,
    );
    this.output.textContent = snippet;
    console.info(`[placement] Selected transform:\n${snippet}`);

    if (!navigator.clipboard) {
      console.warn(
        '[placement] Clipboard API is unavailable. The exact transform is shown in the panel and console.',
      );
      return;
    }

    void navigator.clipboard.writeText(snippet).catch((error: unknown) => {
      console.warn(
        '[placement] Clipboard write failed. The exact transform is shown in the panel and console.',
        error,
      );
    });
  };

  private readonly printAllTransforms = (): void => {
    const serialized = serializeLevelTransforms(this.registry);
    this.output.textContent = serialized;
    console.info(`[placement] All loaded level transforms:\n${serialized}`);
  };

  private readonly deselect = (): void => {
    this.deselectHandler?.();
  };
}

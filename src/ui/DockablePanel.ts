export type DockMode =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'float';

interface DockInsets {
  x?: number;
  y?: number;
}

interface StoredDockLayout {
  mode: DockMode;
  collapsed: boolean;
  x: number;
  y: number;
}

export interface DockablePanelOptions {
  id: string;
  title: string;
  host: HTMLElement;
  defaultMode?: DockMode;
  defaultCollapsed?: boolean;
  defaultX?: number;
  defaultY?: number;
  className?: string;
  collapsedClass?: string;
  ariaLabel?: string;
  variant?: 'standard' | 'ops';
  fillHeight?: boolean;
  persist?: boolean;
  extraInsets?: DockInsets;
  zBase?: number;
  useCollapsedSlot?: boolean;
}

const STORAGE_KEY = 'moontology.dock-layout.v1';
const MARGIN = 16;
const SNAP_DISTANCE = 88;
const DOCK_MODES: readonly Exclude<DockMode, 'float'>[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

const registry = new Set<DockablePanel>();
let zCounter = 40;
let snapOverlay: HTMLElement | null = null;
let resizeBound = false;

const loadStore = (): Record<string, StoredDockLayout> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as Record<string, StoredDockLayout>;
  } catch {
    return {};
  }
};

const saveStore = (store: Record<string, StoredDockLayout>): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or quota errors should not break the scene.
  }
};

const ensureSnapOverlay = (): HTMLElement => {
  if (snapOverlay) {
    return snapOverlay;
  }
  snapOverlay = document.createElement('div');
  snapOverlay.className = 'dock-snap-overlay';
  snapOverlay.hidden = true;
  snapOverlay.innerHTML = DOCK_MODES.map(
    (mode) => `<div class="dock-snap-overlay__zone" data-corner="${mode}"></div>`,
  ).join('');
  document.body.append(snapOverlay);
  return snapOverlay;
};

const cornerFromPointer = (clientX: number, clientY: number): DockMode | null => {
  const nearLeft = clientX <= SNAP_DISTANCE;
  const nearRight = clientX >= window.innerWidth - SNAP_DISTANCE;
  const nearTop = clientY <= SNAP_DISTANCE;
  const nearBottom = clientY >= window.innerHeight - SNAP_DISTANCE;
  if (nearLeft && nearTop) {
    return 'top-left';
  }
  if (nearRight && nearTop) {
    return 'top-right';
  }
  if (nearLeft && nearBottom) {
    return 'bottom-left';
  }
  if (nearRight && nearBottom) {
    return 'bottom-right';
  }
  return null;
};

const reflowCollapsedDocks = (): void => {
  const groups = new Map<Exclude<DockMode, 'float'>, DockablePanel[]>();
  for (const panel of registry) {
    if (!panel.isCollapsed || panel.mode === 'float') {
      panel.setStackOffset(0);
      continue;
    }
    const list = groups.get(panel.mode) ?? [];
    list.push(panel);
    groups.set(panel.mode, list);
  }
  for (const [mode, list] of groups) {
    let offset = 0;
    for (const panel of list) {
      panel.setStackOffset(offset);
      const rect = panel.root.getBoundingClientRect();
      const size = mode.startsWith('top') || mode.startsWith('bottom')
        ? rect.height
        : rect.width;
      offset += Math.max(36, size) + 8;
    }
  }
};

const bindResizeListener = (): void => {
  if (resizeBound) {
    return;
  }
  resizeBound = true;
  window.addEventListener('resize', () => {
    for (const panel of registry) {
      panel.handleViewportResize();
    }
    reflowCollapsedDocks();
  });
};

export class DockablePanel {
  readonly root = document.createElement('aside');
  readonly body = document.createElement('div');
  readonly collapsedHost = document.createElement('div');
  readonly id: string;
  private readonly title: string;
  private readonly persist: boolean;
  private readonly fillHeight: boolean;
  private readonly extraInsets: DockInsets;
  private readonly collapsedClass: string | undefined;
  private readonly useCollapsedSlot: boolean;
  private readonly chrome = document.createElement('header');
  private readonly collapseButton = document.createElement('button');
  private readonly dockButtons = new Map<Exclude<DockMode, 'float'>, HTMLButtonElement>();
  private readonly listeners = new Set<() => void>();
  private collapsed: boolean;
  private currentMode: DockMode;
  private x: number;
  private y: number;
  private stackOffset = 0;
  private dragging = false;
  private moved = false;
  private dragGrabX = 0;
  private dragGrabY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private snapTarget: DockMode | null = null;

  constructor(options: DockablePanelOptions) {
    this.id = options.id;
    this.title = options.title;
    this.persist = options.persist !== false;
    this.fillHeight = options.fillHeight === true;
    this.extraInsets = options.extraInsets ?? {};
    this.collapsedClass = options.collapsedClass;
    this.useCollapsedSlot = options.useCollapsedSlot === true;
    this.collapsed = options.defaultCollapsed === true;
    this.currentMode = options.defaultMode ?? 'top-left';
    this.x = options.defaultX ?? MARGIN;
    this.y = options.defaultY ?? MARGIN;

    const stored = this.persist ? loadStore()[this.id] : undefined;
    if (stored && this.isDockMode(stored.mode)) {
      this.currentMode = stored.mode;
      this.collapsed = stored.collapsed;
      this.x = stored.x;
      this.y = stored.y;
    }

    this.root.className = ['dock-panel', 'glass-surface', options.className]
      .filter(Boolean)
      .join(' ');
    if (options.variant === 'ops') {
      this.root.classList.add('dock-panel--ops');
    }
    this.root.dataset.dockId = this.id;
    this.root.style.zIndex = String(options.zBase ?? 20);
    this.root.setAttribute(
      'aria-label',
      options.ariaLabel ?? options.title,
    );

    this.chrome.className = 'dock-panel__chrome';
    const grip = document.createElement('span');
    grip.className = 'dock-panel__grip';
    grip.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 6; index += 1) {
      grip.append(document.createElement('i'));
    }
    const title = document.createElement('span');
    title.className = 'dock-panel__title';
    title.textContent = options.title;
    const docks = document.createElement('div');
    docks.className = 'dock-panel__docks';
    docks.setAttribute('role', 'group');
    docks.setAttribute('aria-label', 'Dock position');
    this.chrome.append(grip, title, docks);
    for (const mode of DOCK_MODES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dock-panel__dock';
      button.dataset.mode = mode;
      button.title = `Dock ${mode.replaceAll('-', ' ')}`;
      button.setAttribute('aria-label', `Dock ${mode.replaceAll('-', ' ')}`);
      button.addEventListener('click', () => {
        this.setMode(mode);
      });
      this.dockButtons.set(mode, button);
      docks.append(button);
    }

    this.collapseButton.type = 'button';
    this.collapseButton.className = 'dock-panel__collapse';
    this.collapseButton.addEventListener('click', this.toggleCollapsed);
    this.chrome.append(this.collapseButton);

    this.body.className = 'dock-panel__body';
    this.collapsedHost.className = 'dock-panel__collapsed';

    this.root.append(this.chrome, this.body, this.collapsedHost);
    options.host.append(this.root);

    this.chrome.addEventListener('pointerdown', this.handlePointerDown);
    this.collapsedHost.addEventListener('pointerdown', this.handlePointerDown);
    this.root.addEventListener('pointerdown', this.bringToFront);
    this.chrome.addEventListener('dblclick', this.handleChromeDoubleClick);

    registry.add(this);
    bindResizeListener();
    this.applyLayout();
    reflowCollapsedDocks();
    this.bringToFront();
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  get mode(): DockMode {
    return this.currentMode;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) {
      return;
    }
    this.collapsed = collapsed;
    this.applyLayout();
    reflowCollapsedDocks();
    this.persistLayout();
    this.emit();
  }

  setMode(mode: DockMode): void {
    this.currentMode = mode;
    if (mode !== 'float') {
      const rect = this.root.getBoundingClientRect();
      this.x = rect.left;
      this.y = rect.top;
    }
    this.applyLayout();
    reflowCollapsedDocks();
    this.persistLayout();
    this.emit();
  }

  setStackOffset(offset: number): void {
    if (this.stackOffset === offset) {
      return;
    }
    this.stackOffset = offset;
    this.applyLayout();
  }

  handleViewportResize(): void {
    if (this.currentMode === 'float') {
      this.clampFloat();
      this.applyLayout();
    }
  }

  dispose(): void {
    registry.delete(this);
    this.chrome.removeEventListener('pointerdown', this.handlePointerDown);
    this.collapsedHost.removeEventListener('pointerdown', this.handlePointerDown);
    this.root.removeEventListener('pointerdown', this.bringToFront);
    this.chrome.removeEventListener('dblclick', this.handleChromeDoubleClick);
    this.collapseButton.removeEventListener('click', this.toggleCollapsed);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.root.remove();
    reflowCollapsedDocks();
  }

  private readonly toggleCollapsed = (event?: Event): void => {
    event?.preventDefault();
    this.setCollapsed(!this.collapsed);
  };

  private readonly handleChromeDoubleClick = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('button')) {
      return;
    }
    this.toggleCollapsed(event);
  };

  private readonly bringToFront = (): void => {
    zCounter += 1;
    this.root.style.zIndex = String(zCounter);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button, a, input, select, textarea, label, [data-no-drag]')
    ) {
      return;
    }
    const rect = this.root.getBoundingClientRect();
    this.dragging = true;
    this.moved = false;
    this.dragGrabX = event.clientX - rect.left;
    this.dragGrabY = event.clientY - rect.top;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.root.classList.add('is-dragging');
    this.bringToFront();
    ensureSnapOverlay().hidden = false;
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    if (
      !this.moved &&
      Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY) < 5
    ) {
      return;
    }
    this.moved = true;
    this.currentMode = 'float';
    this.x = event.clientX - this.dragGrabX;
    this.y = event.clientY - this.dragGrabY;
    this.clampFloat();
    this.snapTarget = cornerFromPointer(event.clientX, event.clientY);
    this.updateSnapOverlay();
    this.applyLayout();
  };

  private readonly handlePointerUp = (): void => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.root.classList.remove('is-dragging');
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    if (this.snapTarget) {
      this.currentMode = this.snapTarget;
      this.snapTarget = null;
    }
    const overlay = ensureSnapOverlay();
    overlay.hidden = true;
    overlay.querySelectorAll('.is-active').forEach((node) => {
      node.classList.remove('is-active');
    });
    this.applyLayout();
    reflowCollapsedDocks();
    if (this.moved) {
      this.persistLayout();
    }
  };

  private applyLayout(): void {
    const extraX = this.collapsed ? 0 : (this.extraInsets.x ?? 0);
    const extraY = this.collapsed ? 0 : (this.extraInsets.y ?? 0);
    const fill = this.fillHeight && !this.collapsed;
    const rootStyle = this.root.style;

    rootStyle.left = 'auto';
    rootStyle.right = 'auto';
    rootStyle.top = 'auto';
    rootStyle.bottom = 'auto';
    rootStyle.height = '';

    if (this.currentMode === 'float') {
      rootStyle.left = `${this.x}px`;
      rootStyle.top = `${this.y}px`;
      if (fill) {
        rootStyle.height = `${Math.max(240, window.innerHeight - this.y - MARGIN)}px`;
      }
    } else {
      const isLeft = this.currentMode.endsWith('left');
      const isTop = this.currentMode.startsWith('top');
      if (isLeft) {
        rootStyle.left = `${MARGIN + extraX}px`;
      } else {
        rootStyle.right = `${MARGIN + extraX}px`;
      }
      if (fill) {
        rootStyle.top = `${MARGIN}px`;
        rootStyle.bottom = `${MARGIN}px`;
      } else if (isTop) {
        rootStyle.top = `${MARGIN + extraY + this.stackOffset}px`;
      } else {
        rootStyle.bottom = `${MARGIN + extraY + this.stackOffset}px`;
      }
    }

    this.root.dataset.mode = this.currentMode;
    this.root.classList.toggle('dock-panel--collapsed', this.collapsed);
    this.root.classList.toggle('dock-panel--fill', fill);
    if (this.collapsedClass) {
      this.root.classList.toggle(this.collapsedClass, this.collapsed);
    }
    this.root.setAttribute('aria-expanded', String(!this.collapsed));
    this.body.hidden = this.collapsed;
    this.collapsedHost.hidden = !this.collapsed || !this.useCollapsedSlot;
    this.collapseButton.setAttribute(
      'aria-label',
      this.collapsed ? `Expand ${this.title}` : `Collapse ${this.title}`,
    );
    this.collapseButton.title = this.collapsed ? 'Expand' : 'Collapse';
    this.collapseButton.textContent = this.collapsed ? '□' : '–';
    for (const [mode, button] of this.dockButtons) {
      button.classList.toggle('is-active', mode === this.currentMode);
    }
  }

  private clampFloat(): void {
    const width = Math.min(this.root.offsetWidth || 280, window.innerWidth - 16);
    const height = Math.min(this.root.offsetHeight || 48, window.innerHeight - 16);
    this.x = Math.min(Math.max(8, this.x), Math.max(8, window.innerWidth - width - 8));
    this.y = Math.min(Math.max(8, this.y), Math.max(8, window.innerHeight - height - 8));
  }

  private updateSnapOverlay(): void {
    const overlay = ensureSnapOverlay();
    overlay.querySelectorAll('[data-corner]').forEach((node) => {
      node.classList.toggle(
        'is-active',
        node instanceof HTMLElement && node.dataset.corner === this.snapTarget,
      );
    });
  }

  private persistLayout(): void {
    if (!this.persist) {
      return;
    }
    const store = loadStore();
    store[this.id] = {
      mode: this.currentMode,
      collapsed: this.collapsed,
      x: this.x,
      y: this.y,
    };
    saveStore(store);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private isDockMode(value: string): value is DockMode {
    return (
      value === 'float' ||
      value === 'top-left' ||
      value === 'top-right' ||
      value === 'bottom-left' ||
      value === 'bottom-right'
    );
  }
}

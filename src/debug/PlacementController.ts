import {
  Group,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { AssetRegistry } from '../assets/AssetRegistry';

interface PointerStart {
  x: number;
  y: number;
  startedOnGizmo: boolean;
}

type SelectionListener = (id: string | null, root: Group | null) => void;

export class PlacementController {
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly orbitControls: OrbitControls;
  private readonly registry: AssetRegistry;
  private readonly onSelectionChange: SelectionListener;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly transformControls: TransformControls;
  private readonly transformHelper: Object3D;
  private pointerStart: PointerStart | null = null;
  private selectedRoot: Group | null = null;
  private enabled = true;

  constructor(
    camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
    orbitControls: OrbitControls,
    debugLayer: Group,
    registry: AssetRegistry,
    onSelectionChange: SelectionListener,
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.orbitControls = orbitControls;
    this.registry = registry;
    this.onSelectionChange = onSelectionChange;

    this.transformControls = new TransformControls(camera, canvas);
    this.transformControls.setMode('translate');
    this.transformControls.setSize(0.85);

    this.transformHelper = this.transformControls.getHelper();
    this.transformHelper.name = 'placement-transform-helper';
    debugLayer.add(this.transformHelper);

    this.transformControls.addEventListener(
      'dragging-changed',
      this.handleDraggingChanged,
    );
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  get selected(): Group | null {
    return this.selectedRoot;
  }

  select(id: string): boolean {
    const asset = this.registry.get(id);
    if (!asset || !asset.root.visible) {
      return false;
    }

    this.selectRoot(asset.root);
    return true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.pointerStart = null;
    this.transformControls.enabled = enabled;
    this.transformHelper.visible = enabled;
  }

  deselect = (): void => {
    this.selectedRoot = null;
    this.transformControls.detach();
    this.onSelectionChange(null, null);
  };

  dispose(): void {
    this.deselect();
    this.transformControls.removeEventListener(
      'dragging-changed',
      this.handleDraggingChanged,
    );
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.transformHelper.removeFromParent();
    this.transformControls.dispose();
  }

  private readonly handleDraggingChanged = (): void => {
    if (!this.enabled) {
      return;
    }
    this.orbitControls.enabled = !this.transformControls.dragging;
    if (this.transformControls.dragging && this.pointerStart) {
      this.pointerStart.startedOnGizmo = true;
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) {
      return;
    }

    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      startedOnGizmo:
        this.transformControls.axis !== null ||
        this.transformControls.dragging,
    };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.enabled) {
      this.pointerStart = null;
      return;
    }

    const start = this.pointerStart;
    this.pointerStart = null;

    if (!start || event.button !== 0 || start.startedOnGizmo) {
      return;
    }

    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
      return;
    }

    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.intersectObjects(
      this.registry.getRaycastRoots(),
      true,
    )[0];

    if (!hit) {
      this.deselect();
      return;
    }

    const root = this.registry.resolveRoot(hit.object);
    if (!root) {
      this.deselect();
      return;
    }

    this.selectRoot(root);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      !this.enabled ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      this.isEditableTarget(event.target)
    ) {
      return;
    }

    const modes = {
      w: 'translate',
      e: 'rotate',
      r: 'scale',
    } as const;
    const mode = modes[event.key.toLowerCase() as keyof typeof modes];
    if (!mode) {
      return;
    }

    event.preventDefault();
    this.transformControls.setMode(mode);
  };

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );
  }

  private selectRoot(root: Group): void {
    this.selectedRoot = root;
    this.transformControls.attach(root);
    const id =
      typeof root.userData.levelAssetId === 'string'
        ? root.userData.levelAssetId
        : root.name;
    this.onSelectionChange(id, root);
  }
}

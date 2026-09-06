import { MOBILE } from '../runtime/deviceProfile';
import { Go2FollowCamera } from './Go2FollowCamera';
import {
  PerspectiveCamera,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ControlModes,
  MOONTOLOGY_CONFIG,
  type ControlMode,
} from '../config/moontologyConfig';
import type { PlacementController } from '../debug/PlacementController';
import type { ManualGo2Controller } from '../go2/ManualGo2Controller';
import { DockablePanel } from '../ui/DockablePanel';

interface MoonControlSystemOptions {
  host: HTMLElement;
  showUi?: boolean;
  camera: PerspectiveCamera;
  go2Root: Object3D;
  orbitControls: OrbitControls;
  robotController: ManualGo2Controller;
  placementController: PlacementController | null;
  requestKeyboardDemo?: () => string | null;
}

export class MoonControlSystem {
  private readonly dock: DockablePanel | null;
  private readonly robotButton = this.createButton('FOLLOW GO2');
  private readonly cameraButton = this.createButton('FREE CAMERA');
  private readonly mapButton: HTMLButtonElement | null;
  private readonly recenterButton = this.createButton('RECENTER');
  private readonly modeValue = document.createElement('span');
  private readonly keyboardStatus = document.createElement('p');
  private readonly keyboardButton = this.createButton('USE KEYBOARD DEMO');
  private readonly requestKeyboardDemo?: () => string | null;
  private keyboardBlock: string | null | undefined;
  private readonly camera: PerspectiveCamera;
  private readonly go2Root: Object3D;
  private readonly orbitControls: OrbitControls;
  private readonly robotController: ManualGo2Controller;
  private readonly placementController: PlacementController | null;
  private readonly followCamera: Go2FollowCamera;
  private mode: ControlMode = MOONTOLOGY_CONFIG.controls.defaultMode;

  constructor({
    host,
    showUi = true,
    camera,
    go2Root,
    orbitControls,
    robotController,
    placementController,
    requestKeyboardDemo,
  }: MoonControlSystemOptions) {
    this.camera = camera;
    this.followCamera = new Go2FollowCamera(camera, go2Root);
    this.go2Root = go2Root;
    this.orbitControls = orbitControls;
    this.robotController = robotController;
    this.placementController = placementController;
    this.requestKeyboardDemo = requestKeyboardDemo;
    if (this.orbitControls.domElement) this.orbitControls.domElement.tabIndex = 0;
    this.mapButton = placementController
      ? this.createButton('MAP EDIT')
      : null;

    if (showUi) {
      this.dock = new DockablePanel({
        id: 'moon-controls',
        title: 'CONTROLS',
        host,
        className: 'moon-control-switcher',
        ariaLabel: 'Moontology control mode',
        defaultMode: 'bottom-right',
        defaultCollapsed: false,
        persist: false,
      });

      const modeRow = document.createElement('div');
      modeRow.className = 'moon-control-switcher__mode';
      modeRow.append('ACTIVE: ', this.modeValue);

      const buttons = document.createElement('div');
      buttons.className = 'moon-control-switcher__buttons';
      buttons.append(this.robotButton, this.cameraButton);
      if (this.mapButton) {
        buttons.append(this.mapButton, this.recenterButton);
      }
      this.dock.body.append(modeRow, buttons);
      this.keyboardStatus.className = 'moon-control-switcher__keyboard-status';
      this.keyboardStatus.setAttribute('role', 'status');
      this.keyboardButton.hidden = true;
      this.keyboardButton.title = 'Virtual map only. Physical motion remains disarmed.';
      this.dock.body.append(this.keyboardStatus, this.keyboardButton);
      this.keyboardButton.addEventListener('click', this.activateKeyboardDemo);
      if (MOBILE && import.meta.env.MODE === 'public') {
        const pad = document.createElement('div');
        pad.className = 'mobile-movement-pad';
        for (const [code, label, symbol] of [
          ['ArrowLeft', 'Turn Go2 left', '↶'], ['ArrowUp', 'Move Go2 forward', '↑'],
          ['ArrowDown', 'Move Go2 backward', '↓'], ['ArrowRight', 'Turn Go2 right', '↷'],
        ]) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = symbol; button.setAttribute('aria-label', label);
          button.onpointerdown = event => {
            event.preventDefault(); button.setPointerCapture(event.pointerId);
            this.robotController.setTouchInput(code, true);
          };
          const release = () => this.robotController.setTouchInput(code, false);
          button.onpointerup = release; button.onpointercancel = release; button.onlostpointercapture = release;
          pad.append(button);
        }
        this.dock.body.append(pad);
      }

      this.robotButton.addEventListener('click', this.activateRobot);
      this.cameraButton.addEventListener('click', this.activateCamera);
      this.mapButton?.addEventListener('click', this.activateMapEdit);
      if (this.mapButton) {
        this.recenterButton.addEventListener('click', this.recenter);
      }
    } else {
      this.dock = null;
    }

    this.setMode(this.mode);
    this.setKeyboardBlock(null, false);
  }

  setKeyboardBlock(reason: string | null, canReturnToDemo: boolean): void {
    if (reason !== this.keyboardBlock) {
      this.keyboardBlock = reason;
      this.keyboardStatus.textContent = reason ?? (MOBILE && import.meta.env.MODE === 'public' ? 'Hold arrows to walk · Free Camera to explore.' : 'Arrow keys / WASD: move and turn in Follow Go2.');
    }
    this.keyboardButton.hidden = !canReturnToDemo || !this.requestKeyboardDemo;
  }

  setMode(mode: ControlMode): void {
    if (
      mode !== ControlModes.ROBOT &&
      mode !== ControlModes.CAMERA &&
      mode !== ControlModes.MAP_EDIT
    ) {
      console.warn(`[Controls] Invalid mode: ${String(mode)}`);
      return;
    }
    if (mode === ControlModes.MAP_EDIT && !this.placementController) {
      console.warn('[Controls] MAP_EDIT is unavailable.');
      return;
    }

    this.mode = mode;
    this.robotController.setEnabled(mode === ControlModes.ROBOT);
    this.placementController?.setEnabled(
      mode === ControlModes.MAP_EDIT,
    );
    this.orbitControls.enabled =
      mode === ControlModes.CAMERA || mode === ControlModes.MAP_EDIT;

    this.modeValue.textContent = mode;
    this.updateButtonState(this.robotButton, mode === ControlModes.ROBOT);
    this.updateButtonState(this.cameraButton, mode === ControlModes.CAMERA);
    if (this.mapButton) {
      this.updateButtonState(
        this.mapButton,
        mode === ControlModes.MAP_EDIT,
      );
    }
    if (mode === ControlModes.ROBOT) this.update(0, true);
    console.info(`[Controls] Mode → ${mode}`);
  }

  update(dt: number, snap = false): void {
    if (this.mode !== ControlModes.ROBOT) return;
    this.followCamera.update(dt, snap);
    this.orbitControls.target.copy(this.followCamera.target);
  }

  dispose(): void {
    this.robotController.setEnabled(false);
    this.placementController?.setEnabled(false);
    this.robotButton.removeEventListener('click', this.activateRobot);
    this.keyboardButton.removeEventListener('click', this.activateKeyboardDemo);
    this.cameraButton.removeEventListener('click', this.activateCamera);
    this.mapButton?.removeEventListener('click', this.activateMapEdit);
    this.recenterButton.removeEventListener('click', this.recenter);
    this.dock?.dispose();
  }

  private readonly activateRobot = (): void => {
    this.setMode(ControlModes.ROBOT);
    this.orbitControls.domElement?.focus({ preventScroll: true });
  };

  private readonly activateKeyboardDemo = (): void => {
    const error = this.requestKeyboardDemo?.();
    if (error) { this.keyboardStatus.textContent = error; return; }
    this.setKeyboardBlock(null, false);
    this.activateRobot();
  };

  private readonly activateCamera = (): void => {
    this.setMode(ControlModes.CAMERA);
  };

  private readonly activateMapEdit = (): void => {
    this.setMode(ControlModes.MAP_EDIT);
  };

  recenterOnGo2(): void {
    this.followCamera.update(0, true);
    this.orbitControls.target.copy(this.followCamera.target);
  }

  setInteriorCamera(interior: boolean): void {
    this.followCamera.setInterior(interior);
  }

  private readonly recenter = (): void => {
    const robotPosition = this.go2Root.getWorldPosition(new Vector3());
    const robotRotation = this.go2Root.getWorldQuaternion(new Quaternion());
    // Go2 travels along local +X, while camera offsets use conventional
    // camera coordinates where negative Z means behind the subject.
    const offset = new Vector3(
      MOONTOLOGY_CONFIG.controls.cameraOffset.z,
      MOONTOLOGY_CONFIG.controls.cameraOffset.y,
      MOONTOLOGY_CONFIG.controls.cameraOffset.x,
    ).applyQuaternion(robotRotation);

    this.camera.position.copy(robotPosition).add(offset);
    const lookTarget = robotPosition.clone();
    lookTarget.y += MOONTOLOGY_CONFIG.controls.lookTargetHeight;
    this.camera.lookAt(lookTarget);
    this.orbitControls.target.copy(lookTarget);
    this.orbitControls.update();
    console.info('[Camera] Recentered on Go2.');
  };

  private createButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    return button;
  }

  private updateButtonState(
    button: HTMLButtonElement,
    active: boolean,
  ): void {
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

import type {
  Go2Controller,
  Go2MotionTarget,
} from './Go2Controller';

const movementKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyS',
  'KeyA',
  'KeyD',
]);

export class ManualGo2Controller implements Go2Controller {
  private readonly pressed = new Set<string>();
  private readonly moveSpeed: number;
  private readonly turnSpeed: number;
  private enabled = true;
  private externalControlActive = false;

  constructor(moveSpeed = 0.8, turnSpeed = 1.6) {
    this.moveSpeed = moveSpeed;
    this.turnSpeed = turnSpeed;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clear);
  }

  update(deltaSeconds: number, target: Go2MotionTarget): void {
    if (!this.enabled || this.externalControlActive) {
      return;
    }

    const moveInput =
      Number(this.pressed.has('ArrowUp') || this.pressed.has('KeyW')) -
      Number(this.pressed.has('ArrowDown') || this.pressed.has('KeyS'));
    const turnInput =
      Number(this.pressed.has('ArrowLeft') || this.pressed.has('KeyA')) -
      Number(this.pressed.has('ArrowRight') || this.pressed.has('KeyD'));

    if (turnInput !== 0) {
      target.rotateYaw(turnInput * this.turnSpeed * deltaSeconds);
    }
    if (moveInput !== 0) {
      target.moveForward(moveInput * this.moveSpeed * deltaSeconds);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled || this.externalControlActive) {
      this.clear();
    }
  }

  setExternalControlActive(active: boolean): void {
    this.externalControlActive = active;
    if (active) {
      this.clear();
    }
  }

  dispose(): void {
    this.clear();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.clear);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      !this.enabled ||
      this.externalControlActive ||
      !movementKeys.has(event.code) ||
      this.isEditableTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    this.pressed.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!movementKeys.has(event.code)) {
      return;
    }

    this.pressed.delete(event.code);
  };

  private readonly clear = (): void => {
    this.pressed.clear();
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
}

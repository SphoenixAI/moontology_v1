import { MOBILE, mobileBudget } from './deviceProfile';
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import {
  MOONTOLOGY_CONFIG,
  PerformanceModes,
  type PerformanceMode,
} from '../config/moontologyConfig';

type FrameCallback = (time: number) => void;

const activeRenderers = new WeakSet<WebGLRenderer>();

declare global {
  interface Window {
    __moontologyRenderLoopActive?: boolean;
  }
}

export class PerformanceGovernor {
  private readonly renderer: WebGLRenderer;
  private readonly camera: PerspectiveCamera;
  private mode: PerformanceMode = MOONTOLOGY_CONFIG.performance.mode;
  private suspended = false;
  private visible = !document.hidden;
  private lastFrameTime = 0;
  private started = false;

  constructor(renderer: WebGLRenderer, camera: PerspectiveCamera) {
    this.renderer = renderer;
    this.camera = camera;
    this.applyMode();

    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  setSuspended(suspended: boolean): void { this.suspended = suspended; this.lastFrameTime = 0; }

  get currentMode(): PerformanceMode {
    return this.mode;
  }

  start(frame: FrameCallback): boolean {
    if (
      this.started ||
      activeRenderers.has(this.renderer) ||
      window.__moontologyRenderLoopActive
    ) {
      console.warn('[RenderLoop] BLOCKED duplicate render loop.');
      return false;
    }

    this.started = true;
    activeRenderers.add(this.renderer);
    window.__moontologyRenderLoopActive = true;
    console.info('[RenderLoop] Starting single Moon render loop.');
    this.renderer.setAnimationLoop((time) => {
      if (this.shouldRender(time)) {
        frame(time);
      }
    });
    return true;
  }

  setMode(mode: PerformanceMode): void {
    if (mode !== PerformanceModes.DEV && mode !== PerformanceModes.DEMO) {
      console.warn(`[Performance] Invalid mode: ${String(mode)}`);
      return;
    }

    this.mode = mode;
    this.lastFrameTime = 0;
    this.applyMode();
  }

  dispose(): void {
    if (this.started) {
      this.renderer.setAnimationLoop(null);
      activeRenderers.delete(this.renderer);
      window.__moontologyRenderLoopActive = false;
      this.started = false;
    }
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  private shouldRender(time: number): boolean {
    if (
      MOONTOLOGY_CONFIG.performance.pauseWhenHidden &&
      !this.visible
    ) {
      return false;
    }

    if (this.suspended) return false;
    const targetFps = this.targetFps;
    const frameInterval = 1000 / targetFps;
    const elapsed = time - this.lastFrameTime;
    if (this.lastFrameTime !== 0 && elapsed < frameInterval) {
      return false;
    }

    this.lastFrameTime = time - (elapsed % frameInterval);
    return true;
  }

  private applyMode(): void {
    const pixelRatio = (MOBILE ? mobileBudget.pixelRatio : window.devicePixelRatio || 1);

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled =
      MOONTOLOGY_CONFIG.performance.shadows;

    console.info(
      `[Performance] ${this.mode} MODE — ${this.targetFps} FPS, pixel ratio ${pixelRatio}x, shadows ${this.renderer.shadowMap.enabled ? 'on' : 'off'}`,
    );
  }

  private get targetFps(): number {
    if (MOBILE) return mobileBudget.fps;
    return this.mode === PerformanceModes.DEV
      ? MOONTOLOGY_CONFIG.performance.devFPS
      : MOONTOLOGY_CONFIG.performance.demoFPS;
  }

  private readonly resize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio((MOBILE ? mobileBudget.pixelRatio : window.devicePixelRatio || 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  private readonly handleVisibility = (): void => {
    this.visible = !document.hidden;
    this.lastFrameTime = 0;
    console.info(
      this.visible
        ? '[Performance] Tab visible — rendering active'
        : '[Performance] Tab hidden — rendering paused',
    );
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      event.code !== 'KeyP' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      this.isEditableTarget(event.target)
    ) {
      return;
    }

    this.setMode(
      this.mode === PerformanceModes.DEV
        ? PerformanceModes.DEMO
        : PerformanceModes.DEV,
    );
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

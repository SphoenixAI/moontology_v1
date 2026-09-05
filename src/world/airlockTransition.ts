import {
  Vector3,
  type Box3,
  type Object3D,
  type Scene,
} from 'three';
import {
  applyRobotSpawn,
  applyWorldCalibration,
  type SceneRobotCalibration,
} from '../levels/sceneRobotCalibration';
import type { StaticSceneRuntimeApi } from '../static-assets/StaticAssetSystem';
import type { WorldHandle } from './loadWorld';

export type SceneTransitionState =
  | 'scene1'
  | 'opening'
  | 'entering'
  | 'loading'
  | 'scene2'
  | 'error';

export interface AirlockTransitionOptions {
  scene: Scene;
  go2Root: Object3D;
  airlockAnchor?: Object3D | null;
  approachTrigger: Box3;
  approachTriggerLocal?: Box3;
  thresholdTrigger: Box3;
  thresholdTriggerLocal?: Box3;
  airlock?: StaticSceneRuntimeApi;
  getScene1World: () => WorldHandle | null;
  clearScene1World: () => void;
  loadWorldLabsWorld: (url: string) => Promise<WorldHandle>;
  scene2Url: string;
  scene2Calibration: SceneRobotCalibration;
  onScene2World: (world: WorldHandle) => void;
  activateScene2World?: () => void;
  canTrigger?: () => boolean;
  loadTimeoutMs?: number;
  onGo2Moved?: () => void;
  onEnteredScene2?: () => void;
  hideScene1Actors?: () => void;
  initializeScene2Humanoids?: () => void;
}

export class AirlockTransitionController {
  private state: SceneTransitionState = 'scene1';
  private approachReached = false;
  private transitionStarted = false;
  private worldLoadStarted = false;
  private disposed = false;
  private delayId: number | null = null;
  private watchdogId: number | null = null;
  private worldLoadPromise: Promise<void> | null = null;
  private readonly go2WorldPosition = new Vector3();
  private readonly go2AnchorPosition = new Vector3();
  private readonly options: AirlockTransitionOptions;

  constructor(options: AirlockTransitionOptions) {
    this.options = options;
    this.ensureFadeOverlay();
  }

  public getState(): SceneTransitionState {
    return this.state;
  }

  /**
   * Call once per animation frame. Trigger checks use Go2's authoritative root.
   */
  public update(): void {
    if (
      this.disposed || this.options.canTrigger?.() === false ||
      this.transitionStarted ||
      this.state === 'loading' ||
      this.state === 'scene2'
    ) {
      return;
    }

    this.options.go2Root.getWorldPosition(this.go2WorldPosition);
    if (this.state === 'error') {
      // Require leaving the doorway before retrying a failed world request.
      if (!this.containsTrigger(this.options.thresholdTrigger, this.options.thresholdTriggerLocal)) {
        this.state = 'scene1';
        this.approachReached = false;
      }
      return;
    }

    if (
      !this.approachReached &&
      this.containsTrigger(
        this.options.approachTrigger,
        this.options.approachTriggerLocal,
      )
    ) {
      this.reachApproach();
    }

    if (
      this.containsTrigger(
        this.options.thresholdTrigger,
        this.options.thresholdTriggerLocal,
      )
    ) {
      if (!this.approachReached) {
        this.reachApproach();
      }
      console.log('[AIRLOCK] threshold crossed');
      this.requestWorld2Transition();
    }
  }

  public enterScene2(): void {
    // External map interactions obey the same doorway and safety checks as walking.
    this.update();
  }

  private reachApproach(): void {
    this.approachReached = true;
    this.state = 'opening';
    console.log('[AIRLOCK] approach reached');
    console.log('[AIRLOCK] opening facade door');
    try {
      this.options.airlock?.openAirlock();
    } catch (error) {
      console.warn('[AIRLOCK] visual animation failed', error);
    }
  }

  private requestWorld2Transition(): void {
    if (this.disposed || this.transitionStarted || this.state === 'scene2') {
      return;
    }

    this.transitionStarted = true;
    this.state = 'entering';
    console.log('[WORLD2] transition requested');

    this.watchdogId = window.setTimeout(() => {
      if (this.worldLoadStarted) {
        return;
      }
      console.warn('[AIRLOCK] watchdog forcing World 2 transition');
      void this.startWorld2Load();
    }, 1500);

    this.delayId = window.setTimeout(() => {
      this.delayId = null;
      void this.startWorld2Load();
    }, 400);
  }

  private startWorld2Load(): Promise<void> {
    if (this.worldLoadPromise) {
      return this.worldLoadPromise;
    }

    if (this.disposed) return Promise.resolve();
    this.worldLoadStarted = true;
    this.clearWatchdog();
    if (this.delayId !== null) window.clearTimeout(this.delayId);
    this.delayId = null;
    this.worldLoadPromise = this.performWorld2Transition().catch(
      async (error: unknown) => {
        if (this.disposed) return;
        this.state = 'error';
        console.error('[WORLD2] transition failed', error);
        await fadeOutSafely();
        this.transitionStarted = false;
        this.worldLoadStarted = false;
        this.worldLoadPromise = null;
      },
    );
    return this.worldLoadPromise;
  }

  private async performWorld2Transition(): Promise<void> {
    this.state = 'loading';
    await fadeInSafely();
    if (this.disposed) return;
    console.log('[WORLD2] loading');

    const scene1World = this.options.getScene1World();
    let expired = false;
    let timeout: number | undefined;
    const pending = this.options.loadWorldLabsWorld(this.options.scene2Url).then(world => {
      if (expired || this.disposed) { world.dispose(); throw new Error('World load canceled'); }
      return world;
    });
    const scene2World = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          expired = true;
          reject(new Error('World 2 loading timed out; leave doorway to retry.'));
        }, this.options.loadTimeoutMs ?? 45000);
      }),
    ]).finally(() => window.clearTimeout(timeout));
    if (this.disposed) { scene2World.dispose(); return; }

    if (scene2World.activeMode !== 'marble') {
      if (scene2World.requestedMode === 'marble') {
        scene2World.dispose();
        throw new Error(`World 2 visual unavailable: ${scene2World.fallbackReason}`);
      }
    }

    this.applyScene2Transform(scene2World.root);
    this.options.hideScene1Actors?.();
    this.disposeScene1(scene1World);
    this.options.activateScene2World?.();
    this.options.onScene2World(scene2World);
    this.moveGo2ToScene2Spawn();
    this.options.initializeScene2Humanoids?.();
    this.options.onEnteredScene2?.();
    this.state = 'scene2';
    console.log('[WORLD2] loaded');

    await waitForNextFrame();
    await fadeOutSafely();
  }

  public dispose(): void {
    this.disposed = true;
    this.clearWatchdog();
    if (this.delayId !== null) window.clearTimeout(this.delayId);
    document.getElementById('airlock-transition')?.remove();
  }

  private containsTrigger(
    worldTrigger: Box3,
    localTrigger?: Box3,
  ): boolean {
    const anchor = this.options.airlockAnchor;
    if (!anchor || !localTrigger) {
      return worldTrigger.containsPoint(this.go2WorldPosition);
    }

    this.go2AnchorPosition.copy(this.go2WorldPosition);
    anchor.worldToLocal(this.go2AnchorPosition);
    return localTrigger.containsPoint(this.go2AnchorPosition);
  }

  private disposeScene1(scene1World: WorldHandle | null): void {
    if (!scene1World) {
      return;
    }
    scene1World.dispose();
    this.options.clearScene1World();
    console.log('[WORLD] Scene 1 disposed');
  }

  private applyScene2Transform(world: Object3D): void {
    applyWorldCalibration(world, this.options.scene2Calibration);
    console.log('[WORLD2] calibration applied');
  }

  private moveGo2ToScene2Spawn(): void {
    applyRobotSpawn(this.options.go2Root, this.options.scene2Calibration);
    this.options.onGo2Moved?.();
    console.log('[GO2] Scene 2 spawn applied');
  }

  private clearWatchdog(): void {
    if (this.watchdogId === null) {
      return;
    }
    window.clearTimeout(this.watchdogId);
    this.watchdogId = null;
  }

  private ensureFadeOverlay(): void {
    if (document.getElementById('airlock-transition')) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'airlock-transition';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: '#050505',
      opacity: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      transition: 'opacity 500ms ease',
      zIndex: '999999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#f4f1ea',
      fontFamily:
        'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '13px',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    });

    const label = document.createElement('div');
    label.id = 'airlock-transition-label';
    label.textContent = 'Entering World 2';
    overlay.appendChild(label);
    document.body.appendChild(overlay);
  }
}

const getOverlay = (): HTMLElement => {
  const overlay = document.getElementById('airlock-transition');
  if (!overlay) {
    throw new Error('World 2 transition overlay missing');
  }
  return overlay;
};

const fadeIn = (): Promise<void> => {
  const overlay = getOverlay();
  overlay.style.pointerEvents = 'auto';
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      overlay.style.visibility = 'visible';
      overlay.setAttribute('aria-hidden', 'false');
      overlay.style.opacity = '1';
      window.setTimeout(resolve, 525);
    });
  });
};

const fadeOut = (): Promise<void> => {
  const overlay = getOverlay();
  return new Promise((resolve) => {
    overlay.style.opacity = '0';
    window.setTimeout(() => {
      overlay.style.pointerEvents = 'none';
      overlay.style.visibility = 'hidden';
      overlay.setAttribute('aria-hidden', 'true');
      resolve();
    }, 525);
  });
};

const fadeInSafely = async (): Promise<void> => {
  try {
    await fadeIn();
  } catch (error) {
    console.warn('[WORLD2] fade-in unavailable; continuing transition', error);
  }
};

const fadeOutSafely = async (): Promise<void> => {
  try {
    await fadeOut();
  } catch (error) {
    console.warn('[WORLD2] fade-out unavailable; continuing transition', error);
  }
};

const waitForNextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

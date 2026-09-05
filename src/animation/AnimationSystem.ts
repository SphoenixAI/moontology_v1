import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';
import type { LevelAssetConfig } from '../levels/types';

export interface AnimationBinding {
  mixer: AnimationMixer;
  action: AnimationAction;
  clip: AnimationClip;
}

/** Continuous visual work, independent of once-only route/ontology cues. */
export const setLoopingPlayback = (binding: AnimationBinding, paused: boolean, reset = false): void => {
  const { action, mixer } = binding;
  if (reset || action.loop !== LoopRepeat || !action.isScheduled()) {
    action.reset().setLoop(LoopRepeat, Infinity).play();
  }
  action.clampWhenFinished = false;
  action.paused = paused;
  if (reset) mixer.update(0);
};

export class AnimationSystem {
  private readonly bindings = new Map<Object3D, AnimationBinding>();

  createBinding(
    root: Object3D,
    clips: readonly AnimationClip[],
    config: LevelAssetConfig,
  ): AnimationBinding | null {
    if (clips.length === 0) {
      if (config.animation) {
        console.warn(
          `[animations] "${config.id}" requested "${config.animation}", but its model has no embedded animation clips.`,
        );
      }
      return null;
    }

    const requestedClip = config.animation
      ? (clips.find(({ name }) => name === config.animation) ?? null)
      : null;

    if (config.animation && !requestedClip) {
      console.warn(
        `[animations] Clip "${config.animation}" was not found on "${config.id}". Playing "${clips[0].name}" instead.`,
      );
    }

    const clip = requestedClip ?? clips[0];
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);

    action.enabled = true;
    action.clampWhenFinished = config.loop === false;
    action.setLoop(
      config.loop === false ? LoopOnce : LoopRepeat,
      config.loop === false ? 1 : Infinity,
    );
    action.setEffectiveTimeScale(config.animationSpeed ?? 1);
    action.play();

    const binding = { mixer, action, clip };
    this.bindings.set(root, binding);
    return binding;
  }

  update(deltaSeconds: number): void {
    for (const [root, { mixer }] of this.bindings) {
      if (!root.userData.semanticPaused) mixer.update(deltaSeconds);
    }
  }

  remove(root: Object3D): void {
    const binding = this.bindings.get(root);
    if (!binding) {
      return;
    }

    binding.mixer.stopAllAction();
    binding.mixer.uncacheRoot(root);
    this.bindings.delete(root);
  }

  dispose(): void {
    for (const root of [...this.bindings.keys()]) {
      this.remove(root);
    }
  }
}

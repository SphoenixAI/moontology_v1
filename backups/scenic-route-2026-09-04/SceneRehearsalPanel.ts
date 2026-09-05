import { LoopOnce, Vector3, type Object3D } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { SceneDirector } from '../runtime/SceneDirector';
import { DockablePanel } from './DockablePanel';

export class SceneRehearsalPanel {
  readonly director = new SceneDirector();
  private readonly panel: DockablePanel;
  private readonly status = document.createElement('p');
  private readonly position = new Vector3();
  private lastBlock: string | null = 'Waiting for scene readiness.';
  private previousActive: string | null = null;
  private readonly registry: AssetRegistry;
  private readonly expectedIds: string[];

  constructor(host: HTMLElement, registry: AssetRegistry, expectedIds: string[]) {
    this.registry = registry;
    this.expectedIds = expectedIds;
    this.panel = new DockablePanel({ id: 'scene-rehearsal', title: 'Scene rehearsal', host, defaultMode: 'top-right', defaultCollapsed: false, className: 'scene-rehearsal-panel' });
    this.panel.body.append(this.status);
    for (const [label, action] of [
      ['Arm / Resume', () => this.director.arm()],
      ['Pause cues', () => { this.director.pause(); this.freeze(); }],
      ['Reset run', () => { this.director.reset(); this.previousActive = null; this.freeze(true); }],
    ] as const) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', action);
      this.panel.body.append(button);
    }
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Humanoid cue');
    for (const id of expectedIds) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.append(option);
    }
    const cue = document.createElement('button');
    cue.textContent = 'Cue selected once';
    cue.addEventListener('click', () => {
      if (!this.lastBlock) this.director.cue(select.value);
    });
    this.panel.body.append(select, cue);
    const note = document.createElement('p');
    note.textContent = 'Visual rehearsal only. Cue pause does not stop the physical robot. Each existing clip plays once, capped at 20 seconds.';
    this.panel.body.append(note);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.freeze(true);
  }

  private freeze(reset = false): void {
    for (const id of this.expectedIds) {
      const binding = this.registry.get(id)?.animation;
      if (!binding) continue;
      if (reset) {
        binding.action.reset().setLoop(LoopOnce, 1).play();
        binding.action.clampWhenFinished = true;
        binding.mixer.update(0);
      }
      binding.action.paused = true;
    }
  }

  update(dt: number, robot: Object3D | null, block: string | null): void {
    const targets = this.expectedIds.flatMap(id => {
      const asset = this.registry.get(id);
      if (!asset?.animation || !asset.root.visible || !asset.root.parent?.visible) return [];
      asset.root.getWorldPosition(this.position);
      return [{ id, x: this.position.x, z: this.position.z,
        duration: asset.animation.clip.duration / (asset.config.animationSpeed ?? 1) }];
    });
    const missing = this.expectedIds.filter(id => !targets.some(target => target.id === id));
    const unavailable = block ?? (!robot ? 'Go2 unavailable.' : missing.length ? `Missing animated humanoids: ${missing.join(', ')}.` : null);
    this.lastBlock = unavailable;
    robot?.getWorldPosition(this.position);
    this.director.update(dt, this.position, targets, unavailable);
    this.freeze();
    const active = this.director.activeId;
    if (active && this.director.state === 'running') {
      const binding = this.registry.get(active)?.animation;
      if (binding) {
        if (active !== this.previousActive) binding.action.reset().setLoop(LoopOnce, 1).play();
        binding.action.paused = false;
      }
    }
    this.previousActive = active;
    this.status.textContent = `${targets.length}/${this.expectedIds.length} animated humanoids · ${this.director.state} · ${this.director.completed.size} completed. ${unavailable ?? this.director.reason}`;
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) { this.director.pause('Tab hidden. Resume explicitly.'); this.freeze(); }
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.panel.dispose();
  }
}

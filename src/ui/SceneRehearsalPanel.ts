import { LoopOnce, Mesh, MeshBasicMaterial, RingGeometry, DoubleSide, Vector3, type Object3D } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { OntologyStore } from '../ontology/OntologyStore';
import { SCENE_1_STOPS, SCENE_1_ROUTE_IDS } from '../levels/scene1DemoRoute';
import { AIRLOCK_PLACEMENT } from '../levels/airlockPlacement';
import { SceneDirector } from '../runtime/SceneDirector';
import { DockablePanel } from './DockablePanel';
import './sceneRehearsal.css';

export class SceneRehearsalPanel {
  readonly director = new SceneDirector(SCENE_1_ROUTE_IDS);
  private readonly panel: DockablePanel;
  private readonly status = document.createElement('p');
  private readonly detail = document.createElement('p');
  private readonly position = new Vector3();
  private readonly cueButton = document.createElement('button');
  private readonly armButton = document.createElement('button');
  private readonly rows = new Map<string, HTMLButtonElement>();
  private readonly beacon = new Mesh(new RingGeometry(0.46, 0.53, 48), new MeshBasicMaterial({ color: 0xf1d395, side: DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
  private lastBlock: string | null = 'Waiting for scene readiness.';
  private previousActive: string | null = null;
  private nearbyId: string | null = null;

  private readonly registry: AssetRegistry;
  private readonly expectedIds: string[];
  private readonly ontology: OntologyStore;
  constructor(host: HTMLElement, registry: AssetRegistry,
    expectedIds: string[], ontology: OntologyStore, scene: Object3D) {
    this.registry = registry; this.expectedIds = expectedIds; this.ontology = ontology;
    this.panel = new DockablePanel({ id: 'scene-rehearsal', title: 'Scene 1 · Demo route', host, defaultMode: 'top-right', defaultCollapsed: false, className: 'scene-rehearsal-panel' });
    this.panel.body.append(this.status);
    const actions = document.createElement('div'); actions.className = 'rehearsal-actions';
    this.armButton.textContent = 'Arm / Resume';
    this.armButton.onclick = () => { if (!this.lastBlock) this.director.arm(); };
    actions.append(this.armButton);
    for (const [label, action] of [
      ['Pause', () => { this.director.pause(); this.freeze(); }],
      ['Reset route', () => { this.director.reset(); this.previousActive = null; this.freeze(true); }],
    ] as const) {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = action; actions.append(button);
    }
    this.panel.body.append(actions);
    const list = document.createElement('div'); list.className = 'rehearsal-stops';
    for (const [index, stop] of SCENE_1_STOPS.entries()) {
      const button = document.createElement('button');
      button.textContent = `${index + 1}. ${stop.title} · ${stop.id}`;
      button.title = stop.detail;
      button.onclick = () => { this.ontology.selectEntity(stop.id); this.detail.textContent = stop.detail; };
      this.rows.set(stop.id, button); list.append(button);
    }
    const door = document.createElement('button'); door.textContent = '6. Habitat airlock → World 2';
    door.onclick = () => { this.ontology.selectEntity('Airlock-2A'); this.detail.textContent = 'Approach the habitat door; crossing its threshold enters World Labs Scene 2.'; };
    list.append(door); this.panel.body.append(list, this.detail);
    this.cueButton.textContent = 'Play nearby cue';
    this.cueButton.onclick = () => { if (!this.lastBlock && this.nearbyId) this.director.cue(this.nearbyId); };
    const note = document.createElement('p'); note.className = 'rehearsal-note';
    note.textContent = 'WASD / arrows: drive Go2. Follow the gold stop marker. Hold within 2 m for 1 second: one clip, once, in route order. Scene cues are simulated; physical observations remain separate.';
    this.panel.body.append(this.cueButton, note);
    this.beacon.name = 'Next demo route stop'; this.beacon.rotation.x = -Math.PI / 2;
    scene.add(this.beacon);
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
    const unavailable = block ?? (!robot ? 'Go2 unavailable.' : missing.length ? `Waiting for ${missing.join(', ')}.` : null);
    this.lastBlock = unavailable;
    robot?.getWorldPosition(this.position);
    this.director.update(dt, this.position, targets, unavailable);
    this.freeze();
    const active = this.director.activeId;
    if (active && this.director.state === 'running') {
      const binding = this.registry.get(active)?.animation;
      if (binding) {
        if (active !== this.previousActive) {
          binding.action.reset().setLoop(LoopOnce, 1).play();
          this.detail.textContent = SCENE_1_STOPS.find(stop => stop.id === active)?.detail ?? '';
        }
        binding.action.paused = false;
      }
    }
    this.previousActive = active;
    const next = SCENE_1_STOPS.find(stop => stop.id === this.director.nextId);
    const target = targets.find(item => item.id === next?.id);
    const distance = target ? Math.hypot(this.position.x - target.x, this.position.z - target.z) : Infinity;
    this.nearbyId = distance <= 2 ? next?.id ?? null : null;
    this.armButton.disabled = !!unavailable || this.director.state === 'complete';
    this.cueButton.disabled = !!unavailable || !this.nearbyId || !!active || this.director.isCoolingDown || this.director.state !== 'running';
    for (const stop of SCENE_1_STOPS) {
      const state = this.director.completed.has(stop.id) ? 'COMPLETE' : active === stop.id ? this.director.state === 'running' ? 'PLAYING' : 'PAUSED' : 'READY';
      this.ontology.setSceneCue(stop.id, stop.title, state);
      const row = this.rows.get(stop.id)!;
      row.dataset.state = state; row.setAttribute('aria-current', String(stop.id === next?.id));
      row.setAttribute('aria-label', `${stop.title}, ${stop.id}, ${state.toLowerCase()}${stop.id === next?.id ? ', next stop' : ''}`);
    }
    this.beacon.visible = !unavailable;
    const marker = next?.stop ?? [AIRLOCK_PLACEMENT.position[0], 0, AIRLOCK_PLACEMENT.position[2] + 1.3];
    this.beacon.position.set(marker[0], 0.1, marker[2]);
    const guidance = next ? `${next.title} · ${distance.toFixed(1)} m away` : 'All five cues complete · continue to the habitat door.';
    this.status.textContent = unavailable ?? `${this.director.completed.size}/5 complete · ${this.director.state}. ${this.director.state === 'paused' ? this.director.reason + ' ' : ''}${guidance}`;
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) { this.director.pause('Tab hidden. Resume explicitly.'); this.freeze(); }
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.beacon.removeFromParent(); this.beacon.geometry.dispose(); this.beacon.material.dispose();
    this.panel.dispose();
  }
}

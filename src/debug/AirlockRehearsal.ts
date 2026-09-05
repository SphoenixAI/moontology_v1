import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Go2Agent } from '../go2/Go2Agent';
import type { AirlockTransitionController } from '../world/airlockTransition';

/** Explicit development-only virtual walk; never sends bridge commands. */
export class AirlockRehearsal {
  private readonly panel = document.createElement('div');
  private readonly status = document.createElement('p');
  private walking = false;
  private readonly actor: Go2Agent;
  private readonly transition: AirlockTransitionController;
  private readonly blocked: () => boolean;
  constructor(anchor: Object3D, actor: Go2Agent, camera: PerspectiveCamera,
    orbit: OrbitControls, transition: AirlockTransitionController, blocked: () => boolean) {
    this.actor = actor; this.transition = transition; this.blocked = blocked;
    this.panel.setAttribute('aria-label', 'Airlock development rehearsal');
    Object.assign(this.panel.style, { position: 'fixed', top: '16px', left: '130px', width: '260px',
      zIndex: '100', background: '#152029', color: 'white', padding: '12px', borderRadius: '12px' });
    const label = document.createElement('p'); label.textContent = 'Development only · virtual Go2 walk';
    const stage = document.createElement('button'); stage.textContent = 'Stage outside entrance';
    stage.onclick = () => {
      if (blocked() || transition.getState() !== 'scene1') return;
      this.walking = false;
      const start = anchor.localToWorld(new Vector3(0, 0, 6)); start.y = 0;
      actor.agentRoot.position.copy(start);
      actor.agentRoot.rotation.y = anchor.rotation.y + Math.PI / 2;
      actor.acknowledgeAgentRootSnap();
      camera.position.copy(anchor.localToWorld(new Vector3(0, 2.5, 11)));
      orbit.target.copy(anchor.localToWorld(new Vector3(0, 0, 0)));
      orbit.update();
    };
    const walk = document.createElement('button'); walk.textContent = 'Walk through entrance';
    walk.onclick = () => { if (!blocked()) this.walking = true; };
    const visibility = document.createElement('input'); visibility.type = 'checkbox'; visibility.checked = true;
    visibility.setAttribute('aria-label', 'Show facade overlay'); visibility.onchange = () => { anchor.visible = visibility.checked; };
    const visibleLabel = document.createElement('label'); visibleLabel.textContent = 'Show facade overlay'; visibleLabel.append(visibility);
    const fields = document.createElement('div');
    for (const axis of ['x', 'y', 'z'] as const) {
      const field = document.createElement('input'); field.type = 'number'; field.step = '0.1';
      field.style.width = '70px'; field.value = String(anchor.position[axis]);
      field.setAttribute('aria-label', `Facade ${axis}`);
      field.oninput = () => { const value = Number(field.value); if (Number.isFinite(value)) anchor.position[axis] = value; };
      fields.append(field);
    }
    this.panel.append(label, stage, walk, visibleLabel, fields, this.status); document.body.append(this.panel);
  }
  update(dt: number): void {
    const state = this.transition.getState();
    if (this.blocked() || state === 'entering' || state === 'loading' || state === 'scene2' || state === 'error') this.walking = false;
    if (this.walking) this.actor.moveForward(0.8 * Math.min(dt, 0.1));
    this.status.textContent = `${state} · virtual root ${this.actor.agentRoot.position.toArray().map(n => n.toFixed(2)).join(', ')}`;
  }
  dispose(): void { this.panel.remove(); }
}

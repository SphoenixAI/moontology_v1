import { Mesh, Texture, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Go2Agent } from '../go2/Go2Agent';

export const describeTextures = (root: Object3D) => {
  const textures = new Map<string, {slot:string;width:number;height:number}>();
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const [slot, value] of Object.entries(material)) if (value instanceof Texture) {
        textures.set(value.uuid, {slot, width:value.source.data?.width ?? 0, height:value.source.data?.height ?? 0});
      }
    }
  });
  return [...textures.values()];
};

/** Development-only survey of the rendered map. All staging is virtual. */
export class LayoutRehearsal {
  private readonly panel = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly report = document.createElement('pre');
  private readonly reportSource: () => unknown;
  private reportAt = 0;
  private readonly actor: Go2Agent;
  private readonly blocked: () => boolean;
  private walkRemaining = 0;
  private lastUpdate = performance.now();
  constructor(actor: Go2Agent, camera: PerspectiveCamera, orbit: OrbitControls,
    freeCamera: () => void, followCamera: () => void, blocked: () => boolean, canPlace: (x: number, z: number) => boolean, reportSource: () => unknown) {
    this.actor = actor; this.reportSource = reportSource; this.blocked = blocked;
    this.panel.setAttribute('aria-label', 'Layout survey');
    Object.assign(this.panel.style, { position: 'fixed', left: '130px', top: '16px', zIndex: '100',
      background: '#152029', color: 'white', padding: '12px', width: '235px', borderRadius: '12px' });
    const title = document.createElement('p'); title.textContent = 'Map survey · virtual staging';
    const hide = document.createElement('button'); hide.textContent = 'Hide survey';
    hide.onclick = () => { this.panel.hidden = true; };
    const overhead = document.createElement('button'); overhead.textContent = 'Overhead survey';
    overhead.onclick = () => { freeCamera(); camera.up.set(0, 1, 0); camera.position.set(0, 29, -5.999);
      orbit.target.set(0, 0, -6); camera.lookAt(orbit.target); orbit.enabled = false; };
    const fields = ['X', 'Z', 'Yaw'].map((axis, i) => {
      const field = document.createElement('input'); field.type = 'number'; field.step = '0.1';
      field.value = String([1.5, 5, 0.65][i]); field.style.width = '65px'; field.setAttribute('aria-label', `Survey ${axis}`); return field;
    });
    const stage = document.createElement('button'); stage.textContent = 'Stage virtual Go2';
    stage.onclick = () => { if (blocked()) return;
      this.walkRemaining = 0;
      const [x, z, yaw] = fields.map(field => Number(field.value));
      if (![x, z, yaw].every(Number.isFinite) || !canPlace(x!, z!)) return;
      actor.agentRoot.position.set(x!, 0, z!); actor.agentRoot.rotation.y = yaw!;
      actor.acknowledgeAgentRootSnap(); camera.up.set(0, 1, 0); followCamera(); };
    const walk = document.createElement('button'); walk.textContent = 'Walk virtual Go2 2 m';
    walk.onclick = () => { if (!blocked()) { this.walkRemaining = 2; followCamera(); } };
    const stop = document.createElement('button'); stop.textContent = 'Stop virtual walk';
    stop.onclick = () => { this.walkRemaining = 0; };
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = 'Scene layout report'; this.report.style.cssText = 'max-height:250px;overflow:auto;font-size:10px;white-space:pre-wrap';
    details.append(summary, this.report);
    this.panel.append(title, hide, overhead, ...fields, stage, walk, stop, this.status, details); document.body.append(this.panel);
  }
  update(): void {
    const now = performance.now(), dt = Math.min(.05, (now - this.lastUpdate) / 1000); this.lastUpdate = now;
    if (this.blocked() || document.hidden) this.walkRemaining = 0;
    if (this.walkRemaining > 0) {
      const step = Math.min(this.walkRemaining, .8 * dt);
      this.actor.moveForward(step); this.walkRemaining -= step;
    }
    if (performance.now() - this.reportAt > 500) { this.reportAt = performance.now(); this.report.textContent = JSON.stringify(this.reportSource(), null, 2); }
    const p = this.actor.agentRoot.getWorldPosition(new Vector3());
    this.status.textContent = `Go2 ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
  }
  dispose(): void { this.panel.remove(); }
}

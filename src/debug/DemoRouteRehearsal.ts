import type { Go2Agent } from '../go2/Go2Agent';
import { SCENE_1_STOPS } from '../levels/scene1DemoRoute';
import type { SceneDirector } from '../runtime/SceneDirector';

/** Explicit development-only positioning for visual QA; no bridge commands. */
export class DemoRouteRehearsal {
  private readonly button = document.createElement('button');
  constructor(actor: Go2Agent, director: SceneDirector, blocked: () => boolean) {
    this.button.textContent = 'QA: stage next route stop';
    Object.assign(this.button.style, { position: 'fixed', bottom: '18px', left: '140px', zIndex: '100', padding: '8px' });
    this.button.onclick = () => {
      if (blocked()) return;
      const stop = SCENE_1_STOPS.find(stop => stop.id === director.nextId);
      if (!stop) return;
      actor.agentRoot.position.fromArray(stop.stop);
      actor.agentRoot.rotation.y = Math.atan2(-(stop.position[2] - stop.stop[2]), stop.position[0] - stop.stop[0]);
      actor.acknowledgeAgentRootSnap();
    };
    document.body.append(this.button);
  }
  dispose(): void { this.button.remove(); }
}

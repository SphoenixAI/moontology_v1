export interface CueTarget { id: string; x: number; z: number; duration: number }
export type DirectorState = 'ready' | 'running' | 'paused' | 'complete';

/** Simulation clock only: no timers, robot commands, or replay after reconnect. */
export class SceneDirector {
  state: DirectorState = 'ready';
  activeId: string | null = null;
  readonly completed = new Set<string>();
  reason = 'Arm rehearsal to enable proximity cues.';
  private dwellId: string | null = null;
  private dwell = 0;
  private elapsed = 0;
  private cooldown = 0;

  private readonly order: readonly string[];
  constructor(order: readonly string[] = []) { this.order = order; }

  get nextId(): string | null {
    return this.order.find(id => !this.completed.has(id)) ?? null;
  }

  get isCoolingDown(): boolean { return this.cooldown > 0; }

  arm(): void {
    if (this.state === 'complete') return;
    this.state = 'running';
    this.reason = 'Approach a humanoid within 2 m for 1 second.';
  }

  pause(reason = 'Paused by operator.'): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.dwellId = null;
    this.dwell = 0;
    this.reason = reason;
  }

  cue(id: string): boolean {
    if (this.state !== 'running' || this.activeId || this.cooldown > 0 || this.completed.has(id)) return false;
    if (this.order.length && id !== this.nextId) return false;
    this.activeId = id;
    this.elapsed = 0;
    this.dwellId = null;
    this.dwell = 0;
    this.reason = `Playing ${id} once.`;
    return true;
  }

  reset(): void {
    this.state = 'ready';
    this.activeId = null;
    this.completed.clear();
    this.dwellId = null;
    this.dwell = this.elapsed = this.cooldown = 0;
    this.reason = 'Reset complete. Arm to rehearse again.';
  }

  update(dt: number, robot: { x: number; z: number }, targets: CueTarget[], block: string | null): void {
    if (block) { this.pause(block); return; }
    if (this.state !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
    if (!Number.isFinite(robot.x) || !Number.isFinite(robot.z)) {
      this.pause('Robot position unavailable.'); return;
    }
    // Suspended tabs and stalled frames must never fast-forward a cue.
    if (dt > 0.25) { this.pause('Frame stalled. Resume when ready.'); return; }
    // Match the animation clock's step cap, so slow frames cannot finish a
    // cue before its animation reaches the same point.
    dt = Math.min(dt, 0.1);
    if (this.activeId) {
      const target = targets.find(({ id }) => id === this.activeId);
      if (!target) { this.pause('Active humanoid unavailable.'); return; }
      this.elapsed += dt;
      if (this.elapsed >= Math.min(target.duration, 20)) {
        this.completed.add(this.activeId);
        this.activeId = null;
        this.elapsed = 0;
        this.cooldown = 2;
        this.reason = 'Cue complete. Approach the next humanoid after the two-second gap.';
        if (this.completed.size === targets.length) {
          this.state = 'complete';
          this.reason = 'Run complete. Reset to replay.';
        }
      }
      return;
    }
    if (this.cooldown > 0) { this.cooldown -= dt; return; }
    const nearest = targets
      .filter(({ id }) => !this.completed.has(id))
      .filter(({ id }) => !this.order.length || id === this.nextId)
      .map(target => ({ target, distance: Math.hypot(robot.x - target.x, robot.z - target.z) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance || a.target.id.localeCompare(b.target.id))[0];
    if (!nearest) { this.dwellId = null; this.dwell = 0; return; }
    if (this.dwellId !== nearest.target.id) { this.dwellId = nearest.target.id; this.dwell = 0; }
    this.dwell += dt;
    if (this.dwell >= 1) {
      this.cue(nearest.target.id);
    }
  }
}

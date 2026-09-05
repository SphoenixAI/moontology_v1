import { Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three';

/** Follow AgentRoot only: gait and animated joints never shake the camera. */
export class Go2FollowCamera {
  readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly look = new Vector3();
  private readonly camera: PerspectiveCamera;
  private readonly root: Object3D;
  constructor(camera: PerspectiveCamera, root: Object3D) { this.camera = camera; this.root = root; }

  update(dt: number, snap = false): void {
    this.root.getWorldPosition(this.position);
    this.root.getWorldQuaternion(this.rotation);
    // Go2 forward is local +X. A raised chase view leaves the route visible.
    this.desired.set(-3.8, 2.05, 0).applyQuaternion(this.rotation).add(this.position);
    this.look.set(0.9, 0.55, 0).applyQuaternion(this.rotation).add(this.position);
    const alpha = snap || this.camera.position.distanceTo(this.desired) > 15
      ? 1 : 1 - Math.exp(-5 * Math.max(0, Math.min(dt, 0.1)));
    this.camera.position.lerp(this.desired, alpha);
    this.target.lerp(this.look, alpha);
    this.camera.lookAt(this.target);
  }
}

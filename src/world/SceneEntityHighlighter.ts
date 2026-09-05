import {
  Box3,
  BoxHelper,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type Object3D,
} from 'three';

const CHAMPAGNE = 0xd4c3a6;
const ANOMALY = 0xe9ad61;

export class SceneEntityHighlighter {
  readonly object = new Group();

  private readonly box = new BoxHelper(new Group());
  private readonly ring = new Mesh(
    new RingGeometry(0.42, 0.49, 64),
    new MeshBasicMaterial({
      color: CHAMPAGNE,
      transparent: true,
      opacity: 0.78,
      depthTest: false,
      side: DoubleSide,
    }),
  );
  private readonly bounds = new Box3();
  private readonly size = new Vector3();
  private readonly center = new Vector3();
  private target: Object3D | null = null;
  private boundsTarget: Object3D | null = null;

  constructor() {
    this.object.name = 'ontology-selection-highlight';
    this.object.renderOrder = 1000;
    this.object.visible = false;

    const boxMaterial = this.box.material as LineBasicMaterial;
    boxMaterial.color = new Color(CHAMPAGNE);
    boxMaterial.transparent = true;
    boxMaterial.opacity = 0.7;
    boxMaterial.depthTest = false;
    this.box.renderOrder = 1000;
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 1001;
    this.object.add(this.box, this.ring);
  }

  select(target: Object3D | null, discrepancy: boolean): void {
    if (target?.userData.hideSelectionHighlight) target = null;
    if (this.target !== target) {
      this.target = target;
      this.boundsTarget = target;
      target?.traverse(child => {
        if (child.userData.humanoidSelectionProxy) this.boundsTarget = child;
      });
    }
    this.object.visible = target !== null;
    if (!target) {
      return;
    }

    const color = discrepancy ? ANOMALY : CHAMPAGNE;
    (this.box.material as LineBasicMaterial).color.setHex(color);
    (this.ring.material as MeshBasicMaterial).color.setHex(color);
    this.update();
  }

  update(): void {
    if (!this.target || !this.boundsTarget) {
      return;
    }
    this.boundsTarget.updateWorldMatrix(true, true);
    this.bounds.setFromObject(this.boundsTarget);
    if (this.bounds.isEmpty()) {
      this.object.visible = false;
      return;
    }

    this.object.visible = true;
    this.bounds.getCenter(this.center);
    this.bounds.getSize(this.size);
    this.box.setFromObject(this.boundsTarget);

    const radius = Math.max(this.size.x, this.size.z, 0.5) * 0.62;
    this.ring.scale.setScalar(radius / 0.49);
    this.ring.position.set(
      this.center.x,
      this.bounds.min.y + 0.025,
      this.center.z,
    );
  }

  dispose(): void {
    this.target = null;
    this.boundsTarget = null;
    this.box.geometry.dispose();
    (this.box.material as LineBasicMaterial).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
    this.object.removeFromParent();
  }
}

import {
  BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh,
  MeshStandardMaterial, Shape, type BufferGeometry,
} from 'three';
import { AIRLOCK_APERTURE, AIRLOCK_PLACEMENT } from '../levels/airlockPlacement';

const smooth = (t: number) => { const p = Math.max(0, Math.min(1, t)); return p * p * (3 - 2 * p); };
// Overlap the uneven scanned apron below the invisible gameplay floor so the
// frame meets the habitat surface without a floating seam. No collision change.
const FLOOR_OVERLAP = .25;

/** Rigid pressure-door leaves: unseat the seal, then swing clear of the opening. */
export class AirlockDoorVisual {
  readonly object = new Group();
  private readonly leaves: { hinge: Group; side: number; latch: Group }[] = [];
  private readonly materials = new Set<MeshStandardMaterial>();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly status: MeshStandardMaterial;
  private readonly halfWidth: number;

  constructor() {
    const units = 1 / AIRLOCK_PLACEMENT.scale[0];
    const width = AIRLOCK_APERTURE.width * units;
    const height = (AIRLOCK_APERTURE.height + FLOOR_OVERLAP) * units;
    this.halfWidth = width / 2;
    this.object.name = 'habitat-pressure-airlock';
    this.object.position.y = (AIRLOCK_APERTURE.floorY - FLOOR_OVERLAP - AIRLOCK_PLACEMENT.position[1]) * units;
    const metal = this.material(0x7b8588, .7, .38);
    const trim = this.material(0x252f34, .65, .42);
    const gasket = this.material(0x11191c, .15, .7);
    const inset = this.material(0x46585e, .6, .35);
    const glass = this.material(0x102e39, .72, .19);
    this.status = this.material(0x9eeedc, .3, .3);
    this.status.emissive.set(0x78dbc4); this.status.emissiveIntensity = .8;

    const frame = outline(width + .62, height + .35, .24, -.14);
    frame.holes.push(outline(width, height, .13, 0));
    this.mesh(this.object, new ExtrudeGeometry(frame, {
      depth: .34, bevelEnabled: true, bevelThickness: .045, bevelSize: .045,
      bevelSegments: 3, steps: 1, curveSegments: 6,
    }), metal, 'beveled-pressure-frame').position.z = -.12;
    // The sill is only a few centimeters high; no panel or collision plane fills the portal.
    this.box(this.object, width, .035, .55, trim, 'flush-sill', 0, .015, .04);
    this.box(this.object, width - .3, .055, .06, this.status, 'pressure-status-strip', 0, height + .11, .27);

    for (const side of [-1, 1]) {
      const hinge = new Group(); hinge.name = side < 0 ? 'left-door-hinge' : 'right-door-hinge';
      this.object.add(hinge);
      const cx = -side * width / 4;
      const leafWidth = width / 2 - .035;
      const leaf = this.mesh(hinge, beveledPanel(leafWidth, height - .08, .19, .1), metal, 'rigid-pressure-leaf');
      leaf.position.set(cx, height / 2, 0);
      const recess = this.mesh(hinge, beveledPanel(leafWidth - .28, height - .58, .03, .1), inset, 'recessed-door-panel');
      recess.position.set(cx, height / 2, .21);
      const back = this.mesh(hinge, beveledPanel(leafWidth - .28, height - .58, .03, .1), inset, 'inner-pressure-panel');
      back.position.set(cx, height / 2, -.06);
      for (const y of [.65, height * .58]) {
        this.box(hinge, leafWidth - .48, .07, .055, metal, 'inner-reinforcement', cx, y, -.08);
      }
      this.box(hinge, .04, height - .22, .04, gasket, 'center-pressure-seal', -side * (width / 2 - .045), height / 2, .23);
      const window = this.mesh(hinge, beveledPanel(leafWidth - .54, .72, .035, .11), trim, 'inspection-window-bezel');
      window.position.set(cx, height * .73, .26);
      const pane = this.mesh(hinge, beveledPanel(leafWidth - .68, .54, .018, .08), glass, 'inspection-window');
      pane.position.set(cx, height * .73, .3);
      this.box(hinge, leafWidth - .6, .035, .018, metal, 'window-reflection', cx, height * .73 + .18, .325);
      this.box(hinge, leafWidth - .38, .045, .06, metal, 'lower-reinforcement', cx, .65, .27);
      const latch = new Group(); latch.name = 'quarter-turn-lock';
      latch.position.set(-side * (width / 2 - .3), height * .46, .29); hinge.add(latch);
      const boss = this.mesh(latch, new CylinderGeometry(.13, .13, .08, 16), trim, 'lock-hub');
      boss.rotation.x = Math.PI / 2;
      this.box(latch, .07, .46, .09, metal, 'locking-handle', 0, 0, .07);
      for (const y of [.48, height / 2, height - .48]) {
        const barrel = this.mesh(hinge, new CylinderGeometry(.085, .085, .34, 12), metal, 'hinge-barrel');
        barrel.position.set(0, y, .1);
      }
      for (const x of [cx - leafWidth / 2 + .12, cx + leafWidth / 2 - .12]) {
        for (const y of [.2, height - .2]) {
          const bolt = this.mesh(hinge, new CylinderGeometry(.045, .045, .025, 6), trim, 'fastener');
          bolt.rotation.x = Math.PI / 2; bolt.position.set(x, y, .215);
        }
      }
      this.leaves.push({ hinge, side, latch });
    }
    this.setPose(0);
  }

  setPose(fraction: number): void {
    const release = smooth(fraction / .18);
    const swing = smooth((fraction - .14) / .86);
    for (const { hinge, side, latch } of this.leaves) {
      hinge.position.set(side * this.halfWidth, 0, .08 + .12 * release);
      hinge.rotation.y = side * swing * Math.PI * .57;
      latch.rotation.z = -side * release * Math.PI / 2;
    }
  }

  setStatus(state: string): void {
    const color = state === 'FAULT' ? 0xff6556
      : ['PURGING', 'REOPENING', 'RESEATING', 'WARNING'].includes(state) ? 0xf4bd66 : 0x78dbc4;
    this.status.color.set(color); this.status.emissive.set(color);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
  }

  private material(color: number, metalness: number, roughness: number): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, metalness, roughness });
    this.materials.add(material); return material;
  }
  private mesh(parent: Group, geometry: BufferGeometry, material: MeshStandardMaterial, name: string): Mesh {
    this.geometries.add(geometry);
    const mesh = new Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.raycast = () => {};
    parent.add(mesh); return mesh;
  }
  private box(parent: Group, w: number, h: number, d: number, material: MeshStandardMaterial, name: string, x: number, y: number, z: number): void {
    this.mesh(parent, new BoxGeometry(w, h, d), material, name).position.set(x, y, z);
  }
}

function outline(width: number, height: number, chamfer: number, bottom: number): Shape {
  const path = new Shape(); const x = width / 2; const y = bottom + height; const c = chamfer;
  path.moveTo(-x + c, bottom); path.lineTo(x - c, bottom); path.lineTo(x, bottom + c);
  path.lineTo(x, y - c); path.lineTo(x - c, y); path.lineTo(-x + c, y);
  path.lineTo(-x, y - c); path.lineTo(-x, bottom + c); path.closePath();
  return path;
}
function beveledPanel(width: number, height: number, depth: number, chamfer: number): ExtrudeGeometry {
  return new ExtrudeGeometry(outline(width, height, chamfer, -height / 2), {
    depth, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 3, steps: 1,
  });
}

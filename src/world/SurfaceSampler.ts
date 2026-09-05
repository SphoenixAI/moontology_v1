import { Matrix4, Mesh, Vector3, type Object3D } from 'three';

type Triangle = { a: Vector3; b: Vector3; c: Vector3; denominator: number; slope: number };
const CELL = 2;
/** A measurement index only. Semantic permission comes from authored regions. */
export class SurfaceSampler {
  private readonly cells = new Map<string, Triangle[]>();
  constructor(collider: Object3D, worldRoot: Object3D) {
    worldRoot.updateWorldMatrix(true, true);
    const inverse = worldRoot.matrixWorld.clone().invert();
    collider.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const transform = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
      const geometry = object.geometry, positions = geometry.getAttribute('position'), index = geometry.index;
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        const points = [0, 1, 2].map(offset => new Vector3().fromBufferAttribute(positions, index ? index.getX(i + offset) : i + offset).applyMatrix4(transform));
        const [a, b, c] = points;
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const denominator = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
        if (Math.abs(denominator) < 1e-9) continue;
        const triangle = { a, b, c, denominator, slope: Math.acos(Math.min(1, Math.abs(normal.y))) };
        for (let x = Math.floor(Math.min(a.x, b.x, c.x) / CELL); x <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); x++) {
          for (let z = Math.floor(Math.min(a.z, b.z, c.z) / CELL); z <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); z++) {
            const key = `${x},${z}`, list = this.cells.get(key) ?? [];
            list.push(triangle); this.cells.set(key, list);
          }
        }
      }
    });
  }
  sample(x: number, z: number, minY = -2, maxY = 1): { y: number; slope: number } | null {
    let best: { y: number; slope: number } | null = null;
    for (const { a, b, c, denominator, slope } of this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const u = ((x - a.x) * (c.z - a.z) - (z - a.z) * (c.x - a.x)) / denominator;
      const v = ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) / denominator;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const y = a.y + u * (b.y - a.y) + v * (c.y - a.y);
      if (y >= minY && y <= maxY && (!best || y > best.y)) best = { y, slope };
    }
    return best;
  }
}

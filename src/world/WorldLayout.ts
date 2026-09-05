import { Vector3, type Object3D } from 'three';
import type { LayoutDefinition, LayoutRegion, Point2 } from '../levels/sceneLayouts';
import { SurfaceSampler } from './SurfaceSampler';

export interface LayoutSample {
  traversable: boolean;
  regionId: string | null;
  kind: LayoutRegion['kind'] | 'unknown';
  reason: string | null;
  height: number | null;
}
export interface LayoutObstacle { id: string; polygon: readonly Point2[] }
export const containsPoint = (x: number, z: number, polygon: readonly Point2[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
export class WorldLayout {
  readonly definition: LayoutDefinition;
  private readonly root: Object3D;
  private readonly sampler: SurfaceSampler;
  private obstacles: LayoutObstacle[] = [];
  private obstacleRevision = 0;
  private robotState: { position: number[]; regionId: string | null; blocked: string | null; physicalHold: string | null; rejectedTelemetryPose: number[] | null } | null = null;
  setRobotState(state: NonNullable<WorldLayout['robotState']>): void { this.robotState = state; }
  constructor(definition: LayoutDefinition, root: Object3D, collider: Object3D) {
    this.definition = definition; this.root = root; this.sampler = new SurfaceSampler(collider, root);
  }
  setObstacles(obstacles: LayoutObstacle[]): void {
    if (JSON.stringify(this.obstacles) === JSON.stringify(obstacles)) return;
    this.obstacles = obstacles; this.obstacleRevision++;
  }
  sample(x: number, z: number, includeAssets = true): LayoutSample {
    const local = this.root.worldToLocal(new Vector3(x, 0, z));
    const matching = this.definition.regions.filter(r => containsPoint(local.x, local.z, r.polygon));
    const portal = matching.find(r => r.kind === 'doorway');
    const building = matching.find(r => r.kind === 'building');
    const region = portal ?? building ?? matching.at(-1);
    const deny = (reason: string): LayoutSample => ({ traversable: false, regionId: region?.id ?? null,
      kind: region?.kind ?? 'unknown', reason, height: null });
    if (!region) return deny('Unregistered map area');
    if (building && !portal) return deny(building.label);
    // Beyond the portal's back edge the habitat remains closed to Scene 1.
    if (includeAssets) {
      const obstacle = this.obstacles.find(o => containsPoint(x, z, o.polygon));
      if (obstacle) return deny(`Occupied by ${obstacle.id}`);
    }
    const support = region.floorY === undefined ? this.sampler.sample(local.x, local.z) : { y: region.floorY, slope: 0 };
    if (!support) return deny('Floor measurement unavailable');
    if (support.slope > Math.PI * 28 / 180) return deny('Surface exceeds the surveyed slope limit');
    const height = this.root.localToWorld(new Vector3(local.x, support.y, local.z)).y;
    return { traversable: true, regionId: region.id, kind: region.kind, height, reason: null };
  }
  footprint(x: number, z: number, radius = .4, includeAssets = true): LayoutSample {
    const center = this.sample(x, z, includeAssets);
    if (!center.traversable) return center;
    for (let i = 0; i < 12; i++) {
      const sample = this.sample(x + Math.cos(i * Math.PI / 6) * radius, z + Math.sin(i * Math.PI / 6) * radius, includeAssets);
      if (!sample.traversable) return sample;
      if (Math.abs(sample.height! - center.height!) > .22) return { ...sample, traversable: false, reason: 'Abrupt floor height change' };
    }
    return center;
  }
  /** Swept check at 5 cm intervals prevents tunneling through thin boundaries. */
  constrain(from: Vector3, requested: Vector3, radius = .4): { position: Vector3; blocked: string | null } {
    if (![from.x, from.z, requested.x, requested.z].every(Number.isFinite)) return { position: from.clone(), blocked: 'Invalid map pose' };
    const distance = Math.hypot(requested.x - from.x, requested.z - from.z);
    if (distance > 20) return { position: from.clone(), blocked: 'Map displacement requires explicit placement' };
    const steps = Math.max(1, Math.ceil(distance / .05));
    const position = from.clone();
    for (let i = 1; i <= steps; i++) {
      const next = from.clone().lerp(requested, i / steps);
      const support = this.footprint(next.x, next.z, radius);
      if (!support.traversable) return { position, blocked: support.reason };
      next.y = support.height!; position.copy(next);
    }
    return { position, blocked: null };
  }
  observation() {
    this.root.updateWorldMatrix(true, false);
    return {
      world: this.definition.id, layoutRevision: this.definition.revision, obstacleRevision: this.obstacleRevision,
      source: 'PRESENTATION_MAP_AUTHORED_LAYOUT', physicalValidation: 'UNVERIFIED',
      unknownAreas: 'BLOCKED', unregisteredSplatFeatures: 'UNKNOWN', heightSource: 'WORLD_LABS_COLLIDER_MEASUREMENTS',
      regions: this.definition.regions.map(r => ({ ...r, polygon: r.polygon.map(([x,z]) => {
        const point = this.root.localToWorld(new Vector3(x, 0, z)); return [point.x, point.z];
      }), validActions: r.kind === 'building' ? [] : r.kind === 'doorway' ? ['approach', 'enter_world_2'] : ['walk'] })),
      robotState: this.robotState ? { ...this.robotState, position: [...this.robotState.position], rejectedTelemetryPose: this.robotState.rejectedTelemetryPose?.slice() ?? null } : null,
      obstacles: this.obstacles.map(o => ({ id: o.id, polygon: o.polygon.map(p => [...p]), validActions: [] })),
    };
  }
}

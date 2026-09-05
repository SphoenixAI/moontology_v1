import { Vector3 } from 'three';
import type { WorldLayout } from '../world/WorldLayout';
const routes = new WeakMap<WorldLayout, { signature: string; points: Vector3[]; waypoint: Vector3; kind: ApproachKind }>();
/** What the returned waypoint is: the robot's own position (already inside the ring), the standoff goal
 *  on the ring, or an intermediate grid-search node the robot must reach before the goal is visible. */
export type ApproachKind = 'here' | 'goal' | 'path_node';
export interface ApproachPlan { waypoint: Vector3; kind: ApproachKind; radius: number }
/** Lane half-width (scene units) a measured Go2 needs around its 0.4 footprint: ~3 cm at scale 40. */
export const CLEARANCE = 1.2;
/** Scene metres within which the excavator can be inspected. Its footprint edge is ~2.3 m from
 *  its centre; at scale 40 one Go2 step is ~3 units, so the inspect ring must be wider than a step. */
export const EXCAVATOR_INTERACTION_RADIUS = 6;

/** Standoff sweep for non-excavator assets: nearest ring with a straight clear lane first. */
export const ASSET_STANDOFF_RADII = [2.5, 4, 6, 8, 11, 14] as const;
/** Standoff sweep toward a layout region centroid (buildings, walkways, doorways). */
export const REGION_STANDOFF_RADII = [3, 5, 7, 9, 12, 16, 20] as const;

/**
 * The map's approach policy for any target: sweep the radii for a straight clear
 * lane (cheap), then run the single grid search once at the given fallback radius.
 * Shared by the live map (main.ts planApproach) and the scene-atlas builder so
 * pre-planned legs match what the robot will actually be given.
 */
export function planStandoff(layout: WorldLayout, start: Vector3, target: Vector3, radii: readonly number[], fallbackIndex: number): Vector3 | null {
  return planStandoffDetailed(layout, start, target, radii, fallbackIndex)?.waypoint ?? null;
}

export function planStandoffDetailed(layout: WorldLayout, start: Vector3, target: Vector3, radii: readonly number[], fallbackIndex: number): ApproachPlan | null {
  // Wider rings are fallbacks for a robot that is still far away. Standing inside a wide ring
  // while the tight lanes are blocked is not "arrived": only the tightest ring may be satisfied
  // trivially; every other candidate ring must lie between the robot and the target.
  const distance = Math.hypot(start.x - target.x, start.z - target.z);
  const ahead = radii.filter((radius, index) => index === 0 || distance > radius - .15);
  for (const radius of ahead) {
    const plan = approachPlan(layout, start, target, radius, false);
    if (plan) return plan;
  }
  return approachPlan(layout, start, target, Math.min(radii[fallbackIndex], ahead.at(-1) ?? radii[0]));
}

export function regionCentroid(polygon: ReadonlyArray<readonly number[]>, y = 0): Vector3 {
  const centroid = polygon.reduce((acc, [x, z]) => acc.add(new Vector3(x, 0, z)), new Vector3()).multiplyScalar(1 / polygon.length);
  centroid.y = y;
  return centroid;
}

/** Plan only on the current scene's existing measured support/boundaries. */
export function approachWaypoint(layout: WorldLayout, start: Vector3, target: Vector3, radius = EXCAVATOR_INTERACTION_RADIUS, search = true): Vector3 | null {
  return approachPlan(layout, start, target, radius, search)?.waypoint ?? null;
}

export function approachPlan(layout: WorldLayout, start: Vector3, target: Vector3, radius = EXCAVATOR_INTERACTION_RADIUS, search = true): ApproachPlan | null {
  if (Math.hypot(start.x - target.x, start.z - target.z) <= radius - .15) return { waypoint: start.clone(), kind: 'here', radius };
  const observed = layout.observation();
  const signature = JSON.stringify([observed.layoutRevision, observed.obstacleRevision, target.toArray(), radius]);
  const cached = routes.get(layout);
  if (cached?.signature === signature && start.distanceTo(cached.waypoint) > .25 &&
    !layout.constrain(start, cached.waypoint).blocked) return { waypoint: cached.waypoint.clone(), kind: cached.kind, radius };
  // A physical robot cannot hold a 1 cm lane. Prefer a goal on the interaction
  // circle whose whole approach lane keeps CLEARANCE from every other footprint;
  // fall back to the bare footprint radius only when no such lane exists.
  const toStart = start.clone().sub(target).setY(0).normalize();
  const base = Math.atan2(toStart.z, toStart.x);
  const candidates: Vector3[] = [];
  for (const offset of [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90]) {
    const a = base + offset * Math.PI / 180;
    candidates.push(target.clone().add(new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(radius - .2)));
  }
  for (const goal of candidates) {
    // Straight lane: wide clearance until CLEARANCE before the goal (the goal
    // itself may sit near the target's own footprint), exact for the last bit.
    const along = goal.clone().sub(start).setY(0);
    const length = along.length();
    if (length > CLEARANCE) {
      const pre = start.clone().add(along.multiplyScalar((length - CLEARANCE) / length));
      if (layout.constrain(start, pre, CLEARANCE).blocked) continue;
    }
    const exact = layout.constrain(start, goal);
    if (exact.blocked) continue;
    routes.set(layout, { signature, points: [exact.position], waypoint: exact.position, kind: 'goal' });
    return { waypoint: exact.position, kind: 'goal', radius };
  }
  // Grid search below runs on the render thread (hundreds of ms); callers sweeping
  // several standoff radii ask for straight lanes only and search once at the end.
  if (!search) return null;
  const goal = candidates[0];
  const direct = layout.constrain(start, goal);
  if (!direct.blocked) {
    routes.set(layout, { signature, points: [direct.position], waypoint: direct.position, kind: 'goal' });
    return { waypoint: direct.position, kind: 'goal', radius };
  }
  const select = (points: Vector3[]): ApproachPlan | null => {
    for (let i = points.length - 1; i >= 0; i--) {
      if (start.distanceTo(points[i]) < .25) continue;
      const swept = layout.constrain(start, points[i]);
      if (!swept.blocked) {
        // The last grid node lies inside the ring: reaching it is arrival. Earlier nodes are
        // corners of the searched path, which may lead away from the target before it turns.
        const kind: ApproachKind = i === points.length - 1 ? 'goal' : 'path_node';
        routes.set(layout, { signature, points: points.slice(i), waypoint: swept.position, kind });
        return { waypoint: swept.position, kind, radius };
      }
    }
    return null;
  };
  if (cached?.signature === signature) {
    const next = select(cached.points);
    if (next) return next;
  }
  const step = .5, key = (x: number, z: number) => `${x},${z}`;
  const origin = start.clone();
  const point = (x: number, z: number) => new Vector3(origin.x + x * step, origin.y, origin.z + z * step);
  const goalDistance = (p: Vector3) => Math.hypot(p.x - target.x, p.z - target.z);
  const nodes = new Map<string, {x: number; z: number; g: number; parent: string | null}>();
  nodes.set('0,0', {x: 0, z: 0, g: 0, parent: null});
  const open = new Set(['0,0']), closed = new Set<string>();
  while (open.size && closed.size < 2200) {
    let best = '', score = Infinity;
    for (const id of open) { const n = nodes.get(id)!; const s = n.g + Math.max(0, goalDistance(point(n.x, n.z)) - radius + .15);
      if (s < score) { best = id; score = s; } }
    open.delete(best); closed.add(best);
    const node = nodes.get(best)!, p = point(node.x, node.z);
    if (goalDistance(p) <= radius - .15) {
      let id = best;
      const path: Vector3[] = [];
      while (nodes.get(id)!.parent) {
        const next = nodes.get(id)!;
        path.unshift(point(next.x, next.z));
        id = next.parent!;
      }
      return select(path);
    }
    for (const dx of [-1,0,1]) for (const dz of [-1,0,1]) {
      if (!dx && !dz) continue;
      const x = node.x + dx, z = node.z + dz, id = key(x,z);
      if (closed.has(id) || Math.abs(x) > 45 || Math.abs(z) > 45) continue;
      const q = point(x,z), g = node.g + Math.hypot(dx,dz) * step;
      if (nodes.has(id) && nodes.get(id)!.g <= g) continue;
      if (layout.constrain(p,q).blocked) continue;
      nodes.set(id, {x,z,g,parent:best}); open.add(id);
    }
  }
  return null;
}

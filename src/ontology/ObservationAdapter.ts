import type { Observation, ObservationMetric } from './worldState';

const metrics = new Set<ObservationMetric>(['motion_delta', 'position_delta', 'reel_rotation', 'motion_state', 'state', 'physical_location', 'reported_location', 'pressure_slope', 'seal_intact', 'navigation_safe']);
export const isPosition = (value: unknown): value is { x: number; y: number; z: number } => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return [p.x, p.y, p.z].every(v => typeof v === 'number' && Number.isFinite(v));
};
/** Shared boundary for measured dimOS perception and explicitly simulated samples.
 * Pose telemetry alone never becomes a claim about another actor's motion. */
export function normalizeObservation(raw: unknown, now = Date.now()): Observation {
  if (!raw || typeof raw !== 'object') throw new Error('observation_object_required');
  const o = raw as Observation;
  for (const key of ['id', 'source', 'target'] as const)
    if (typeof o[key] !== 'string' || !o[key].length || o[key].length > 128 || ['__proto__', 'constructor', 'prototype'].includes(o[key])) throw new Error(`invalid_${key}`);
  if (!metrics.has(o.metric)) throw new Error('unknown_metric');
  if (!['LIVE', 'DEMO'].includes(o.provenance)) throw new Error('explicit_provenance_required');
  if (o.provenance === 'LIVE') {
    if (['physical_location', 'reported_location', 'motion_delta', 'position_delta'].includes(o.metric) && (o.frame !== 'three_world' || o.unit !== 'world_units')) throw new Error('calibrated_map_frame_and_world_units_required');
    if (o.metric === 'reel_rotation' && o.unit !== 'radians') throw new Error('reel_rotation_radians_required');
    if (o.metric === 'pressure_slope' && o.unit !== 'kPa/s') throw new Error('pressure_slope_kPa_per_second_required');
  }
  if (!Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) throw new Error('invalid_confidence');
  if (!Number.isFinite(o.timestamp) || now - o.timestamp > 2000 || o.timestamp > now + 500) throw new Error('stale_observation');
  const numeric = ['motion_delta', 'position_delta', 'reel_rotation', 'pressure_slope'].includes(o.metric);
  if (numeric && (typeof o.value !== 'number' || !Number.isFinite(o.value))) throw new Error('numeric_metric_required');
  if (['physical_location', 'reported_location'].includes(o.metric) && !isPosition(o.value)) throw new Error('position_required');
  if (['seal_intact', 'navigation_safe'].includes(o.metric) && typeof o.value !== 'boolean') throw new Error('boolean_required');
  if (['state', 'motion_state'].includes(o.metric) && (typeof o.value !== 'string' || !o.value.length || o.value.length > 128)) throw new Error('state_required');
  if (o.location !== undefined && !isPosition(o.location)) throw new Error('invalid_location');
  return structuredClone(o);
}

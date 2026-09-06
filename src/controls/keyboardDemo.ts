import type { LiveMapState } from '../relay/LiveMapState';

/** Explicit local operator handoff; reuse the relay reset without arming any motion. */
export function useKeyboardDemo(
  state: LiveMapState,
  guards: { physicalHold: string | null; legacyTelemetryActive: boolean; transitioning: boolean },
): string | null {
  if (guards.physicalHold) return guards.physicalHold;
  if (guards.legacyTelemetryActive) return 'Disconnect the robot link before using the keyboard demo.';
  if (guards.transitioning) return 'Wait for the world transition to finish.';
  const observation = state.observation();
  if (!observation.map_ready) return 'Wait for the map to finish loading.';
  if (observation.robot_pose?.telemetry_fresh || observation.mission_state.map_armed)
    return 'Pause and disconnect the robot session before using the keyboard demo.';
  if (observation.intelligence.missionStatus.holdReasons.length)
    return 'Mission safety hold: operator revalidation is required.';

  const now = Date.now(), id = crypto.randomUUID();
  const reply = state.handle({ id, kind: 'reset', body: { command_id: id, scope: 'mission' },
    context: { scene_session_id: observation.scene_session_id, scene_revision: observation.scene_revision,
      observation_sequence: observation.observation_sequence, read_at: now }, expires_at: now + 1000 });
  return reply.status < 400 ? null : reply.body.error ?? 'The scene changed. Try again.';
}

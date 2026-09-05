/**
 * Scene atlas: the boot-time knowledge the Go2's reasoning layer needs to
 * recognise the map without re-learning each scene at runtime.
 *
 * This module is the single source of truth for
 *  - which map objects carry a Moontology humanoid sequence label (H-01..H-08)
 *    and what reasoning role that label stands for;
 *  - how each object moves (so automation treats humanoids and background
 *    vehicles as *mobile*: re-observe before approaching, expect displacement);
 *  - the Go2 traversal order per scene, expressed as targets the map's
 *    `navigate`/`approach` planner already understands;
 *  - known pitfalls of the authored layout.
 *
 * Positions and polygons live in the layout/route modules; the atlas builder
 * (`scripts/build-scene-atlas.mjs`) joins them with this file and the live
 * planner into `public/scene-atlas.json` + `docs/scene-atlas.md`. The bridge
 * loads that JSON on start. Nothing here moves the robot.
 */
import { SCENE_1_STOPS, SCENE_1_ROUTE_SPAWN, EQUIPMENT_STAGING } from './scene1DemoRoute';
import { AIRLOCK_PLACEMENT } from './airlockPlacement';

export type SceneId = 'SCENE_1' | 'SCENE_2' | 'SCENE_3';

/**
 * How an object's world position can change while the Go2 is operating.
 *  - static: authored placement, never moves.
 *  - animated_in_place: plays clips at its stop; its mesh moves but its
 *    registered position stays within ~1 unit. Treat as mobile for reasoning
 *    (a human/humanoid may be re-staged between runs).
 *  - patrol: BackgroundTraffic drives it along a scheduled loop; its footprint
 *    is a moving obstacle and its position is only valid at observation time.
 *  - agent: the Go2 itself.
 *  - door: fixed portal whose *state* changes (sealed/open/leak), not its place.
 */
export type Mobility = 'static' | 'animated_in_place' | 'patrol' | 'agent' | 'door';

export interface AtlasEntityRole {
  /** Scene object id (registry / ontology id). */
  id: string;
  /** Id the map API and dimOS skills accept (aliases: EXC-01→rover-1, H01→digging-bot). */
  apiId: string;
  scene: SceneId;
  role: string;
  mobility: Mobility;
  /** Ontology work group or system this object belongs to. */
  group: string;
  /** Sequence label when the object plays a humanoid beat in the story. */
  sequenceLabel?: string;
  notes?: string;
}

export const ATLAS_ENTITY_ROLES: readonly AtlasEntityRole[] = [
  { id: 'GO2-01', apiId: 'GO2-01', scene: 'SCENE_1', role: 'Mobile physical-truth verifier (this robot)', mobility: 'agent', group: 'Go2' },
  { id: 'H01', apiId: 'digging-bot', scene: 'SCENE_1', role: 'Excavation technician: regolith sample bed beside the excavation area', mobility: 'animated_in_place', group: 'RegolithWorkGroup', sequenceLabel: 'H-01',
    notes: 'Context evidence for rover-1: an assigned technician means this zone is supposed to be active.' },
  { id: 'H02', apiId: 'H02', scene: 'SCENE_1', role: 'Logistics / utility worker: kneeling at the staged power connector (CableRun-17, PowerNode-B)', mobility: 'animated_in_place', group: 'CableWorkGroup', sequenceLabel: 'H-02',
    notes: 'Nominal exterior worker; its expected location is the baseline later scenes compare against.' },
  { id: 'H03', apiId: 'H03', scene: 'SCENE_1', role: 'Surface maintenance worker: thermal-control review pause (wiping brow)', mobility: 'animated_in_place', group: 'SurfaceMaintenanceGroup',
    notes: 'Exterior nominal reference, not in the primary sequence. Sits beside the habitat approach walkway.' },
  { id: 'H04', apiId: 'H04', scene: 'SCENE_1', role: 'Logistics inventory worker: writing the cargo log beside LOGISTICS-ROVER-01', mobility: 'animated_in_place', group: 'LogisticsGroup',
    notes: 'Exterior nominal reference near the spawn; occupies the east side of the apron close to the first leg.' },
  { id: 'H06', apiId: 'H06', scene: 'SCENE_1', role: 'Surface mobility recovery cue (slumped posture) near the habitat approach', mobility: 'animated_in_place', group: 'AirlockGroup',
    notes: 'Exterior recovery beat. Natural stand-in for the H-08 hold/recovery role if Scene 3 is staged outdoors.' },
  { id: 'EXC-01', apiId: 'rover-1', scene: 'SCENE_1', role: 'Lunar excavator: primary Scene 1 verification target (approach → inspect → activate → verify)', mobility: 'static', group: 'RegolithWorkGroup' },
  { id: 'EXC-02', apiId: 'EXC-02', scene: 'SCENE_1', role: 'Traditional excavator staged west of the work apron', mobility: 'static', group: 'RegolithWorkGroup' },
  { id: 'CABLE-ROVER-01', apiId: 'CABLE-ROVER-01', scene: 'SCENE_1', role: 'Cable deployment rover (staged, cable run 17)', mobility: 'static', group: 'CableWorkGroup' },
  { id: 'PowerNode-B', apiId: 'PowerNode-B', scene: 'SCENE_1', role: 'Power node / cable endpoint for the habitat feed', mobility: 'static', group: 'CableWorkGroup' },
  { id: 'ROVER-01', apiId: 'ROVER-01', scene: 'SCENE_1', role: 'Driving rover on the east loop (background traffic)', mobility: 'patrol', group: 'LogisticsGroup',
    notes: 'Crosses the east apron between z -6 and -14; never assume its last position.' },
  { id: 'LOGISTICS-ROVER-01', apiId: 'LOGISTICS-ROVER-01', scene: 'SCENE_1', role: 'Logistics rover on the east walkway loop (background traffic)', mobility: 'patrol', group: 'LogisticsGroup',
    notes: 'Loops around x 8-12, z -1..1.6, right beside H04 and Walkway-East.' },
  { id: 'Airlock-2A', apiId: 'Airlock-2A', scene: 'SCENE_1', role: 'Habitat front entrance = the airlock; physical proximity triggers the Scene 1 → Scene 2 transition', mobility: 'door', group: 'AirlockGroup' },
];

export interface HumanoidSequenceEntry {
  label: string;
  role: string;
  scene: SceneId;
  /** Present in the map today, or planned (data-only fill-in when the asset is placed). */
  placement:
    | { status: 'placed'; sceneObjectId: string; apiId: string }
    | { status: 'planned'; sceneObjectId: null; suggestedPosition: readonly [number, number, number] | null; region: string | null; reason: string };
  relationships: readonly string[];
  /** The physical-truth question Go2 answers at this humanoid. */
  question: string;
  /** What Go2 actually does when it reaches it. */
  behaviour: string;
}

/** The user's canonical reasoning sequence, aligned to what the map contains. */
export const HUMANOID_SEQUENCE: readonly HumanoidSequenceEntry[] = [
  { label: 'H-01', role: 'Excavation Technician', scene: 'SCENE_1',
    placement: { status: 'placed', sceneObjectId: 'H01', apiId: 'digging-bot' },
    relationships: ['H-01 → assigned near → rover-1', 'rover-1 → performs → RegolithExcavation-04', 'H-01 → locatedAt → Stop-H01'],
    question: 'Is this an active excavation work zone whose personnel context matches what rover-1 claims?',
    behaviour: 'Pass or approach (standoff), observe, record the technician as context evidence; no interaction.' },
  { label: 'H-02', role: 'Logistics / Utility Worker', scene: 'SCENE_1',
    placement: { status: 'placed', sceneObjectId: 'H02', apiId: 'H02' },
    relationships: ['H-02 → assigned to → exterior utility/logistics zone', 'H-02 → locatedAt → Stop-H02 (CableRun-17 / PowerNode-B)'],
    question: 'Is H-02 at its expected utility location while the site is nominal?',
    behaviour: 'Pass on the way to the habitat; store the observed position as the trusted baseline.' },
  { label: 'H-03', role: 'Airlock / Habitat Technician', scene: 'SCENE_2',
    placement: { status: 'planned', sceneObjectId: null, suggestedPosition: [0.9, 0, -3.8], region: 'Museum-Foyer', reason: 'Scene 2 has no placed humanoids yet' },
    relationships: ['H-03 → works near → Airlock', 'Airlock → protects → interior habitat', 'Airlock controller → reports → SEALED', 'Go2 → physically observes → airlock condition'],
    question: 'Does the physical evidence at the hatch agree with the controller claim SEALED?',
    behaviour: 'Approach the interior airlock zone, observe the seal region, compare with the controller report.' },
  { label: 'H-04', role: 'Interior Operations Worker', scene: 'SCENE_2',
    placement: { status: 'planned', sceneObjectId: null, suggestedPosition: [-1.0, 0, -2.0], region: 'Museum-Foyer', reason: 'Scene 2 has no placed humanoids yet' },
    relationships: ['H-04 → expected at → interior operations post', 'H-04 → depends on → airlock state and safe routing'],
    question: 'Does the physically observed location of H-04 match where the mission system believes it is?',
    behaviour: 'Localise visually while crossing the room; report expected vs observed position.' },
  { label: 'H-05', role: 'Shelter / Route Worker', scene: 'SCENE_2',
    placement: { status: 'planned', sceneObjectId: null, suggestedPosition: [0.8, 0, 0.3], region: 'Museum-Foyer', reason: 'Scene 2 has no placed humanoids yet' },
    relationships: ['H-05 → has destination → shelter assignment', 'destination → depends on → safe route', 'route → depends on → airlock/corridor usable'],
    question: 'Does the route H-05 is assigned to still exist physically?',
    behaviour: 'Observe corridor/route state near H-05; a physical change here re-routes personnel.' },
  { label: 'H-06', role: 'Position-Conflict Worker', scene: 'SCENE_3',
    placement: { status: 'planned', sceneObjectId: null, suggestedPosition: null, region: null, reason: 'Scene 3 world is not built; stage outdoors with H06 if needed' },
    relationships: ['network → reports → position A', 'Go2 → observes → position B', 'Moontology → decides → which source is authoritative'],
    question: 'Where is H-06 physically, versus where the network says it is?',
    behaviour: 'Observe and record the discrepancy; Go2 becomes the local anchor.' },
  { label: 'H-07', role: 'Route-Dependent Worker', scene: 'SCENE_3',
    placement: { status: 'planned', sceneObjectId: null, suggestedPosition: null, region: null, reason: 'Scene 3 world is not built' },
    relationships: ['navigation source → proposes → route', 'local observation → contradicts → route', 'H-07 → depends on → route'],
    question: 'Does the proposed route physically exist (no trench, obstruction, boundary)?',
    behaviour: 'Travel toward the route feature, establish what exists; route authority changes if the map is wrong.' },
  { label: 'H-08', role: 'Hold / Recovery Worker', scene: 'SCENE_3',
    placement: { status: 'planned', sceneObjectId: null, suggestedPosition: null, region: null, reason: 'Scene 3 world is not built; H06 (slumped recovery) is the outdoor stand-in' },
    relationships: ['H-08 → represents → humanoid fleet', 'trust model change → holds → affected humanoids'],
    question: 'Is the positioning problem systemic enough to hold the fleet?',
    behaviour: 'Observe; recommend holdFleet until a trusted local frame exists.' },
];

export type LegKind = 'context_pass' | 'inspect' | 'transition' | 'planned';

export interface RouteLeg {
  /** Map API target id (asset alias or layout region id). */
  target: string;
  kind: LegKind;
  purpose: string;
  /** Sequence label this leg serves, if any. */
  sequenceLabel?: string;
  /** Mobile targets are re-observed immediately before the approach. */
  reobserveBeforeApproach: boolean;
  /** Excavator-only interaction chain after arrival. */
  interactions?: readonly string[];
  /** Layout affordance at arrival (doorway). */
  arrivalAction?: string;
}

export interface SceneRoute {
  scene: SceneId;
  status: 'runnable' | 'planned_no_assets' | 'not_built';
  start: { x: number; z: number; yaw: number } | null;
  legs: readonly RouteLeg[];
  notes: readonly string[];
}

export const SCENE_ROUTES: readonly SceneRoute[] = [
  { scene: 'SCENE_1', status: 'runnable',
    start: { x: SCENE_1_ROUTE_SPAWN.x, z: SCENE_1_ROUTE_SPAWN.z, yaw: SCENE_1_ROUTE_SPAWN.rotationY },
    legs: [
      { target: 'digging-bot', kind: 'context_pass', sequenceLabel: 'H-01', reobserveBeforeApproach: true,
        purpose: 'Enter the worksite past the excavation technician; establish the active work-zone context.' },
      { target: 'rover-1', kind: 'inspect', reobserveBeforeApproach: false, interactions: ['inspect', 'activate', 'verify'],
        purpose: 'Primary verification: does the excavator physically do what its software state claims?' },
      { target: 'H02', kind: 'context_pass', sequenceLabel: 'H-02', reobserveBeforeApproach: true,
        purpose: 'Pass the utility worker heading south; record its nominal location baseline.' },
      { target: 'Doorway-2A', kind: 'transition', reobserveBeforeApproach: false, arrivalAction: 'enter_world_2',
        purpose: 'Reach the habitat front entrance (Airlock-2A). Physical proximity to the airlock triggers Scene 2.' },
    ],
    notes: [
      'The Scene 1 rehearsal panel uses a different cue order (H04 → H01 → H02 → H03 → H06 → airlock); that order drives clip cues, not the Go2 verification story.',
      'Background rovers patrol the east side; the west/south path above stays clear of both loops.',
    ] },
  { scene: 'SCENE_2', status: 'planned_no_assets', start: { x: 0, z: 0, yaw: Math.PI / 2 },
    legs: [
      { target: 'H-03', kind: 'planned', sequenceLabel: 'H-03', reobserveBeforeApproach: true, purpose: 'Airlock / habitat technician at the interior airlock zone.' },
      { target: 'H-04', kind: 'planned', sequenceLabel: 'H-04', reobserveBeforeApproach: true, purpose: 'Interior operations worker: expected vs observed position.' },
      { target: 'H-05', kind: 'planned', sequenceLabel: 'H-05', reobserveBeforeApproach: true, purpose: 'Shelter / route worker: infrastructure state → personnel routing.' },
    ],
    notes: [
      'Scene 2 ("Futuristic Museum Interiors") currently has one measured floor region, Museum-Foyer, 3.6 × 6.2 units, and no placed assets.',
      'Suggested humanoid positions in HUMANOID_SEQUENCE keep ≥0.8 units from the foyer edges; place them and the legs become runnable without code changes.',
      'The second airlock / progression point does not exist yet; the foyer polygon is the traversable limit.',
    ] },
  { scene: 'SCENE_3', status: 'not_built', start: null, legs: [
      { target: 'H-06', kind: 'planned', sequenceLabel: 'H-06', reobserveBeforeApproach: true, purpose: 'Position-conflict worker.' },
      { target: 'H-07', kind: 'planned', sequenceLabel: 'H-07', reobserveBeforeApproach: true, purpose: 'Route-dependent worker.' },
      { target: 'H-08', kind: 'planned', sequenceLabel: 'H-08', reobserveBeforeApproach: true, purpose: 'Hold / recovery worker (fleet hold).' },
    ],
    notes: ['No Scene 3 world, layout or calibration exists in the repository. The reasoning roles are recorded so the ontology and agent prompt already know them.'] },
];

/** Known traps of the authored layout, phrased for an operator and for the agent. */
export const ATLAS_PITFALLS: readonly { id: string; scene: SceneId; severity: 'high' | 'medium' | 'low'; text: string }[] = [
  { id: 'buildings_no_entry', scene: 'SCENE_1', severity: 'high', text: 'Building-* regions are NO_ENTRY. "Navigate to a building" means reaching a standoff on its walkway side; the planner never enters the shell.' },
  { id: 'apron_is_unknown_beyond_polygon', scene: 'SCENE_1', severity: 'high', text: 'Everything outside Exterior-Apron rect(-17,-23 → 15,10) and the walkways is BLOCKED: unknown terrain is not traversable.' },
  { id: 'patrol_rovers_are_moving_obstacles', scene: 'SCENE_1', severity: 'medium', text: 'ROVER-01 and LOGISTICS-ROVER-01 patrol the east apron; their footprints move. Re-observe before any east-side leg.' },
  { id: 'humanoid_footprints_block_lanes', scene: 'SCENE_1', severity: 'medium', text: 'Humanoid footprints are obstacles (earlier run: "Occupied by H04"). Standoffs are planned around them; if a humanoid is re-staged, re-observe.' },
  { id: 'doorway_needs_physical_airlock_proximity', scene: 'SCENE_1', severity: 'medium', text: 'Doorway-2A exposes enter_world_2 as an affordance but the transition is triggered by the airlock controller when the Go2 is near Airlock-2A at its current registered position. It holds physical missions during the transition ("World transition: physical mission held").' },
  { id: 'scale_dominates_visual_speed', scene: 'SCENE_1', severity: 'medium', text: 'At calibrate --scale 40 (living room) a 0.25 m/s walk is 10 map units/s (~14 body lengths/s). In a larger space calibrate with a smaller scale (8–12) so map motion is legible and legs travel real metres.' },
  // Found in the 5 Sep replay rehearsal of the full Scene 1 traverse (docs/hackathon-runbook.md).
  { id: 'discrete_step_vs_footprint_clearance', scene: 'SCENE_1', severity: 'high', text: 'One MIN_PULSE step (0.3 s × 0.25 m/s) is 3 map units at scale 40 while the map rejects poses within 0.4 units of a footprint and the planner needs 1.2 units of lane clearance. The bridge therefore ends every step with ≥1.2 units of clearance and refuses a step that would graze a footprint (step_blocked_by_footprint) instead of letting the map reject the pose and kill the session. A legal step that parks the robot 0.5 units from H01 boxed it in for the next leg.' },
  { id: 'long_pulse_heading_error', scene: 'SCENE_1', severity: 'high', text: 'Heading error × pulse length is the lateral miss: a 0.24 rad error (inside the ±0.30 rad forward tolerance) over a 7-unit pulse missed the doorway lane by 1.7 units and clipped Building-North. Forward pulses are capped so the predicted miss stays ≤0.6 units (LATERAL_TOLERANCE); expect more, shorter steps on long legs.' },
  { id: 'turn_pulses_have_their_own_budget', scene: 'SCENE_1', severity: 'medium', text: 'max-steps counts forward pulses only. In-place turns (~0.35 rad each at 0.5 rad/s × 0.8 s) have a separate per-leg budget sized from the arm\'s MAX_YAW_TRAVEL (4.0 rad ≈ 13 pulses); an about-face from rover-1 to H-02 is ~8 of them. A leg that stops at step_limit / turn_limit is unfinished and simply re-runs.' },
  { id: 'arm_envelope_is_per_leg_and_resumable', scene: 'SCENE_1', severity: 'high', text: 'One arm allows 0.60 m travel, 0.45 m radius from the arm point, 4.0 rad of yaw and 90 s. The bridge checks the next pulse against what remains and ends the leg as arm_envelope_budget (resumable) instead of tripping physical_envelope. At scale 40 every leg fits one arm; at scale 10 (larger room) Doorway-2A is ~1.9 m and needs ~5 arms — each arm is an explicit operator confirmation, by design.' },
  { id: 'candidate_heading_band_must_be_clear', scene: 'SCENE_1', severity: 'high', text: 'A forward pulse fires anywhere within ±0.30 rad of the chosen heading, so a candidate step is accepted only if the whole band is footprint-free. Checking only the current yaw made the choice flip between two candidates on alternate turn pulses (eight wasted pulses at the doorway lane) and drove a clipped corner at H01.' },
  { id: 'waypoint_kind_decides_arrival', scene: 'SCENE_1', severity: 'high', text: 'The planner labels each waypoint here / goal / path_node. Only a goal (a point on the standoff ring) within 40% of one physical step counts as arrival; a path_node is a corner of a grid-searched detour that may lead away from the target first, so progress toward it is measured toward the node and standing next to it is never arrival.' },
  { id: 'map_tab_must_stay_foreground', scene: 'SCENE_1', severity: 'high', text: 'The map publishes only while its browser tab renders: a background tab or a sleeping display raises render_age_ms above 750 and the freshness gate stops the run (presentation_tab_hidden_or_render_stale). Keep the map tab in front and run `caffeinate -u -t 14400` during the session.' },
  { id: 'scene2_is_tiny', scene: 'SCENE_2', severity: 'high', text: 'Museum-Foyer is 3.6 × 6.2 units. Any Scene 2 leg is a couple of steps; keep max-steps small and expect boundary stops.' },
  { id: 'scene3_absent', scene: 'SCENE_3', severity: 'low', text: 'Scene 3 is not built; do not schedule Scene 3 legs in a live session.' },
];

export const mobilityOf = (id: string): Mobility | null => ATLAS_ENTITY_ROLES.find(e => e.id === id || e.apiId === id)?.mobility ?? null;
export const sequenceLabelOf = (id: string): string | null => ATLAS_ENTITY_ROLES.find(e => e.id === id || e.apiId === id)?.sequenceLabel ?? null;
export const roleOf = (id: string): string | null => ATLAS_ENTITY_ROLES.find(e => e.id === id || e.apiId === id)?.role ?? null;

/** Authored (expected) world position for a Scene 1 object, or null when unknown. */
export const expectedPositionOf = (id: string): readonly [number, number, number] | null => {
  const stop = SCENE_1_STOPS.find(s => s.id === id);
  if (stop) return stop.position;
  const staged = EQUIPMENT_STAGING[id];
  if (staged) return staged.position;
  if (id === 'GO2-01') return [SCENE_1_ROUTE_SPAWN.x, SCENE_1_ROUTE_SPAWN.y, SCENE_1_ROUTE_SPAWN.z];
  if (id === 'Airlock-2A') return AIRLOCK_PLACEMENT.position;
  return null;
};

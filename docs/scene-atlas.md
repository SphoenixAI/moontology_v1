# Scene atlas — Go2 boot-time map knowledge

Generated 2026-09-05T14:28:10.385Z by `scripts/build-scene-atlas.mjs` from `src/levels/sceneLayouts.ts`, `src/levels/sceneAtlas.ts`, `src/levels/scene1DemoRoute.ts`, `src/levels/scene1StaticAssets.ts`, `src/vehicles/BackgroundTraffic.ts`, `src/levels/airlockPlacement.ts`, `src/relay/approach.ts`. Do not edit by hand: change the sources and rebuild (`node scripts/build-scene-atlas.mjs`). `node scripts/build-scene-atlas.mjs --check` fails when this file is stale.

Frame: `three_world`, +Y up, forward at zero yaw = +X, positive yaw turns toward −Z. Units are world units; physical metres = units ÷ `meters_to_world_units` (the `calibrate --scale` value). All Scene 1 positions below are on the support floor at y = -0.23.

## Mobility classes (what the agent must assume)

- `static` — authored placement, never moves
- `animated_in_place` — plays clips at its stop; treat as mobile (may be re-staged); re-observe before approaching
- `patrol` — BackgroundTraffic loop; moving obstacle; position valid only at observation time
- `agent` — the Go2
- `door` — fixed portal whose state changes

## Worlds

### SCENE_1 — Exterior lunar operations (World Labs · Level 1) (built)

Layout revision 4, support floor bounds [-32,-32,32,24] at y -0.23. Spawn {"x":1.5,"y":0,"z":5,"rotationY":0.65}; physical forward axis `x`, lateral `-z`.

| Region | Kind | Traversable | Centroid (x, z) | Actions | Notes |
|---|---|---|---|---|---|
| `Exterior-Apron` | terrain | yes | -1, -6.5 | walk | Exterior work apron |
| `Walkway-Central` | walkway | yes | 1.029, -4.429 | walk | Central raised walkway |
| `Walkway-West` | walkway | yes | -7.2, 1.82 | walk | West service walkway |
| `Walkway-East` | walkway | yes | 7, 2 | walk | East logistics walkway |
| `Walkway-Habitat` | walkway | yes | -0.075, -13.333 | walk | Habitat entrance walkway |
| `Building-North` | building | NO_ENTRY | -5.822, -19.067 | — | North habitat shell |
| `Building-West` | building | NO_ENTRY | -14.489, 6.744 | — | West habitat shell |
| `Building-East` | building | NO_ENTRY | 18.667, 9.5 | — | East habitat shell |
| `Building-South` | building | NO_ENTRY | 7, 16 | — | South habitat shell |
| `Doorway-2A` | doorway | yes | -0.6, -16.925 | approach, enter_world_2 | Habitat doorway to World 2 → SCENE_2 |

Airlock: `Airlock-2A` at [-0.6,0.95,-18.35] inside `Doorway-2A`; proximity to Airlock-2A → fade → load SCENE_2 (physical missions held during the transition).

Obstacle footprints (snapshot:snapshot:live:http://127.0.0.1:5174/api/map, 2026-09-05T09:48:59.083Z): `H01`, `H04`, `H02`, `H03`, `H06`, `EXC-01`, `EXC-02`, `CABLE-ROVER-01`, `PowerNode-B`.

### SCENE_2 — Interior operations facility (World Labs · Scene 2, "Futuristic Museum Interiors") (built_no_assets)

Layout revision 1. Spawn {"x":0,"y":0,"z":0,"rotationY":1.5707963267948966}; physical forward axis `-z`, lateral `-x`.

| Region | Kind | Traversable | Centroid (x, z) | Actions | Notes |
|---|---|---|---|---|---|
| `Museum-Foyer` | floor | yes | 0, -1.9 | walk | World 2 entrance foyer |

### SCENE_3 — Ghost clock (trust scene) (not_built)

No layout, calibration or assets exist for this world.

## Entities

| Scene id | API id | Mobility | Label | Role | Expected (x, z) | Recognition |
|---|---|---|---|---|---|---|
| `GO2-01` | `GO2-01` | **agent** | — | Mobile physical-truth verifier (this robot) | 1.50, 5.00 | — |
| `H01` | `digging-bot` | **animated_in_place** | H-01 | Excavation technician: regolith sample bed beside the excavation area | -5.90, 0.40 | clip “Dig And Plant Seeds” (DIGGING_SAMPLE_BED), beside EXC-01 |
| `H02` | `H02` | **animated_in_place** | H-02 | Logistics / utility worker: kneeling at the staged power connector (CableRun-17, PowerNode-B) | -4.90, -5.60 | clip “Kneeling Inspecting” (KNEELING_INSPECTION), beside CABLE-ROVER-01 |
| `H03` | `H03` | **animated_in_place** | — | Surface maintenance worker: thermal-control review pause (wiping brow) | 1.80, -6.50 | clip “h01-sweat” (WIPING_BROW), beside ROVER-01 |
| `H04` | `H04` | **animated_in_place** | — | Logistics inventory worker: writing the cargo log beside LOGISTICS-ROVER-01 | 5.20, 1.40 | clip “Writing” (WRITING_INVENTORY), beside LOGISTICS-ROVER-01 |
| `H06` | `H06` | **animated_in_place** | — | Surface mobility recovery cue (slumped posture) near the habitat approach | 4.40, -10.40 | clip “Defeat” (SLUMPED_POSTURE), beside Airlock-2A |
| `EXC-01` | `rover-1` | **static** | — | Lunar excavator: primary Scene 1 verification target (approach → inspect → activate → verify) | -9.30, -0.50 | /models/rovers/lunar%20excavator.glb |
| `EXC-02` | `EXC-02` | **static** | — | Traditional excavator staged west of the work apron | -14.00, -3.40 | /models/static/excavator%20traditional.glb |
| `CABLE-ROVER-01` | `CABLE-ROVER-01` | **static** | — | Cable deployment rover (staged, cable run 17) | -8.00, -7.20 | /models/static/cable.glb |
| `PowerNode-B` | `PowerNode-B` | **static** | — | Power node / cable endpoint for the habitat feed | -5.30, -6.20 | — |
| `ROVER-01` | `ROVER-01` | **patrol** | — | Driving rover on the east loop (background traffic) | 8.30, -6.00 | patrol 7 pts @ 0.65 u/s |
| `LOGISTICS-ROVER-01` | `LOGISTICS-ROVER-01` | **patrol** | — | Logistics rover on the east walkway loop (background traffic) | 8.50, 1.40 | patrol 6 pts @ 0.48 u/s |
| `Airlock-2A` | `Airlock-2A` | **door** | — | Habitat front entrance = the airlock; physical proximity triggers the Scene 1 → Scene 2 transition | -0.60, -18.35 | — |

Notes:

- `H01`: Context evidence for rover-1: an assigned technician means this zone is supposed to be active.
- `H02`: Nominal exterior worker; its expected location is the baseline later scenes compare against.
- `H03`: Exterior nominal reference, not in the primary sequence. Sits beside the habitat approach walkway.
- `H04`: Exterior nominal reference near the spawn; occupies the east side of the apron close to the first leg.
- `H06`: Exterior recovery beat. Natural stand-in for the H-08 hold/recovery role if Scene 3 is staged outdoors.
- `ROVER-01`: Crosses the east apron between z -6 and -14; never assume its last position.
- `LOGISTICS-ROVER-01`: Loops around x 8-12, z -1..1.6, right beside H04 and Walkway-East.

## Humanoid reasoning sequence

| Label | Role | Scene | Placement | Question Go2 answers |
|---|---|---|---|---|
| **H-01** | Excavation Technician | SCENE_1 | `H01` (API `digging-bot`) | Is this an active excavation work zone whose personnel context matches what rover-1 claims? |
| **H-02** | Logistics / Utility Worker | SCENE_1 | `H02` (API `H02`) | Is H-02 at its expected utility location while the site is nominal? |
| **H-03** | Airlock / Habitat Technician | SCENE_2 | planned at [0.9,0,-3.8] in `Museum-Foyer` — Scene 2 has no placed humanoids yet | Does the physical evidence at the hatch agree with the controller claim SEALED? |
| **H-04** | Interior Operations Worker | SCENE_2 | planned at [-1,0,-2] in `Museum-Foyer` — Scene 2 has no placed humanoids yet | Does the physically observed location of H-04 match where the mission system believes it is? |
| **H-05** | Shelter / Route Worker | SCENE_2 | planned at [0.8,0,0.3] in `Museum-Foyer` — Scene 2 has no placed humanoids yet | Does the route H-05 is assigned to still exist physically? |
| **H-06** | Position-Conflict Worker | SCENE_3 | planned — Scene 3 world is not built; stage outdoors with H06 if needed | Where is H-06 physically, versus where the network says it is? |
| **H-07** | Route-Dependent Worker | SCENE_3 | planned — Scene 3 world is not built | Does the proposed route physically exist (no trench, obstruction, boundary)? |
| **H-08** | Hold / Recovery Worker | SCENE_3 | planned — Scene 3 world is not built; H06 (slumped recovery) is the outdoor stand-in | Is the positioning problem systemic enough to hold the fleet? |

Relationships and behaviour per label:

- **H-01** `H-01 → assigned near → rover-1`; `rover-1 → performs → RegolithExcavation-04`; `H-01 → locatedAt → Stop-H01`. Behaviour: Pass or approach (standoff), observe, record the technician as context evidence; no interaction.
- **H-02** `H-02 → assigned to → exterior utility/logistics zone`; `H-02 → locatedAt → Stop-H02 (CableRun-17 / PowerNode-B)`. Behaviour: Pass on the way to the habitat; store the observed position as the trusted baseline.
- **H-03** `H-03 → works near → Airlock`; `Airlock → protects → interior habitat`; `Airlock controller → reports → SEALED`; `Go2 → physically observes → airlock condition`. Behaviour: Approach the interior airlock zone, observe the seal region, compare with the controller report.
- **H-04** `H-04 → expected at → interior operations post`; `H-04 → depends on → airlock state and safe routing`. Behaviour: Localise visually while crossing the room; report expected vs observed position.
- **H-05** `H-05 → has destination → shelter assignment`; `destination → depends on → safe route`; `route → depends on → airlock/corridor usable`. Behaviour: Observe corridor/route state near H-05; a physical change here re-routes personnel.
- **H-06** `network → reports → position A`; `Go2 → observes → position B`; `Moontology → decides → which source is authoritative`. Behaviour: Observe and record the discrepancy; Go2 becomes the local anchor.
- **H-07** `navigation source → proposes → route`; `local observation → contradicts → route`; `H-07 → depends on → route`. Behaviour: Travel toward the route feature, establish what exists; route authority changes if the map is wrong.
- **H-08** `H-08 → represents → humanoid fleet`; `trust model change → holds → affected humanoids`. Behaviour: Observe; recommend holdFleet until a trusted local frame exists.

## Routes

### SCENE_1 (runnable)

Start {"x":1.5,"z":5,"yaw":0.65}.

| # | Target | Kind | Label | Mobile | Turn first (rad) | Path (units) | Standoff at arrival | Face target (rad) | Arrival region | Waypoints | Purpose |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `digging-bot` | context_pass | H-01 | yes (re-observe) | 1.94 | 6.41 | 2.30 | 0.00 | Walkway-West | (-3.95, 1.61) | Enter the worksite past the excavation technician; establish the active work-zone context. |
| 2 | `rover-1` | inspect | — | no | none (already in ring) | 0.00 | 5.75 | 0.18 | Walkway-West | — | Primary verification: does the excavator physically do what its software state claims? Then: inspect → activate → verify. |
| 3 | `H02` | context_pass | H-02 | yes (re-observe) | -1.06 | 4.98 | 2.30 | 0.00 | Exterior-Apron | (-4.60, -3.32) | Pass the utility worker heading south; record its nominal location baseline. |
| 4 | `Doorway-2A` | transition | — | no | -0.81 | 12.96 | 2.80 | 0.00 | Exterior-Apron | (1.00, -10.32) → (0.06, -14.20) | Reach the habitat front entrance (Airlock-2A). Physical proximity to the airlock triggers Scene 2. Affordance: `enter_world_2`. |

Total planned path 24.35 units = 0.609 m at scale 40 (living room), 2.44 m at scale 10, 6.09 m at scale 4.
- The Scene 1 rehearsal panel uses a different cue order (H04 → H01 → H02 → H03 → H06 → airlock); that order drives clip cues, not the Go2 verification story.
- Background rovers patrol the east side; the west/south path above stays clear of both loops.

### SCENE_2 (planned_no_assets)

Start {"x":0,"z":0,"yaw":1.5707963267948966}.

- 1. **H-03** (planned) — Airlock / habitat technician at the interior airlock zone. Placement: planned at [0.9,0,-3.8].
- 2. **H-04** (planned) — Interior operations worker: expected vs observed position. Placement: planned at [-1,0,-2].
- 3. **H-05** (planned) — Shelter / route worker: infrastructure state → personnel routing. Placement: planned at [0.8,0,0.3].
- Scene 2 ("Futuristic Museum Interiors") currently has one measured floor region, Museum-Foyer, 3.6 × 6.2 units, and no placed assets.
- Suggested humanoid positions in HUMANOID_SEQUENCE keep ≥0.8 units from the foyer edges; place them and the legs become runnable without code changes.
- The second airlock / progression point does not exist yet; the foyer polygon is the traversable limit.

### SCENE_3 (not_built)

- 1. **H-06** (planned) — Position-conflict worker. Placement: planned.
- 2. **H-07** (planned) — Route-dependent worker. Placement: planned.
- 3. **H-08** (planned) — Hold / recovery worker (fleet hold). Placement: planned.
- No Scene 3 world, layout or calibration exists in the repository. The reasoning roles are recorded so the ontology and agent prompt already know them.

## Pitfalls

- **high** · SCENE_1 · `buildings_no_entry`: Building-* regions are NO_ENTRY. "Navigate to a building" means reaching a standoff on its walkway side; the planner never enters the shell.
- **high** · SCENE_1 · `apron_is_unknown_beyond_polygon`: Everything outside Exterior-Apron rect(-17,-23 → 15,10) and the walkways is BLOCKED: unknown terrain is not traversable.
- **medium** · SCENE_1 · `patrol_rovers_are_moving_obstacles`: ROVER-01 and LOGISTICS-ROVER-01 patrol the east apron; their footprints move. Re-observe before any east-side leg.
- **medium** · SCENE_1 · `humanoid_footprints_block_lanes`: Humanoid footprints are obstacles (earlier run: "Occupied by H04"). Standoffs are planned around them; if a humanoid is re-staged, re-observe.
- **medium** · SCENE_1 · `doorway_needs_physical_airlock_proximity`: Doorway-2A exposes enter_world_2 as an affordance but the transition is triggered by the airlock controller when the Go2 is near Airlock-2A at its current registered position. It holds physical missions during the transition ("World transition: physical mission held").
- **medium** · SCENE_1 · `scale_dominates_visual_speed`: At calibrate --scale 40 (living room) a 0.25 m/s walk is 10 map units/s (~14 body lengths/s). In a larger space calibrate with a smaller scale (8–12) so map motion is legible and legs travel real metres.
- **high** · SCENE_1 · `discrete_step_vs_footprint_clearance`: One MIN_PULSE step (0.3 s × 0.25 m/s) is 3 map units at scale 40 while the map rejects poses within 0.4 units of a footprint and the planner needs 1.2 units of lane clearance. The bridge therefore ends every step with ≥1.2 units of clearance and refuses a step that would graze a footprint (step_blocked_by_footprint) instead of letting the map reject the pose and kill the session. A legal step that parks the robot 0.5 units from H01 boxed it in for the next leg.
- **high** · SCENE_1 · `long_pulse_heading_error`: Heading error × pulse length is the lateral miss: a 0.24 rad error (inside the ±0.30 rad forward tolerance) over a 7-unit pulse missed the doorway lane by 1.7 units and clipped Building-North. Forward pulses are capped so the predicted miss stays ≤0.6 units (LATERAL_TOLERANCE); expect more, shorter steps on long legs.
- **medium** · SCENE_1 · `turn_pulses_have_their_own_budget`: max-steps counts forward pulses only. In-place turns (~0.35 rad each at 0.5 rad/s × 0.8 s) have a separate per-leg budget sized from the arm's MAX_YAW_TRAVEL (4.0 rad ≈ 13 pulses); an about-face from rover-1 to H-02 is ~8 of them. A leg that stops at step_limit / turn_limit is unfinished and simply re-runs.
- **high** · SCENE_1 · `arm_envelope_is_per_leg_and_resumable`: One arm allows 0.60 m travel, 0.45 m radius from the arm point, 4.0 rad of yaw and 90 s. The bridge checks the next pulse against what remains and ends the leg as arm_envelope_budget (resumable) instead of tripping physical_envelope. At scale 40 every leg fits one arm; at scale 10 (larger room) Doorway-2A is ~1.9 m and needs ~5 arms — each arm is an explicit operator confirmation, by design.
- **high** · SCENE_1 · `candidate_heading_band_must_be_clear`: A forward pulse fires anywhere within ±0.30 rad of the chosen heading, so a candidate step is accepted only if the whole band is footprint-free. Checking only the current yaw made the choice flip between two candidates on alternate turn pulses (eight wasted pulses at the doorway lane) and drove a clipped corner at H01.
- **high** · SCENE_1 · `waypoint_kind_decides_arrival`: The planner labels each waypoint here / goal / path_node. Only a goal (a point on the standoff ring) within 40% of one physical step counts as arrival; a path_node is a corner of a grid-searched detour that may lead away from the target first, so progress toward it is measured toward the node and standing next to it is never arrival.
- **high** · SCENE_1 · `map_tab_must_stay_foreground`: The map publishes only while its browser tab renders: a background tab or a sleeping display raises render_age_ms above 750 and the freshness gate stops the run (presentation_tab_hidden_or_render_stale). Keep the map tab in front and run `caffeinate -u -t 14400` during the session.
- **high** · SCENE_2 · `scene2_is_tiny`: Museum-Foyer is 3.6 × 6.2 units. Any Scene 2 leg is a couple of steps; keep max-steps small and expect boundary stops.
- **low** · SCENE_3 · `scene3_absent`: Scene 3 is not built; do not schedule Scene 3 legs in a live session.

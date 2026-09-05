# Scene 1 rehearsal and machine ownership

The proposed assignment is MacBook Air = Cursor development, local map server,
and ONE foreground director browser; Intel external laptop = operator notes,
bridge health and telemetry monitoring; Orin = dimOS / Go2 bridge. This is an
assignment for the current architecture, not a benchmark or a claim that either
laptop has been configured. Intel does not prevent browser use. Test its actual
GPU/memory before assigning it the 3D view. Opening the map on another machine
creates a separate simulation, not a synchronized spectator.

## Run the scene

1. Start the map on the Air with `npm run dev`. Open Scene 1 (no `?scene2`).
2. Expand **Scene rehearsal**. Require **5/5 animated humanoids** and a loaded Go2.
   A missing clip or actor blocks the entire run; do not silently skip a scene beat.
3. Select **Arm / Resume**. Drive the virtual Go2 to within 2 world units of a
   humanoid and remain there for one second. Coordinates come from AgentRoot
   and the placed humanoid root, so edits change trigger positions too.
4. You can also choose an actor and select **Cue selected once** after arming.
   Manual cues obey the same completion and overlap guards.
   Its existing clip plays once, with a 20-second cap. Only one actor plays at
   a time. A two-second gap separates cues. Completed actors cannot retrigger
   until **Reset run**. Nearest actor wins; ID breaks an exact distance tie.
5. **Pause cues** freezes animations and the cue clock. Resume is explicit.
   **Reset run** rewinds clips and clears only rehearsal completion, leaving
   placement, ontology state, and robot alignment alone.

The proximity distance assumes Scene 1 units are meters. Recheck calibration
before using physical odometry. This is a clip rehearsal, not an authored
storyline: the current clips include digging, writing, inspecting, kicking,
sweating and defeat. Kicking/defeat must not be presented as evidence of a real
cable or worker fault. Automatic scene cues do not confirm ontology observations.

## Timing and interruption behavior

- No wall-clock timers or queued bursts: one animation-loop clock advances cues.
- Leaving a proximity zone before one second resets the dwell.
- An active cue finishes even if Go2 leaves its zone; it never restarts on re-entry.
- Hidden tab, frames over 250 ms, lost previously established robot telemetry,
  missing actors, or an airlock transition pause the director. No reconnect replay.
- Scene 2 has no authored humanoid placements. Scene 1 actors remain hidden there;
  the director blocks instead of using outdoor coordinates inside the museum.
- Reload starts a new unarmed run. Rehearsal state is intentionally not persisted.
- The existing airlock controller is separate: pausing cues does not disable
  its triggers. Entering the airlock pauses this rehearsal before further cues.

## Hardware rehearsal gates

Start with keyboard-only virtual Go2 and the six actors. Then connect read-only
telemetry and verify physical origin, yaw, world scale and timestamp freshness.
Walk the physical Go2 only under the existing bridge/operator procedure in
`robot-bridge/README.md`. Scene proximity is not obstacle detection, a planner,
physical collision avoidance, or proof that Go2 has perceived an actor.

Cue controls send no physical movement commands. **Pause cues is not STOP.**
Keep the independent robot STOP available and test the bridge watchdog before
bounded motion. Preserve the bridge's command-disabled default. On a telemetry
fault, pause the scene and use the robot's stop procedure; do not assume browser
animation state stops hardware. The current map has no synchronized spectator
protocol, exclusive multi-browser command lease, or remote scene director.
Use one command-capable browser and keep all other stations observational.

## Checks before a timed demo

- All five models, skinning and embedded clips visible; no missing textures.
- Stable foreground frame rate with the actual splat and intended laptop/display.
- Hover on a trigger boundary; leave/re-enter; approach two actors; finish a run.
- Pause/resume mid-clip; reset mid-clip; hide/restore tab; interrupt telemetry.
- Enter airlock mid-cue; reload; fail one asset request. Each must stay visibly
  paused/blocked rather than inventing completion.
- Confirm physical perception/inspection separately from the visual rehearsal.

Automated director checks: `node --test tests/scene-director.test.mjs` (Node 22.18+
with native TypeScript support). Real Go2, LAN latency, Intel laptop graphics,
and a full Air performance soak still require testing on those machines.

## Asset preparation

The scene now uses six **byte-identical FBX copies** in
`public/models/humanoids/full-fidelity/`. All seven existing source FBXs are
untouched. `full-fidelity/manifest.json` records original and copy SHA-256 hashes;
`python3 tools/prepare-humanoid-copies.py` verifies them without overwriting models.
No geometry reduction, texture resizing/recompression, animation conversion,
or skin-weight export is applied to these copies. Native display pixel ratio
is restored. Existing in-scene sizing and placement remain unchanged.

The earlier ~16.9 MB GLBs remain separately in `optimized/`. They are lossy
previews with a 60,000-face mesh budget and at most four exported joint influences.
They are no longer the map default. The preview exporter now requires the explicit
`--allow-lossy-preview` argument, so it cannot silently simplify a later asset.
Pre-change configuration/script copies are in `backups/humanoid-fidelity-2026-09-04/`.

Exact copies preserve file data, but they do not make the meshes cheaper to draw.
The original browser FBX loader still determines material and skinning support;
byte identity is not a promise of identical rendering to Blender. Full-resolution
FBXs use more bandwidth and memory than the reduced previews. Future improvements
should first target lossless transfer compression, sharing identical resources,
and loading schedules, with source/export comparison before any conversion.

## Earlier lightweight-preview verification

Build, lint and five director tests pass. In the full World Labs browser view,
the panel reported 6/6 animated humanoids; H01 and H06 were cued separately and
completed once. Reset returned to ready with zero completed. A viewport/frame
stall paused the rehearsal and required explicit resume. This is browser
rehearsal evidence, not a physical Go2 or Intel-laptop validation.

## Full-fidelity follow-up

Six byte-identical FBX runtime copies were verified against seven unchanged
original FBXs. Build and lint pass. The browser's FBX loader needs a narrow
compatibility fix for embedded image names ending `_jpg` / `_png`: the Vite
transform normalizes only MIME-name detection, never asset/image bytes. It
fails explicitly if the upstream loader implementation changes.

The installed FBX loader also reduces skin influences to four at runtime. All
weights remain intact in the original/copy files, but deformation parity with
the source authoring tool is not established. Native display resolution is
restored. A lossless gzip trial on Writing.fbx reduced 65.44 MB to 57.82 MB
(11.7%); no custom compression/decompression path was added for that modest gain.


## Current map and airlock integration

Current runtime actors are H01, H02, H03, H04 and H06. H05/kicking is removed
from rendered placements and selectable map markers. Its original, copy and
preview files remain on disk. The five active actors use non-decimated GLB
exports under `full-detail-glb/`; all originals and verified FBX copies remain.
Four identical worker meshes, skins, materials and embedded image byte sequences
are shared by `Shared Worker Actions.glb`, with four separately named clips.
Digging uses its separate 33-joint rig. Each source mesh retains 986,545 vertices
and 1,919,821 triangles; base-color and normal textures retain 4096×4096 dimensions.
The export report and preparation scripts record the checks. Runtime skinning
still has the existing four-influence renderer limitation; exported data retains
both weight sets. These files exceed GitHub's ordinary 100 MiB per-file limit;
Git LFS or asset hosting must be settled before a remote push/deployment.

The manually aligned facade entrance is controlled by `src/levels/airlockPlacement.ts`:
position (-0.45, 0.95, -14.8), rotation (0, 0, 0), scale (0.45, 0.45, 0.45).
Both visible art and fallback trigger bounds derive from this registration.
Triggers include the ground-level AgentRoot. The shutter retracts into its
lintel over 0.8 seconds; it cannot rise above the building while opening.

The transition reuses `loadWorld` with `SCENE_2_WORLD` and
`/worldlabs/scene-2/Futuristic%20Museum%20Interiors.spz`. A fully opaque fade
precedes the load; the new world is staged separately and activated after it
loads. Go2's virtual movement is held during entry/loading, and the existing
Scene 2 calibration/spawn is reused. The visible mission label updates to Scene 2.
The visual door cannot block progression. A missing/failed World Labs scene keeps
the exterior available; exit the threshold before retrying. One-shot guards,
45-second timeout and cleanup cover repeated entry and teardown.

Browser evidence: the isolated doorway rehearsal used the real lunar splat,
Go2, facade and real museum splat. Approach opened the door; threshold crossing
started loading approximately 0.94 seconds later; Scene 2 loaded approximately
3.81 seconds after crossing, with Go2 at (0, 0, 0). The interior was visually
verified. This isolated test omits unrelated actors and is not a hardware soak.

For development-only calibration use `?airlockTest&airlockOnly`. To test with
all actors use `?airlockTest`. Normal launch has no calibration controls; the
production build excludes them. These controls move only virtual Go2 and refuse
to run while a bridge is connected.

All changes are saved in the `/Users/sphoenix/moontology` checkout on branch
`dimos-go2`, whose origin is `SphoenixAI/moontology`. Cursor opening that same
checkout uses this source. No Git commit, push, deployment or cross-machine
synchronization was performed in this change.

Final full-scene verification: all five full-detail humanoids loaded and rendered.
A cloned-rig initialization regression was fixed by keeping the source detached
and refreshing skin bind transforms before height measurement. All five native
heights measured 0.979 units, consistently normalized to 1.75 m. The added rig
regression test verifies pristine sources, independent skeletons and shared
geometry/materials. Build, lint and all 11 automated checks passed.

The full-scene doorway walk also reached the real museum visually: transition
requested at 23:46:45.421 UTC, loading at 23:46:47.187, loaded at 23:46:53.351
on September 4, 2026. This was about 7.93 seconds after threshold entry with the
full-detail assets resident. It establishes successful integration, not measured
frame-rate or live-demo readiness on the Air/Intel/Orin infrastructure.

## Scenic route and follow camera

Scene 1 now opens behind Unitree Go2. FOLLOW GO2 follows AgentRoot position and
yaw smoothly every frame, keeping animated joints out of camera motion. FREE
CAMERA releases the view for orbiting; returning to FOLLOW GO2 recenters it.
WASD/arrows retain manual virtual driving. This does not send robot commands.

The shared route definition is `src/levels/scene1DemoRoute.ts`:

1. H04 — writing an inventory log beside the logistics rover to the east.
2. H01 — digging/sample-bed work beside the two separated excavators to the west.
3. H02 — kneeling inspection at the cable connector on the northwest side.
4. H03 — the sweat clip as a scripted fatigue check beside the support rover.
5. H06 — the defeat clip as a scripted slumped-posture assistance check near the habitat.
6. Habitat facade door — existing automatic transition into World Labs Scene 2.

The five vehicle centers are more than five meters apart. Humanoid trigger
centers are more than four meters apart, with viewing marks inside the two-meter
proximity zones. A single gold ring marks the next viewing position. The
ontology map shows a dotted itinerary and uses the same actor placements.
These are virtual staging clearances, not physical obstacle/navigation guarantees.

Arm / Resume enables the route. Only the next actor can cue, after one second
within two meters, or with Play nearby cue. Cues play once, with a two-second
gap and twenty-second cap. Pause, hidden tabs, stale telemetry and stalled
frames hold playback; Reset route restores the initial clip poses. The camera
and original map quality do not depend on arming the route. The door remains
available for direct exploration without completing the route.

Each cue updates its ontology rehearsal state and selects the actor. Animation
playback does not fabricate physical telemetry, observations, task completion,
or diagnosis. Physical evidence remains UNVERIFIED until supplied. Clip names,
behavior descriptions and task relationships now match the staged actions;
removed H05 reports and associations have been removed from the active seed.

Development-only `?routeTest` exposes virtual positioning at the next stop for
visual QA. It refuses connected/active hardware and scene transitions, and is
excluded from production. The normal demo contains only route controls.

Verification: build, lint and 16 automated checks passed. Browser QA staged
virtual Go2 at each viewing stop and confirmed all five proximity cues completed
in order without replay, finishing with habitat guidance. The chase view and
local equipment were visually checked at each stop. The ontology UI showed
H03 / Fatigue check / SIMULATED / COMPLETE with physical evidence UNVERIFIED.
QA staging verifies local views and cue behavior, not a continuous driven route
or physical collision clearance. The selection outline now reads the existing
lightweight humanoid proxy rather than scanning every hero-mesh vertex each
frame; character meshes, textures and native render resolution remain intact.

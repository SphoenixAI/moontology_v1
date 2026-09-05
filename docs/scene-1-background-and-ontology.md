# Scene 1: floor, background traffic, and nearby task graphs

Implemented in the existing Moontology scene on 2026-09-05. This is presentation animation; it does not command a physical robot.

## Contact and asset preservation

Scene 1's invisible continuous support floor is raised 0.12 m, from Y=-0.35 to Y=-0.23, with layout revision 3. Go2 and all registered workers use this support; existing building exclusion regions and the airlock corridor remain in force. Animated feet are corrected from their original normalization baseline each frame. No humanoid rig, texture, animation keyframe, source FBX, or model scale was changed.

Both vehicles from **Create game-ready rover GLB** replace the static `ROVER-01` and `LOGISTICS-ROVER-01` models. The repository copies under `public/models/animated` match those task outputs byte for byte; their SHA-256 values are recorded in `provenance.json`. The detailed rover retains its 4K textures and geometry, and the six-wheel logistics vehicle retains its 2K textures. The earlier static files remain available.

## Background schedule

- `ROVER-01`: starts after 8 seconds of active scene time; follows the outer right/rear apron at 0.65 m/s; pauses 12 seconds between laps.
- `LOGISTICS-ROVER-01`: starts after 30 seconds; follows a separate loop behind the inventory stop at 0.48 m/s; pauses 18 seconds between laps.

Closed curves and wheel rotation based on distance prevent root-motion loop jumps and wheel spinning while stationary. Vehicles check current layout occupancy and yield near Go2. They stop on semantic holds/faults, scene transitions, hidden pages, and excessive frame delays. Scene resets latch background traffic paused; the existing scene panel offers **Pause/Resume background traffic**. Editing a vehicle's placement stops its route instead of snapping it back. The cable deployment rover remains stationary for its existing inspection narrative.

The existing relay still reads current Object3D positions. Scheduled movement updates those positions without incrementing the structural scene revision every frame; added/removed entities and placement edits still invalidate prior scene context. Current moving footprints remain collision obstacles. Animation state is separate from semantic health/status. No second relay, controller, browser authority, or synchronization system was added.

## Nearby ontology graph

Humanoid clips now loop continuously by default, including while Go2 is away. Route cues still fire once per stop and do not restart those visual loops. **Pause/Resume humanoid animations** controls visual playback independently; the main Pause/Reset controls and hidden-tab pause remain available. Animation alone does not create physical observations or complete ontology tasks.

Only the nearest worker's short glass graph appears, within 3.6 m of Go2. It clears after 4.4 m to avoid flickering at the boundary and follows the animated head. Thin connectors separate the task, open hardware issues, and reasoning boxes. The graph reads the same OntologyStore as the main panel and does not change selection, manufacture observations, or complete tasks.

- **H04 / Writing:** Lunar cargo inventory. Check cargo latch/manifest; reconcile the delivery record.
- **H01 / Digging:** ISRU regolith sampling. Check bucket/joint dust; verify collected feedstock.
- **H02 / Kneeling inspection:** Power connector inspection. Check dust seals/cable feed; protect habitat power continuity.
- **H03 / Wiping brow:** Thermal-control review. A pause requests radiator/cooling evidence; the gesture itself is not a temperature measurement.
- **H06 / Slumped posture:** Surface mobility recovery. Verify drive/joint response locally; posture alone is not a confirmed hardware diagnosis.

Without evidence, the issue box says **Unverified**, and the footer says physical evidence is pending. Real open ontology alerts replace the unverified check. Discrepancies and verification requests use the central evidence comparison. Task labels follow current ontology assignments.

## Conversation and research provenance

Reviewed the complete accessible histories of **Create game-ready rover GLB**, **Build Ontology Layer**, **Lunar Base Design Research**, and **Research escape room scenes**, plus the latest reconstruction in **Hackathon Scenes 1 3 Details**. These established the near-term lunar operations setting, excavation/logistics/power chain, separate scene/physical evidence, and local verification when telemetry is untrustworthy. Existing actor IDs now follow the actual animation clips; the older conceptual H03 cable assignment was not applied over the current H02 kneeling inspection.

The task mapping draws on these primary sources, checked September 5, 2026:

- [NASA Moon Base Systems](https://www.nasa.gov/moonbase-systems/): autonomous surface mobility, logistics, power cable deployment, site preparation, and dust-tolerant connections.
- [NASA IPEx](https://www.nasa.gov/podcasts/small-steps-giant-leaps/small-steps-giant-leaps-episode-144-mining-the-moon-with-nasas-ipex-robot/): regolith excavation, abrasion, and dust-sensitive mechanisms.
- [NASA lunar surface logistics](https://ntrs.nasa.gov/api/citations/20220013667/downloads/Uncrewed%20LSO-Support-final1.pdf): cargo and inventory operations.
- [NASA dust-tolerant connectors](https://www.nasa.gov/wp-content/uploads/2024/09/24-dust-tolerant-connectors-rev-a-508.pdf): connector protection.
- [NASA Dust Mitigation](https://www.nasa.gov/dust-mitigation/): joints, seals, and thermal radiators.
- [U.S. Space Force Objective Force 2040](https://www.spaceforce.mil/Portals/2/Documents/SAF_2026/OFD_2040_Baseline.pdf), PNT / PACE discussion: resilient, multiple-source verification under degraded conditions. This informs the demo's trust model; it does not establish a Space Force lunar humanoid program or a live Scene 1 attack.

Assigning these real operational jobs to the existing humanoid animations is an explicit demo extrapolation. The prior conversations and NASA sources do not establish that these humanoids are deployed NASA hardware.

## Verification

- Typecheck, lint, and production build pass. The build retains its existing large-bundle advisory.
- 36 relevant automated checks pass across the final regression runs. These include original humanoid mesh contact at 25 samples per clip, repeated downward-pose rejection, five minutes of actual vehicle geometry traveling with every worker's occupancy present, wheel pivots, building exclusions, loop completion, Go2 yielding, fault/hold behavior, live observation revisions, and proximity/evidence separation.
- In the running presentation browser, H04's cargo graph and H03's thermal graph appeared at their stops; the graph was hidden again after virtual Go2 moved away. A 2 m virtual walk held Go2 at Y=-0.23. All five humanoids reported GROUNDED with contact Y=-0.23 and no placement issues.
- The browser's loaded-material report verified 4096×4096 color/normal maps on every humanoid, all three 4096×4096 rover maps, and all three 2048×2048 logistics-rover maps. This checks decoded runtime textures as well as unchanged source-file hashes.
- Both vehicles completed at least one lap in the actual presentation browser after the final clearance adjustment, with no placement issues or browser errors on that load.

Verification used virtual movement only. No physical robot command or GitHub push was issued. Changes are saved in the shared local repository working tree alongside existing relay and Go2 work; that unrelated work was preserved.

# Measured scene layout

The presentation map uses `src/levels/sceneLayouts.ts` for named terrain,
walkways, building footprints, and the doorway. Those polygons are authored
in the World Labs root's local meters. `SurfaceSampler` indexes the existing
collider triangles for height measurements inside those regions. It does not
promote arbitrary splat features to known semantic objects. Unregistered features
remain unknown. There are no rendered collision boxes or boundary containers.

Scene 1 has a bounded work apron, four walkway areas, four building shells,
and a narrow doorway to Scene 2. Everything outside the surveyed region is
blocked. Scene 2 currently exposes only the entrance foyer; the rest remains
unknown until separately surveyed. This is a game layout, not a physical
obstacle map or a certification of the real robot's environment.

The hidden door anchor is at X=-0.9, Z=-18.35. Its floor patch is Y=-0.72,
bridging the coarse collider triangles at the visible doorway. The corridor
ends just behind the threshold, so it cannot be used to traverse the habitat.
Both walking and the public scene-entry call require the real trigger checks.
The original airlock controller, fade, World Labs loading, and failure path remain.

Go2 uses a 0.4 m clearance radius, a 5 cm swept movement check, a 28 degree
surface limit, and a 22 cm local floor discontinuity limit. Its AgentRoot remains
authoritative; map height is applied after telemetry alignment without changing
physical calibration. Asset support comes from current Object3D transforms.
Static equipment uses its full footprint; humanoids keep animated foot contact.
The traditional excavator EXC-02 is now at X=-14, Z=-3.4, clear of the west habitat.
No original FBX, GLB, SPZ, mesh, texture, or asset scale was changed.

Registry additions and removals refresh obstacle footprints. An invalid edit
returns an existing asset to its last accepted placement. Initial invalid
placements block rehearsal and report the entity/reason. Missing surface data
blocks movement instead of inventing a flat floor.

## dimOS consumption through the live relay

The geometry source is **`window.moontology.getSnapshot().layout`**. It includes
active world, layout revision, obstacle revision, world-space polygons, valid map
actions, registered asset footprints, and Go2's accepted map pose/blocked reason.
Ontology entities also carry `surfaceRegion` and `placementStatus`.

The concurrent “Complete live map handoff” task added the shared relay in
`src/relay/LiveMapState.ts`, `src/relay/LiveMapRelay.ts`, and `server/mapRelay.js`.
Its observation serializer now preserves this snapshot as **`observation.layout`**.
Use that same feed and its session/revision/sequence/freshness checks; never copy
starting positions or create another synchronizer. The relay task owns the LAN
endpoint, browser-authority selection, and complete mission/action contract.

Laptop #2 is **10.0.0.202**, with the reported telemetry bridge at
**ws://10.0.0.202:8765**. Its SSH port 22 still refused this task's read-only probe.
The actual dimOS workspace was not inspected or changed. The physical acceptance
baseline remains `go2-dimos-physical-acceptance-passed` / `22a8291`.
Robot-side consumption of these boundaries is **not verified** in this task.
No physical movement or additional controller/bridge was started.

After decoding the existing observation response on Laptop #2, retain its
`layout` field in `get_moontology_observation`. Reject missing layout, missing
`robotState`, non-null `physicalHold`, or a blocked movement request. Plan against
the region polygons and current obstacle footprints before requesting movement.
Any scene/world/layout revision change, expired observation, reset, or disconnect
must invalidate pending map actions and use the integration's existing mission
pause/STOP path. Unknown regions and unregistered splat features are not known
traversable objects. Do not fall back to an old registry or auto-elect another tab.

The browser also latches a physical hold on telemetry/boundary mismatch,
telemetry loss, missing map boundaries, and world transition. It uses the existing
STOP method and records the rejected telemetry pose separately from the accepted
map pose. That guard does not establish that dimOS consumed the geometry. The
physical controller, calibration, and real-world safety limits remain unchanged.

## Verification

`npm run build`, `npm run lint`, and `node --test --test-concurrency=1 tests/*.test.mjs`.
Tests use the actual World Labs collider and original equipment geometry to
check floor measurements, full equipment footprints, all scenic route legs,
wall/unknown-area rejection, doorway access, large-step tunneling, current world
transforms, and obstacle add/remove/edit behavior. The source assets are read only.

Development-only `?layoutTest` provides guarded virtual staging and a live layout
report for visual QA. `?airlockTest&airlockOnly` exercises the same transition
with only the map, entrance anchor, and Go2 loaded. These tools never send
movement commands and reject staging while the live bridge is connected.

Recorded in this task: all five humanoids and all five equipment assets showed
GROUNDED with no placement conflicts in the live scene. The virtual doorway walk
reached Scene 2 through the entrance corridor, landing near Y=-0.01 in the foyer.
24 targeted tests passed, including animated foot contact and entry API gating.

# Moontology Level 1

A focused Three.js scene-blocking tool for a World Labs lunar robotics
hackathon environment. It provides layered world loading, GLB/GLTF/FBX asset
loading, embedded animation playback, and development-only transform placement.

## Run

Install Git LFS before cloning. After pulling this branch, fetch the full-detail
models and maps before starting the app:

```bash
git lfs install
git lfs pull
npm install
npm run dev
```

Open the local URL printed by Vite. Quality checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Humanoid rehearsal

Five humanoids load from full-detail GLB derivatives, with identical worker
geometry shared across clips. Verified FBX duplicates are preserved in
`public/models/humanoids/full-fidelity/`; original FBXs remain untouched. Expand **Scene rehearsal**, check 5/5 animated
humanoids, then **Arm / Resume** and approach an actor with Go2. Each clip
plays once per run. Use **Pause cues** or **Reset run** to direct playback.
See [machine ownership and rehearsal procedure](docs/scene-rehearsal.md).

## Operational intelligence overlay

Level 1 now opens with the production-visible ontology overlay expanded. It
uses the same X/Z world coordinates as the Three.js assets and synchronizes
loaded humanoid, excavator, and Go2 transforms back into one central
`OntologyStore`.

The current map contains H01, H02, H03, H04 and H06; the kicking H05 actor has
been removed. Use Scene rehearsal to arm one-shot humanoid cues, then approach
the habitat entrance with virtual Go2 to open the facade shutter and enter
World Labs Scene 2. Physical observations must come from actual robot evidence.

The future dimOS integration boundary is exposed as `window.moontology`.
It provides `recordObservation`, `updateReportedState`, `updateTaskProgress`,
`setAssetHealth`, `createDiscrepancy`, `requestVerification`,
`confirmVerification`, and `executeOntologyAction`, plus snapshot
subscriptions.

Legacy placement, humanoid, and Go2 debug panels are hidden during the demo.
Append `?debugPanels` to the local URL to restore them in development.

## Asset locations

- Humanoids: `public/models/humanoids/`
- Rovers: `public/models/rovers/`
- Cargo: `public/models/cargo/`
- Equipment: `public/models/equipment/`
- Future Unitree Go2: `public/models/go2/`
- World Labs visual:
  `public/worldlabs/lunar-base/Moon Base with Habitats.spz`
- World Labs collider:
  `public/worldlabs/lunar-base/Moon Base with Habitats_collider.glb`

Level 1 currently uses these discovered local staging assets:

- `public/models/humanoids/Defeat.fbx`
- `public/models/humanoids/scene1/Dig And Plant Seeds.fbx`
- `public/models/humanoids/Kneeling Inspecting.fbx`
- `public/models/humanoids/Writing.fbx`
- `public/models/humanoids/h01-kicking.fbx`
- `public/models/humanoids/h01-sweat.fbx`
- `public/models/rovers/lunar excavator.glb`
- `public/models/static/cable.glb`
- `public/models/static/cyber-rover.glb`
- `public/models/static/door.png`
- `public/models/static/excavator traditional.glb`
- `public/models/static/rover.glb`

The exact static transforms, scene tags, worker/task associations, logical work
groups, cable endpoints, and airlock motion values are centralized in
`src/levels/scene1StaticAssets.ts`. The source folder contains no 3D door
model, so the supplied `door.png` is mounted on a shallow Three.js panel. Asset
provenance and hashes are recorded in
`public/models/static/SOURCE_ASSETS.md`.

After adding a model, set its exact public URL in `src/levels/level1.ts`.
URL-encode spaces while preserving the filename. For example:

```ts
src: '/models/humanoids/Dig%20And%20Plant%20Seeds.fbx'
```

GLB/GLTF is preferred. FBX and static door images are also supported. Missing
or invalid model sources produce warnings without stopping the rest of the
level.

## World modes

Marble mode is the default now that the World Labs export is present. It loads
the SPZ through Spark with LoD enabled and loads the collider GLB invisibly
through `GLTFLoader`.

To explicitly use the neutral placeholder world:

```bash
VITE_WORLD_MODE=placeholder npm run dev
```

If the SPZ is unavailable or fails to load, the app returns to placeholder
mode. If only the collider is missing, Marble remains visible and the collider
toggle is unavailable.

The visual splat and collider remain separate children of one `world-root`.
Adjust only `WORLD_LABS_TRANSFORM` in `src/levels/level1.ts` to change world
position, Y rotation, or uniform scale. Interactive assets are never flipped
to compensate for world orientation. The existing staging floor is kept under
the separate `critical-gameplay-colliders` group; generated collider geometry
is never treated as authoritative for Go2.

## Place assets

Placement controls are available while running the development server:

1. Choose **MAP EDIT** in the control switcher.
2. Click any visible child mesh to select its root level asset.
3. Press **W** to move, **E** to rotate, or **R** to scale.
4. Drag a TransformControls handle. Orbit camera input is disabled during the
   drag and restored afterward.
5. Choose **COPY TRANSFORM** to copy a rounded config snippet. The same snippet
   is always displayed and printed to the console if clipboard access fails.
6. Choose **PRINT ALL TRANSFORMS** to display and print every loaded asset
   transform in Level 1 config order.
7. Choose **DESELECT**, or click empty space, to clear the selection.

`SHOW WORLD LABS COLLIDER` reveals the generated collider as a translucent
wireframe for inspection only.

Static machinery is parented beneath `StaticAssetRoot`, never
`HumanoidFleetRoot`. The lunar/standard excavators, cable rover, rover variants,
airlock, cable destination, and leak-origin marker all use the same
TransformControls and copy-transform flow. The leak marker is selectable while
visible and stores an airlock-local transform.

The development-only **STATIC SYSTEMS** panel appears with `?debugPanels`.
It can switch the cable between `NOT_STARTED`, `PARTIAL`, and `CONNECTED`;
set the airlock to `CLOSED` or `OPEN`; run purge/emergency cycles; override the
warning light; toggle leak particles; and show the leak-origin marker.

Future Go2/dimOS code can use `window.moontologyScene`:

```ts
window.moontologyScene.dispatchGameEvent('GO2_HANDSHAKE_COMPLETE');
window.moontologyScene.dispatchGameEvent('GO2_POUNCE_COMPLETE');
window.moontologyScene.setAirlockLeakActive(true);
window.moontologyScene.setCableTaskState('PARTIAL');
```

Subscribe to `window.moontologyScene.events` for
`AIRLOCK_PURGE_COMPLETE`, `AIRLOCK_PRESSURE_STABLE`,
`AIRLOCK_STATE_CHANGED`, and `AIRLOCK_LEAK_CHANGED`.

For animated files, the loader discovers embedded clips, creates one
`AnimationMixer` per animated asset, and updates all mixers from the central
render loop. Set `animation` in an asset config to request a named clip;
otherwise the first embedded clip plays. Missing names warn and fall back to
the first clip. Static files do not receive mixers.

## Runtime controls and performance

- **ROBOT**: Arrow keys or W/S/A/D drive Go2; camera and map editing are off.
- **CAMERA**: OrbitControls are active; robot input and map editing are off.
- **MAP EDIT**: placement selection and TransformControls are active.
- **RECENTER**: moves only the camera behind Go2.
- **P**: toggles DEV (30 FPS cap, 1× pixels) and DEMO (45 FPS cap, maximum
  1.25× pixels).

Rendering pauses while the page is hidden. Level 1 owns one governed render
loop and one WebGL renderer. Real-time renderer shadows are disabled by
default. Performance and physical-size values live in
`src/config/moontologyConfig.ts`.

Every Level 1 humanoid placement root is parented beneath
`HumanoidFleetRoot`. Each FBX is measured before animation playback and placed
under its own normalization child so its native rig remains untouched while
the measured standing bounds normalize to a common 1.75 m height.
`HUMANOID_FLEET_SCALE` near the top of `src/levels/level1.ts` scales the shared
fleet parent only, preserving actor-relative transforms and keeping global
fleet scale separate from per-file normalization. Go2 and the World Labs root
are outside this hierarchy.

## Isolated Unitree Go2 URDF test

Run the normal development server and open:

```text
http://127.0.0.1:5173/go2-test.html
```

This separate page loads Unitree's official `go2_description` package from
`public/models/go2/go2_description/`. It preserves the URDF links and joints,
maps `package://go2_description/` to the local package root, and loads the
official DAE visual meshes. It does not add physics, locomotion, navigation,
telemetry, or Go2 integration to Level 1.

The temporary panel exposes the independent visual root transform and the 12
loaded hip/thigh/calf joints. Use it only to inspect pivots, axes, hierarchy,
mesh attachment, and visual scale. The existing animated digging humanoid is
loaded beside the Go2 as a scale reference without changing the humanoid
system.

## Go2Agent in Level 1

Level 1 creates one `Go2Agent` at the transform configured in
`src/levels/level1.ts`. The initial position is on the stable staging collision
floor near the origin.

The object keeps three responsibilities separate:

```text
Go2Agent
├── AgentRoot          authoritative position/yaw + hidden box proxy
└── VisualRig          follows AgentRoot
    └── VisualGaitBodyMotion
        └── official articulated Go2 URDF
```

Use the arrow keys or W/S/A/D while **ROBOT** mode is active:

- Up/down: move AgentRoot forward/backward
- Left/right: rotate AgentRoot left/right

`ManualGo2Controller` implements the small `Go2Controller` interface. A future
navigation or DimOS adapter can replace that controller without changing the
scene or the `Go2Agent` visual hierarchy. `Go2GaitAnimator` derives signed
forward and yaw velocity from AgentRoot transform deltas, then applies a
visual-only diagonal trot as additive, limit-clamped offsets around the 12
joint rest values. Stopping blends back to the standing pose.

Joint animation currently uses `PROCEDURAL_GAIT` mode. Switching to the
explicit future `TELEMETRY` mode clears procedural offsets before real motor
angles are applied, so the two sources cannot be mixed. No physics, IK, or
browser-to-raw-motor path is present.

## Physical Go2 bridge (opt-in)

`robot-bridge/` is a separate Python package that composes with the official
dimOS Go2 blueprint. It publishes normalized odometry through a LAN WebSocket
and accepts fail-closed, bounded high-level commands. Commands default off,
STOP has priority, and local navigation goals remain disabled until the
physical planner is validated.

The Three.js client is inactive unless an ignored `.env.local` provides:

```text
VITE_ROBOT_TELEMETRY_WS=ws://<LAPTOP_2_IP>:8765/ws
VITE_GO2_BRIDGE_TOKEN=<LOCAL_TOKEN>
```

When enabled, the first physical odometry sample aligns to the current
`AgentRoot`; later physical X/Y/yaw deltas map to Three.js X/Z/yaw. The
existing visual foot-floor offset and URDF hierarchy are unchanged. Manual
keyboard movement is locked while physical telemetry owns the root.
`VITE_GO2_BRIDGE_URL` remains accepted as a legacy endpoint name.

The development console API is:

```text
window.moontologyGo2.getState()
window.moontologyGo2.resetAlignment()
window.moontologyGo2.applyMockNudge({ forward: 1 })
window.moontologyGo2.applyMockNudge({ lateral: 0.5 })
window.moontologyGo2.stop()
window.moontologyGo2.sendVelocity({
  forward: 0.05,
  lateral: 0,
  yaw: 0,
  durationMs: 250
})
```

Do not enable physical commands or launch the official Go2 blueprint until
the operator confirms `GARAGE READY`. See `robot-bridge/README.md`.

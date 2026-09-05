# Moontology Level 1

A focused Three.js scene-blocking tool for a World Labs lunar robotics
hackathon environment. It provides layered world loading, GLB/GLTF/FBX asset
loading, embedded animation playback, and development-only transform placement.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Quality checks:

```bash
npm run lint
npm run typecheck
npm run build
```

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

- `public/models/humanoids/Dig And Plant Seeds.fbx`
- `public/models/rovers/lunar excavator.glb`

The remaining asset slots are intentionally unconfigured while this two-model
test is active.

After adding a model, set its exact public URL in `src/levels/level1.ts`.
URL-encode spaces while preserving the filename. For example:

```ts
src: '/models/humanoids/Dig%20And%20Plant%20Seeds.fbx'
```

GLB/GLTF is preferred. FBX is also supported for incoming assets. Missing or
invalid model sources produce warnings without stopping the rest of the level.

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

1. Click any visible child mesh to select its root level asset.
2. Press **W** to move, **E** to rotate, or **R** to scale.
3. Drag a TransformControls handle. Orbit camera input is disabled during the
   drag and restored afterward.
4. Choose **COPY TRANSFORM** to copy a rounded config snippet. The same snippet
   is always displayed and printed to the console if clipboard access fails.
5. Choose **PRINT ALL TRANSFORMS** to display and print every loaded asset
   transform in Level 1 config order.
6. Choose **DESELECT**, or click empty space, to clear the selection.

`SHOW WORLD LABS COLLIDER` reveals the generated collider as a translucent
wireframe for inspection only.

For animated files, the loader discovers embedded clips, creates one
`AnimationMixer` per animated asset, and updates all mixers from the central
render loop. Set `animation` in an asset config to request a named clip;
otherwise the first embedded clip plays. Missing names warn and fall back to
the first clip. Static files do not receive mixers.

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
`src/levels/level1.ts`. The current placeholder world has no generated walkway,
so the initial position is on the staging floor near the origin.

The object keeps three responsibilities separate:

```text
Go2Agent
├── AgentRoot          authoritative position/yaw + hidden box proxy
└── VisualRig          follows AgentRoot
    └── VisualGaitBodyMotion
        └── official articulated Go2 URDF
```

Use the arrow keys in Level 1:

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
angles are applied, so the two sources cannot be mixed. No DimOS, physics,
path planning, IK, or physical-robot connection is present.

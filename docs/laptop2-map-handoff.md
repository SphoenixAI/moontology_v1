> Superseded by the Air-only demo. Current launch and connection contract: [air-demo.md](air-demo.md). The relay now binds loopback; no cross-laptop execution is configured.

# Laptop #2 map connection

Base: `http://10.0.0.164:5173/api/map`. This is middleware in the existing Vite
process, not a second map/server. `GET /observation` is an RPC to the pinned
localhost browser: it samples the actual registry and AgentRoot when requested.
`GET /health` is diagnostic cached publisher state, not a navigation observation.
No endpoint sends a physical command or connects to a robot.

## Observation and command envelope

`GET /observation` returns `{ok:true, read_token:string, observation:Observation}`.
The exact Observation JSON Schema is served at
`http://10.0.0.164:5173/map-observation.schema.json`.
All POSTs use `Content-Type: application/json` and include
`{command_id:"unique-UUID-per-logical-operation",read_token:"from-last-response",...}`.
A read token expires after 2000 ms; mutations reject old scene/session revisions.
Every completed browser response includes its new observation and a new read token;
use that token for the next operation, or GET a fresh observation.
Every request is rechecked in the browser before executing; queued RPCs expire
in 1000 ms, HTTP times out at 1400 ms. Keep the presentation foreground and poll
at 5–10 Hz. Serialize writes. Never interpret a timeout as success: GET again,
then retry the same command_id and identical payload (new read_token allowed).
The last 256 commands are deduplicated for the current browser instance. After
a new session, discard old pending commands rather than replaying them.

Errors from the browser are
`{ok:false,error:string,requires_observation:true,observation:Observation,read_token:string}`.
Relay errors may have only `{error,requires_observation}` (no live snapshot).
Use HTTP status: 400 malformed; 403 access/origin rejected; 409 stale context or
semantic rejection; 429 busy; 503 no live authoritative publisher; 504 scene timeout.
No CORS is enabled. Use a native HTTP client on the trusted private LAN. The publisher
is loopback-only and pinned to one browser ID for the server lifetime. Opening the
LAN page on Laptop #2 creates a viewer, not another publisher. Do not elect a
replacement browser automatically. Server restart clears the in-memory authority
pin; keep only the intended localhost map tab open during restart.

## Endpoints (bodies below also need the common envelope)

- `POST /mission {op:"start",target_id:"rover-1",mode:"rehearsal"|"telemetry"}`:
  creates a server-visible browser run UUID, phase RUNNING, map_armed false.
  Reset the previous run before another start. Start never resets entity state.
- `POST /mission {op:"target",target_id:"rover-1"}`: select the map-owned mission target.
- `POST /mission {op:"arm"}`: arms only semantic interactions. Requires ready map,
  an active run, and fresh HTTP telemetry in telemetry mode. Does not arm hardware.
- `POST /mission {op:"phase",phase:"APPROACHING"|"INSPECTING"|"ACTIVATING"|"VERIFYING"}`:
  records consumer phase; cannot assert verified completion.
- `POST /mission {op:"hold"}`: disarms semantic mission and holds virtual pose.
- `POST /interaction {entity_id:"rover-1",action:"inspect"|"activate"|"verify"}`:
  checks current range, target, arming, scene context, and semantic state atomically.
- `POST /reset {scope:"mission"}`: offline, IDLE, no run/target, disarmed; keeps
  assets/world/camera/robot position. Disconnect HTTP telemetry first. Releases
  virtual ownership to the existing manual controller for rehearsal.
- `POST /reset {scope:"session"}`: same semantic reset, also creates new scene UUID.
  Neither reset reloads or replaces the World Labs scene.
- `POST /telemetry {connected:true,frame:"three_world",position:{x,y,z},yaw,
  sample_sequence:integer,timestamp_ms:UnixMilliseconds}`: update virtual Go2 only.
- `POST /telemetry {connected:false}`: mark stream disconnected, disarm, hold pose.

## Mission and coordinates

API `rover-1` is explicitly an alias of the **current EXC-01 lunar excavator**,
not the separate ROVER-01 support rover or EXC-02 traditional excavator. Its world
position comes from `registry.get('EXC-01').root.getWorldPosition()` each sample.
Only registry objects with real ontology entries appear; no baked splat features
are invented as semantic entities. Current measured boundaries are passed through
as `observation.layout`, including current obstacle polygons and robotState.

Progression: offline → inspect → inspected → activate → ready → verify → VERIFIED.
Radius is 3.0 planar meters from the excavator Object3D origin. At greater distance,
actions are `["approach"]`; within range they are `["inspect"]`, `["activate"]`,
`["verify"]` in state order, then `[]`. `approach` is a planning affordance, never
a map-side locomotion command. Out-of-range returns HTTP 409 `approach_required`
with current state/actions and preserves the mission phase/run. VERIFIED means
map-semantic completion only; dimOS must own independent physical verification.

Positions use Three.js world coordinates (+Y up). Robot yaw 0 faces +X; positive
yaw turns toward -Z. Bearing is relative to that robot forward direction in radians.
Distance is planar XZ distance / meters_to_world_units (currently 1).
`visible` means Object3D and ancestors enabled; it is not a camera detection.
`line_of_sight` is null (unknown). Do not treat it as true. `interactable` expresses
range/state availability; run arming and physical permission are separate checks.

## Telemetry and session holds

Laptop #2 maps odometry to the current Three.js world before posting. The map does
not silently align the first sample or convert physical XY. Preserve your calibrated
transform; compare returned pose to the requested pose (map floor Y may be corrected).
Existing measured layout performs the same swept boundary check. Rejected poses do
not move the root and return a structured error with HELD state. The existing outbound
bridge, if connected, retains ownership; this endpoint rejects conflicting ownership.
Only feed real odometry when physically running. The API also supports clearly
identified synthetic rehearsal tests without issuing physical motion.

Samples must have strictly increasing sample_sequence, finite position/yaw and a
Unix millisecond timestamp no older than 2000 ms and no more than 500 ms in the future.
Synchronize laptop clocks. A new/reset run allows sequence numbering from zero.
Send at 5–10 Hz with the newest returned read_token. No velocity commands are accepted.
The map applies sample positions directly, with no velocity extrapolation.

At 2000 ms without accepted telemetry, explicit disconnect, map hold, scene heartbeat
loss (>1500 ms), relay loss, world change or reset: disarm, increment revision, invalidate
queued stale-context operations and hold the last virtual pose. Reload/world/session
reset changes scene_session_id; ordinary mission/entity/layout changes increment
scene_revision. Observation sequence increases for each browser sample. Last telemetry
pose persists across reload in that browser's sessionStorage, restoring held/disarmed.

After interruption, dimOS must stop/hold locally using its existing safety behavior,
GET the observation, discard old pending actions, revalidate the active world/pose,
send fresh telemetry using the new context, then explicitly arm the semantic mission.
Re-reading alone never arms or resumes hardware. Local physical thresholds remain
entirely on Laptop #2. Scene reload invalidates the run; start a new run after revalidation.

## Verification status

Build, lint, all 29 repository tests, and validation of a live observation against
`public/map-observation.schema.json` passed. The existing Vite PID was retained
while changing its listener from loopback to `0.0.0.0:5173`. HTTP through `en0` at
`10.0.0.164:5173` succeeded from the map laptop. This does not by itself prove
Laptop #2 can reach it: the second laptop's SSH port refused connection, so an
actual consumer-side HTTP result is still required. Run on Laptop #2:

```sh
curl --max-time 5 http://10.0.0.164:5173/api/map/observation
```

The full presentation at `http://127.0.0.1:5173/` then passed the reversible live
probe: IDLE → RUNNING appeared in the next observation, an out-of-range inspect
returned `approach_required` while retaining RUNNING, and mission reset restored
IDLE/offline. Robot X/Y/Z/yaw were identical before and after. All five sampled
observations matched the published schema. The evidence and final live snapshot
are in `docs/map-live-verification.json`. This publisher was the existing in-app
Chromium presentation, browser ID `fbaae60b-b983-40af-b58e-7f32f39e432b`, not a
newly created map tab. No physical motor command was sent.

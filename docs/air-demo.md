# Air demo runbook

## Current hardware hold — do not run physical instructions

Go2 reported repeated start/exit avoidance announcements after safety-service setup. The Air bridge is stopped, automatic avoidance setup/polling has been removed, and `runtime.local/hardware-hold.json` blocks live reconnection. The robot-side service change has not been restored or verified reset. See [session record](demo-session-record.md). Do not arm or connect hardware until operator recovery is complete. The original map/UI remains preserved.

Use `/Users/sphoenix/moontology/scripts/air-demo` for every command below. The current map stays at `http://127.0.0.1:5173/`; the local mission process is `127.0.0.1:8766`. The launcher reuses the existing Vite process and the pinned visible browser scene in the current task. Keep that presentation tab open, awake, and visible. The map uses Vite's existing WebSocket for immediate scene commands; the controller-facing HTTP URLs stay unchanged.

## Verified current state and physical blocker

Full rendered excavator replay passed 3/3 times (about 24 seconds each, 44 approach decisions then inspect, activate, verify); no hardware transport in replay. See `air-replay-verification.json`.

Go2 was provisioned over Bluetooth to the operator's private router. Current discovery: Air `192.168.8.160`, Go2 `192.168.8.115`, serial `B42D2000P3DBFGC2`. Addresses require fresh discovery after network/reboot changes. Four pings averaged 4.469 ms with no loss. A stationary live connection returned real camera frames and measured odometry; round-trip map telemetry passed with source `physical_odometry`, map-side telemetry ages 8–72 ms across three captured samples, rendering active, armed false and zero locomotion actions. These are stationary samples, not physical walking or camera-to-display latency measurements.

**Physical mission blocked:** more than 1,200 compressed voxel packets carried the identical source stamp `1788580000.0`, with no independent sequence/freshness field. The adapter deliberately does not apply dimOS's receipt-time timestamp repair to satisfy a physical safety gate. Onboard obstacle avoidance reports false. No stationary object-in/out veto validation or physical mission has passed. Enabling onboard avoidance alone does not fix the frozen LiDAR clock or establish that Sport Move is protected by onboard avoidance. Keep locomotion unarmed until the actual physical sensing/control path is validated. No firmware or dependency upgrade has been performed.

Camera JPEG: `http://127.0.0.1:8766/camera.jpg` (503 when stale). Status: `./scripts/air-demo status`, including physical sensor ages, raw metadata, frame IDs and gate reasons. The camera is an operator diagnostic; the fixed executor uses the scene's registered ontology, not a vision-language model. `digging-bot` is visible in observations but the current executable mission targets only `rover-1`.

## Why the Go2 stopped responding on 4 September (22:32–22:41)

The robot was not ignoring the bridge; it was refusing motion because of its own hardware fault. The Air log recorded the robot's active error list at connection time: `Error Source 309, Error Code 309-4`. In the Unitree app error tables shipped with `unitree-webrtc-connect` 2.2.0, source `3xx` is *Motor malfunction* with the motor index in the last two digits and code `4` is *Driver overheating*: **motor 9 (rear-left hip) driver over-temperature**. The IMU also reported 79 °C. While such a fault is active the Go2 acknowledges Sport API requests (reply code 0) and then does not execute them, which is exactly what the authorized `StandUp` attempt showed: code 0, no height change, `body_height` 0.0957 m, `error_code` 100, `mode` 0. The robot recovered once it cooled; at 22:42 it was standing (`z` 0.31 m) with LiDAR, camera and avoidance all fresh.

The bridge now tracks the robot's `errors` / `add_error` / `rm_error` frames. `./scripts/air-demo status` reports `robot_errors`, `controller_mode` and `body_height_m`; `stand` and `arm` refuse while a motor (`3xx`), communication (`1xx`) or motion-control (`6xx`) fault is active, and `controller_ready` drops to false, which stops an armed run. Fan (`2xx`) and LiDAR (`4xx`) codes are reported but do not gate by themselves. If `status` shows a `3xx-4` fault again: STOP, let the robot rest lying down with power on for 10–15 minutes (or power off), and reconnect only after the fault clears from `robot_errors.active`.

The remaining recurring blocker is `delayed_source_odometry` (relative source delay above 500 ms; peaks of 522–1050 ms were measured). Both Air and Go2 are on Wi-Fi through the private router and two browser renderers were at 300 % CPU during the failed run. Before another autonomous attempt: put the Air Mac on Ethernet to that router, close the extra renderers, then `reset` and `calibrate` to clear the latched fault.

## Reasoning with dimOS (agent layer)

`./scripts/air-demo agent` starts a dimOS coordinator with three modules from `robot-bridge/src/moontology_bridge/agentic.py`:

- `MoontologySkills` exposes `observe_scene`, `robot_status`, `look`, `mission_report`, `run_excavator_mission` and `navigate_toward(target_id, max_steps)` (both hold the dimOS `movement` capability) and `stop_robot`. Every skill reads or acts through the existing loopback bridge (`127.0.0.1:8766`) and map (`127.0.0.1:5173/api/map`). There is no skill for connect, calibrate, arm, stand or raw motion; those remain operator CLI commands, so the agent's reasoning never bypasses a safety gate.
- dimOS `McpServer` publishes those skills as MCP tools at `http://127.0.0.1:9990/mcp`.
- dimOS `McpClient` (LangGraph) is the in-process reasoning loop with a Moontology system prompt. It is optional.

Choose the reasoning engine:

```
# 1. Cursor / Claude Code is the reasoner (no API key). .cursor/mcp.json already points at the server.
./scripts/air-demo agent --no-llm

# 2. OpenAI through dimOS McpClient (default model gpt-4o; export the key in this shell only)
export OPENAI_API_KEY=...            # never commit or paste into files
./scripts/air-demo agent

# 3. Local model through Ollama (install from https://ollama.com, then `ollama pull qwen3:8b`)
./scripts/air-demo agent --model ollama:qwen3:8b

# Optional voice/web prompt box at http://localhost:5555
./scripts/air-demo agent --web-input
```

Talk to the in-process agent with `dimos agent-send "What is in front of Go2 right now?"` (run inside `~/moontology-robot/.venv`), with `humancli`, or through the web input. Inspect tools with `dimos mcp list-tools` and `dimos mcp call robot_status`. dimOS modules communicate over LCM multicast; on macOS the coordinator asks for `sudo` once per boot to add `route -n add -net 224.0.0.0/4 -interface lo0` (the launcher prints whether that route is present).

Agent contract: it must call `observe_scene` and `robot_status` before deciding, report `what_blocks_physical_motion` verbatim when a gate is open and name the operator command that clears it, distinguish map semantics from measured telemetry, and call `stop_robot` on any doubt. `run_excavator_mission` refuses locally while any gate is open, so an LLM cannot start hardware motion unless the operator has already connected, calibrated and armed the bridge. Tests: `robot-bridge/tests/test_agentic.py` and `test_robot_errors.py`.

## Software rehearsal (Go2 off)

```
./scripts/air-demo start --replay
./scripts/air-demo replay --runs 3
./scripts/air-demo reset
```

Replay runs the complete dimOS excavator skill through an independently sampled development plant. It has no live transport object and rejects `/connect`. Every pose is marked `replay`. Its simulated measured displacement is 96% of requested movement, so the executor must observe actual return telemetry repeatedly. This is software evidence, not physical performance evidence.

## One integrated physical session

1. Power on and boot Go2. Have the operator establish a stable standing posture with the normal robot controls. This bridge never sends stand-up, balance, controller-mode changes, or joint commands.
2. Confirm Laptop #2's controller is stopped and disconnect any competing Unitree application/controller. The bridge also takes an exclusive Air process lock. Remote ownership requires operator confirmation; it cannot be proved while Go2 is off.
3. Connect Air and Go2 to the same private Wi-Fi. Air interface is `en0`; inspect its current address with `/usr/sbin/ipconfig getifaddr en0`. If provisioning is needed, run `./scripts/air-demo wifi --ssid '<SSID>' --name '<BLE_NAME>'` in a local terminal; enter the password only at the hidden prompt. Run `./scripts/air-demo discover`. Use the newly discovered Go2 address; `10.0.0.71` is historical only.
4. Run `./scripts/air-demo start --live`, then `./scripts/air-demo connect --robot-ip <DISCOVERED_IP> --sole-controller-confirmed`. Starting live mode alone does not connect or move hardware. Connection only subscribes and checks the existing controller mode. If firmware requires a device AES key, provide `UNITREE_AES_128_KEY` in the launch environment; never put it in source.
5. Run `./scripts/air-demo reset`, then `./scripts/air-demo calibrate --scale 40`. Keep Go2 still during calibration. This captures a fresh raw physical origin and aligns its forward heading to the current demo spawn heading. Optionally specify `--virtual-heading <RADIANS>` to choose the virtual forward direction. Raw odometry is never scaled or overwritten; only relative planar displacement is scaled at the map boundary. Reset clears alignment and requires calibration again.
6. Resolve every physical sensor blocker before arming. While disarmed, validate the veto with a stationary test object in the front corridor using `./scripts/air-demo sensor-check --stage obstructed`; remove the object and run `./scripts/air-demo sensor-check --stage clear` within 120 seconds. These commands require fresh source LiDAR/odometry in matching frames, current camera, and confirmed enabled onboard avoidance. They issue no movement. Then confirm a clear real lane and standing robot and run `./scripts/air-demo arm --clear-lane --robot-standing`. Arming additionally requires fresh controller mode/height telemetry and successful measured-pose round trip through the current scene. Do not use the arm/mission steps while the current blocker above remains.
7. Present the full mission with `./scripts/air-demo mission "Go inspect the lunar excavator and ready it for operations."` It selects current `rover-1`, approaches with bounded measured steps, then performs inspect → activate → verify. Inspecting/activating/verifying are scene semantics; no garage object contact is required.
8. STOP with `./scripts/air-demo stop`. Finish with `./scripts/air-demo shutdown`. Keep the robot's normal remote STOP available throughout.

## Movement and safety contract

Forward ≤0.25 m/s, lateral zero, yaw ≤0.50 rad/s, each movement lease ≤0.80 s, translation and rotation separate. Maximum measured path 0.60 m, radius from armed origin 0.45 m, cumulative yaw 4.0 rad, 120 actions, 90 seconds from arming. At scale 40 a maximum forward pulse requests at most 0.20 physical m / 8 virtual m; the Go2 controller holds stance below roughly 0.1 m/s and ramps its trot over a few hundred milliseconds, so smaller/shorter leases (the earlier 0.04 m/s × 0.35 s) produce no walk at all (see [demo-session-record.md](demo-session-record.md)). Actual odometry controls progress; the odometry-jump veto scales with the time between samples (`BoundedCapability.jump_limits`). Odometry/LiDAR/camera freshness gates tolerate 1.5 s of Wi-Fi jitter because the 50 Hz deadman lease bounds motion independently.

Mission steering: forward pulses are issued when the waypoint bearing is within ±0.30 rad, otherwise yaw pulses; every pulse is at least 0.30 s (shorter Sport `Move` leases never leave stance). `calibrate --face-waypoint` maps the robot's current physical heading onto the map's approach bearing so the mission starts with a straight walk rather than an in-place turn (turn drift is a few cm, i.e. one or two scene units at scale 40). The map planner (`src/relay/approach.ts`) picks an approach goal whose lane keeps 1.2 scene units of clearance from other footprints; the excavator becomes inspectable within `EXCAVATOR_INTERACTION_RADIUS` (6 scene m).

Navigation toward any map target: `air-demo navigate <target_id> --max-steps N` (HTTP `POST /navigate`, dimOS skill `navigate_toward`) takes at most N (1..12) bounded steps toward a registered asset (`H04`, `digging-bot`, `rover-1`, `Airlock-2A`, …) or a layout region (`Building-West`, `Doorway-2A`, …) and stops; it requires an armed bridge and disarms when it ends. The map relay resolves the id (`mission op=target` / `op=approach` accept `target_id`; unknown ids are rejected with `unknown_target`), plans a standoff on the smallest radius that has a straight clear lane (regions are aimed at their centroid; the grid search runs once, last, because it executes on the render thread and >750 ms trips the freshness gate), and the bridge steers with the same yaw/forward pulses as the mission. The report (`runtime.local/runs/navigate-*.json`) records the target's map distance and bearing before and after, the bearing improvement, measured travel, and the LiDAR room summary at every step. Interactions (`inspect/activate/verify`) remain excavator-only.

Step semantics (replay-rehearsed overnight before the hackathon, see [demo-session-record.md](demo-session-record.md)): `max_steps` bounds *forward* pulses; in-place turn pulses (~0.35 rad each at 0.5 rad/s × 0.8 s) have their own per-leg budget sized from the arm's 4.0 rad `MAX_YAW_TRAVEL` (`turn_limit`). The map's `approach` response labels its waypoint `kind`: `here` (already inside the standoff ring), `goal` (a point on the ring) or `path_node` (a corner of a grid-searched detour). Arrival kinds: `planner_inside_ring`, `waypoint_within_step_fraction` (a *goal* closer than 40% of one physical step — a full step would carry the robot further away), `residual_below_step_blocked` (goal within one step, no footprint-free step ends closer), `world_transition_triggered` (transition legs only). A `path_node` is never arrival: progress toward it is measured toward the node, and standing beside one with no onward step raises `step_blocked_by_footprint_at_path_node`. Before every pulse the bridge predicts the step against the map's own pose rule (0.4-unit footprint radius, swept footprints, region precedence doorway > building > terrain) and requires the whole ±0.30 rad heading band of a candidate to be clear, so the map never has to reject a pose mid-run. A pulse that would exceed what remains of the arm's envelope (0.60 m travel, 0.45 m radius, 4.0 rad yaw, 90 s) ends the leg as `arm_envelope_budget` — success, not arrived, resumable after a fresh arm — instead of tripping the watchdog's `physical_envelope`.

Scene traverse: `air-demo traverse [--scene SCENE_1] [--leg N] [--max-steps 12] [--wait]` (HTTP `POST /traverse`, dimOS skill `traverse_leg`) runs the next unfinished pre-planned atlas leg (H-01 `digging-bot` → `rover-1` → H-02 → `Doorway-2A`) under the current arm: it re-observes a mobile target first (`pre_check`: displacement from the atlas position, `restaged`), navigates, turns to face the target on arrival (`face`), closes into the interaction ring and runs the excavator interactions when the leg has them (`close_in`, `interactions`), and persists progress in `runtime.local/traverse-progress.json` (`traverse --reset-progress` starts the scene over; `--all` is replay-only and re-arms in software). Reports: `runtime.local/runs/traverse-<scene>-leg<N>-*.json`. `air-demo atlas [--brief]` prints the boot-time atlas (entities with mobility class and sequence label, legs with planned standoffs and turn budgets, pitfalls); `air-demo drift` compares the live scene with it; `air-demo preflight [--robot-ip IP] [--json]` is the boot self-check (Python/dimOS versions, map health and render freshness, atlas freshness vs the map's served atlas and vs the bridge's loaded copy, bridge/hold/lock state, LCM multicast route, LAN IP, robot reachability, agent LLM backend). See [scene-atlas.md](scene-atlas.md) for the generated map and [hackathon-runbook.md](hackathon-runbook.md) for the morning sequence.

Room awareness: `physical_sensors.obstacles` now carries `sectors_m` (nearest LiDAR return per 45° sector in the robot frame, within 2 m), `nearest_turn_m` and `nearest_turn_bearing_rad` next to the `forward_blocked`/`turn_blocked` vetoes, so the reasoning layer can say where the real room is tight. The in-place turn veto radius is `TURN_HALO` 0.60 m (the body corners sweep ≈0.40 m); the forward corridor is 0.65 m × ±0.38 m.

Operator posture commands: `stand --clear-area` (one StandUp, posture-only connection) and `stand-down --clear-area` (StandDown, lets hot hip motors cool; refused while armed). `arm --skip-box-check` waives only the stationary box cycle; the live LiDAR obstacle veto, freshness, onboard-avoidance confirmation and robot hardware-fault gates still apply.

A 50 Hz watchdog stops on lease expiration, controller loss, odometry age >0.50 s, map feedback age >0.75 s, hidden/stale rendering >0.75 s, odometry jumps, or movement-envelope exhaustion. No progress aborts after 4 seconds. STOP clears pending movement before map I/O, invalidates queued movement callbacks, and sends zero Move plus priority StopMove using the installed Unitree transport. Network delivery and physical braking remain hardware-dependent; the remote/operator remains the backup.

Session/revision mismatch, map reload/world transition, changed boundaries, rejected map pose, stale return telemetry, or stopped source disarms/holds the mission. No automatic resume. The map holds its last pose and never extrapolates. STOP, reset, fresh calibration, observation and operator arm are required to run again. The existing map's geometry checks are virtual constraints; autonomous physical camera/LiDAR obstacle awareness is not established. This run is operator supervised.

## Preserved installation and local interface

Python `/Users/sphoenix/moontology-robot/.venv/bin/python` (3.12.14), dimOS 0.0.13.post1, Unitree WebRTC 2.2.0. The launch preflight checks the baseline. No dependency upgrade or installed-controller edit. The registered dimOS `execute_excavator_mission` skill owns deterministic mandatory ordering; an LLM is not required for this fixed presentation.

Local map calls: `GET /api/map/observation`, `POST /api/map/mission`, `/interaction`, `/telemetry`, `/reset`. Mutations use a fresh `read_token` and unique `command_id`; response contains a new observation/token. Schema: `/map-observation.schema.json`. The scene reads registered Object3D world transforms. `rover-1` maps to `EXC-01`; `digging-bot` maps to registered humanoid `H01`. Baked splat features remain unknown. Mission `mode: replay` accepts only `source: replay`; `mode: telemetry` accepts only `source: physical_odometry`. External browser origins cannot invoke the local physical controller.

`runtime.local/runs/mission-*.json` records initial/final observations and each decision's target observation, scene identity/sequence, raw measured pose, virtual pose, physical sensor status, action, distance and timestamp. `runtime.local/replay-results.json` summarizes repeated runs. Logs and calibration/session state are not checked into source. Reset returns excavator offline, mission IDLE and Go2 to the existing demo spawn, preserving assets, animations, World Labs content and presentation UI.

The physical-only voxel veto is an additional fail-closed gate. It requires advancing source stamps and matching odometry/point-cloud frames; LiDAR age above 0.50 s, camera age above 1.5 s or unconfirmed onboard avoidance prevents motion. It checks a forward corridor and rotation halo for observed points outside the body footprint. It does not prove free space, detect every low object or drop, or provide a physical path planner. A cleared real lane and operator STOP remain mandatory. The stationary check must be repeated after a stale-sensor failure.

Primary transport references: [dimOS Go2 setup](https://github.com/dimensionalOS/dimos/blob/main/docs/platforms/quadruped/go2/setup.md), [Unitree official Sport Move and StopMove](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/unitree_sdk2py/go2/sport/sport_client.py). The wrapper uses Sport Move API 1008 with SI forward/yaw bounds and StopMove API 1003; the installed joystick `move()` method does not supply that SI contract.

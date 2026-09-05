# Moontology Air demo session record — 4 September 2026

This document indexes the captured evidence for later benchmarking. No new benchmark analysis is being run now. All original captured files are preserved, including failures; raw streams from before recording existed cannot be reconstructed.

## Current verified facts

- Preserved map and UI: http://127.0.0.1:5173/ in the current task, same checkout and assets.
- Air 192.168.8.160; Go2 192.168.8.115 on the private router. Fresh discovery required after reconnect.
- Installed baseline: Python 3.12.14, dimOS 0.0.13.post1, unitree-webrtc-connect 2.2.0. No upgrade.
- Three full rendered excavator replays passed, about 24 seconds each, 44 approach actions then inspect → activate → verify. Replay transport cannot connect to hardware.
- Four network pings: mean 4.469 ms, no loss.
- Stationary physical camera and measured odometry verified. Map telemetry ages sampled at 8, 38 and 72 ms; these are receipt ages, not a controlled walking-latency benchmark.
- No locomotion actions issued. Operator relocation/clearance and a new calibration are required before physical execution.
- Frozen LiDAR source timestamp and disabled onboard avoidance were observed. Explicit sensor enable and freshness diagnostics are being tested; they are not certified resolved.
- Fixed mission uses registered scene semantics for rover-1. Physical camera is available as a diagnostic; full vision-language reasoning and humanoid mission execution are not established.

## Preserved data

[Archive manifest](../runtime.local/evidence/2026-09-04-evening/manifest.json) contains source paths, archive paths, byte counts and SHA-256 hashes.

[All original mission reports](../runtime.local/runs/) include successful and aborted runs.

[Replay results](../runtime.local/replay-results.json), [stationary live samples](../runtime.local/live-stationary-verification.json), [camera frame](../runtime.local/go2-camera.jpg), [verification summary](air-replay-verification.json), [current runbook](air-demo.md), and [exact observation schema](../public/map-observation.schema.json).

Future mission reports record each decision's live target, map pose, raw measured odometry, scene/session sequence and physical sensor diagnostics. Existing runtime logs remain in runtime.local/. No Wi-Fi password is recorded in these artifacts.

## Benchmark follow-up

Use the preserved runs to separate renderer rate, network RTT, map receipt age, source odometry timing, measured displacement, mission completion and STOP behavior. Earlier latency aggregates included preparation calls; do not report them as sensor-to-display physical latency. No physical walking result exists yet.

## Garage relocation

Operator moved Go2 to the garage and powered it off for relocation. Air remains on the private router at 192.168.8.160. The old controller was stopped and shut down; the restarted local service is unarmed and uncalibrated. Reconnect, explicit LiDAR ON/onboard avoidance enable, source freshness validation and a new origin are pending. No physical locomotion has been issued.

## Avoidance announcement incident — physical tests halted

The robot acknowledged starting the previously stopped `obstacles_avoid` service through RobotState service switch (reply code 0, status 0). Its avoidance enable API continued to return 3203. Before that, periodic API 1002 queries reported enable=false. The operator then reported repeated “start obstacle avoidance” / “exit obstacle avoidance” announcements and inability to connect the phone app. Causality between service startup, polling and the repeated announcements is not proven. This is not a successful avoidance validation.

The Air WebRTC session logged closed at 21:03:20; a subsequent process/port audit found no Go2 bridge process and no listener on 8766. No locomotion action was issued. The operator was instructed to power Go2 off. Automatic avoidance setup/service startup and polling have been removed. A persistent `runtime.local/hardware-hold.json` now prevents live reconnection pending operator recovery and verification of robot-side service state. The changed service state has NOT yet been restored or proven reset by reboot.

204 of 204 observed point clouds had distinct content despite the coarse epoch timestamp. A compatibility liveness guard was written and unit tested, preserving the raw timestamp and 0.5-second odometry/cloud gates, but has NOT been physically validated. It does not verify sensor source latency or free space.

[Incident record](../runtime.local/avoidance-incident.json), [garage sensor status](../runtime.local/garage-sensor-status.json), [service diagnostics](../runtime.local/sensor-diagnostics.json). Keep hardware stopped; do not use earlier physical-arm instructions while the incident hold remains.

### Recovery checkpoint

Operator confirmed Go2 powered off. All Air robot processes remain stopped; no hardware reconnection has been attempted since the incident. A controlled reboot with the Air bridge still off was requested to check whether announcements stop and the Unitree app can connect. The hardware hold remains in place.

## Firmware update reported by operator

At 2026-09-05T04:19:47.342881+00:00, the operator reported that the Unitree app connected and began updating Go2. No obstacle-avoidance settings had been changed in the app. Air bridge remains stopped; hardware reconnect hold remains active. Update completion, installed firmware version, normal startup, sensor compatibility and new calibration are unverified. Prior physical compatibility results must not be assumed to apply after this update. Do not interrupt power or Wi-Fi during the update.

## Update completion reported

At 2026-09-05T04:24:41.692796+00:00, the operator reported the Unitree app update completed. Exact firmware version and post-update sensor/API compatibility remain unverified. Operator is locating the obstacle-avoidance setting; Air controller remains stopped and hardware hold retained.

## Remote avoidance confirmation and telemetry-only recovery

Operator reports the setting is absent from the app and used the remote instead; robot announced "start obstacle avoidance". Prior app navigation advice was inaccurate. This is operator-reported enablement, not fresh machine-readable avoidance verification. Autonomous motion remains gated.

Added explicit `connect --telemetry-only`: live sensor subscriptions and measured map feedback are available without any motor publications, including automatic STOP publications. In this mode the operator remote owns physical STOP; Air cannot arm. The persistent hardware hold remains and continues to block motion-capable connections. Nine existing Python safety tests passed, and direct checks verified Move/publish reject and STOP sends nothing on a telemetry-only adapter without constructing a robot connection. Reconnection and post-update measured walking remain pending operator connection readiness; no new physical commands sent.

## Post-update live map feedback verified

Operator confirmed app disconnected and garage ready. LAN rediscovery found Go2 at 192.168.8.115. Connected with telemetry-only motor publications disabled; physical hold retained and arming false. Reset held rehearsal state and calibrated measured origin at scale 10 (10 cm real displacement equals 1 map unit). Three samples advanced raw odometry sequences 895, 900, 906 and map sequences 894, 900, 906; map receipt ages 21, 46, 17 ms. These are stationary receipt ages, not walking latency. Camera frames arrive; LiDAR clouds and machine-readable avoidance confirmation remain unavailable. No physical commands issued. Evidence: runtime.local/post-update-telemetry-verification.json.

## dimOS physical posture and obstacle validation

Operator confirmed Go2 lying down. Added a restricted posture-only connection: one explicit StandUp request, STOP allowed, walking/arming rejected. Ten baseline tests and mocked posture guards passed; then real StandUp API 1004 returned code 0 and measured body height reached 0.328157 m. No locomotion pulse was issued. Odometry became stale during transition; map feedback correctly held and was subsequently reset/recalibrated at the standing origin.

After standing, live LiDAR arrived (about 15,000-18,000 points, odom frame matching measured pose). Explicit lowercase on stream enable follows the installed driver example. Avoidance SwitchGet API 1002 returned enable=true. No avoidance settings or robot services were changed.

Operator placed box: final connection detected 137 forward obstacle points and 11 rotation-halo points at about 0.660 m; both gates blocked. Awaiting removal/clear validation. Recovery arming preserves all prior safety gates and only archives the incident hold after fresh sensor proof, standing, map feedback and clearance pass. Read-only avoidance monitoring begins at explicit arming, is bounded to 95 seconds, and stops with the mission. Eleven baseline/recovery tests passed; separate mocked test verifies only SwitchGet reads and fault on disabled avoidance.

Evidence: runtime.local/stand-preparation.json, post-stand-status.json, avoidance-status-check.json, box-obstructed-check-current.json, pre-walk-calibration.json. Physical autonomous walking remains unverified at this checkpoint.

## Autonomous physical attempt — stopped, mission incomplete

Fixed repeated STOP flooding after stale packets by latching the first fault; twelve safety tests pass. Direct measured odometry subscription removes the shared reactive worker queue. A 30-second stationary camera/LiDAR check passed with maximum measured relative source delay 328 ms. This did not prove moving performance.

After the operator repeated box-in/out validation, the final connection passed its gates and dimOS launched the real excavator approach. Two bounded turn pulses were attempted. Recorded accumulated yaw was 0.030820 rad (about 1.77 degrees); accumulated planar pose variation 0.002853 m is not a verified forward walk. The run stopped after 2.014 seconds with measured_telemetry_stale / delayed_source_odometry. No inspect/activate/verify completion occurred. Explicit STOP/disarm followed, and a fresh hardware hold records the timing blocker.

During earlier diagnostics, source-relative delay peaked near 74 seconds while STOP responses accumulated; that was not absolute synchronized latency. Two Codex browser renderers also exceeded 300% CPU each; this is a possible contributor, not established causation. Garage ICMP RTT: min 6.034 ms, mean 18.908 ms, max 59.981 ms, zero loss in five pings. Neither ping nor stationary success proves the sensor-to-control path is reliable during movement.

Evidence: runtime.local/autonomous-live-1788585059927703000.jsonl, final-stopped-status.json, no-stop-traffic-stability.json, final-timing-diagnostics.json, hardware-hold.json. Autonomous walking is NOT ready. Existing movement bounds, stale thresholds, scene content, and tested dependencies were preserved.

## Direct forward test prepared

User requested a couple of forward steps. Added forward-test through the existing bounded capability: two fixed 0.35-second pulses at maximum 0.04 m/s, no turn, no retry, STOP on every exit. This requests at most about 2.8 cm of nominal displacement, not two full strides. Added bounded motor-request/acknowledgment records; physical displacement remains a separate measurement. The endpoint rejects unarmed calls. Thirteen safety tests and git diff --check pass. Bridge restarted in posture-only mode; measured map alignment refreshed. Awaiting fresh operator obstacle-in/out check before any forward command. No forward pulse has been issued at this checkpoint.


## Installed dimOS forward path and explicit manual-check waiver

User explicitly waived the manual box cycle. Added an explicit skip_box_check option that bypasses only that cycle; real obstacle veto, stale camera/LiDAR/odometry, onboard avoidance confirmation, posture, STOP and bounds remain. Fourteen tests pass, including waiver with real obstruction and stale rejection.

Inspected installed dimOS UnitreeWebRTCConnection.balance_stand() and move(Twist(...), duration): BalanceStand API1002 enables joystick control, move forwards Twist.x to wirelesscontroller.ly. Prepared a single input 0.04 for 0.35 seconds, with guarded publication, explicit zero joystick and independent watchdog. This input is not a calibrated SI speed. Stock stop_movement cancels a timer without sending zero; the wrapper explicitly sends zero. Prior attempted custom mission pulses used Sport API1008; no physical walking was verified.

Reconnected the existing sole Air bridge in posture-only mode. Did NOT call balance_stand or the forward command: fresh telemetry reports body_height=0.095711 m, raw z~0.068 m, below standing gate; error_code=100, meaning not diagnosed. Camera is near floor level. Current LiDAR reports forward_blocked=true, 214 points, nearest 0.431 m; low posture may affect ground inclusion, not established. Sent explicit STOP; remains unarmed. No manual box check requested. Need current physical posture clarification before preparing a stand/forward action.

Evidence: runtime.local/native-before-diagnostics.json, native-before-status.json, native-stopped-status.json, native-posture-camera.jpg. Native dimOS forward routine is prepared, not hardware-verified. No physical forward command sent in this attempt. Latest map/UI and tested dependencies preserved.


## Confirmed lying posture: authorized stand attempt failed

User confirmed Go2 lying down and requested walking in the clear garage. Initial stand request was rejected locally by a previously latched delayed_source_odometry fault (peak relative delay 1050.6 ms). Existing reset/calibration recovered against current measured data; the second request sent exactly one StandUp API1004. The adapter passed its reply-code-zero check but timed out after 12 seconds without measured standing height. Full success reply was not preserved by this failure path; code-zero conclusion follows the executed adapter branch, not a saved raw reply. No forward or BalanceStand command was sent. Explicit STOP/disarm followed. Fresh final diagnostics: body_height 0.095691 m, position z 0.068061 m, controller mcf, mode 0, error_code 100 (not decoded), near-zero reported velocity, sport age 170 ms. Standing command acknowledgment does not establish physical execution.

Evidence: runtime.local/walk-request-before.json, walk-prestand-reset.json, walk-prestand-calibration.json, stand-preparation.json, walk-stand-failed-stop.json, walk-stand-failed-diagnostics.json. Physical walking remains blocked by failure to stand; no repeat box check and no lowered safety threshold.


## First installed dimOS forward publication — no measurable walk

After operator go-ahead, the old stream was found stale by about 143 seconds. Closed that bridge and reconnected the sole controller in posture-only mode. Fresh standing readiness passed; reset, scale-40 measured calibration, obstacle/avoidance gates and explicit recovery arming passed. Manual box cycle waived as explicitly authorized; all live gates retained.

Executed installed balance_stand(): API1002 reply code0. Executed installed move(Twist(linear=[0.04,0,0]), duration=0.35) through the bounded adapter: return true, 16 nonzero wirelesscontroller messages published. Explicit zero joystick and Sport STOP followed; zero/STOP acknowledgments code0. Measured forward delta 0.0000456108 m (0.0456 mm), not a verified walk. Requested 0.04 is an uncalibrated joystick axis input, not proven 0.04 m/s. Routine success=true means command routine completed, not physical locomotion success. Final STOP/disarm completed. No automatic speed increase or repeat pulse.

Evidence: runtime.local/dimos-forward-attempt-1788586915472145000.json and matching runtime.local/runs/forward-test JSON. Physical walking and excavator mission remain unverified.


## Read-only dimOS source investigation after operator prohibited improvisation

No robot requests were issued during this investigation. Installed dimOS connection.py defines free_walk() at line343, documenting locomotion enablement. Existing Air live/runtime source contains no free_walk call. Its TelemetryConnection override also omits the stock connection's motion-mode selection. Neither code difference establishes the physical cause of the failed walk.

Upstream GitHub source inspected in Chrome: https://github.com/dimensionalOS/dimos/blob/main/dimos/robot/unitree/connection.py#L377 . Unedited screenshot: runtime.local/dimos-upstream-freewalk-screenshot.png. It shows free_walk and the newer switch_joystick method. The installed version does not have that standalone switch_joystick method; no upgrade or backport performed. Screenshot is code evidence, not robot-operation evidence. The full-page attempt contains virtualized blank regions and is not suitable as function evidence.

Local-source excerpts and SHA256 hashes saved in runtime.local/dimos-startup-source-evidence.txt. Computer-use access to Terminal/Codex was denied; browser access to the local excerpt URL was blocked. No bypass attempted. Screenshot therefore proves upstream source only, while installed-file observations came from filesystem reads. Root cause remains unverified.

## Stand refusal root cause: robot-side motor fault 309-4

`runtime.local/air-demo.log` at the 22:34:21 connection recorded the robot's active error snapshot: `Error Source 309`, `Error Code 309-4`. Decoded with the installed driver's Unitree app tables: motor 9 (rear-left hip) driver overheating (source family 300 = motor malfunction, code 4 = driver overheating; IMU temperature 79 °C). This explains the authorized StandUp: API 1004 acknowledged with code 0, no measured height change, `error_code` 100, `mode` 0, camera at floor level. By 22:42 (new bridge process, telemetry-only style connect) the robot was standing at z 0.31 m with LiDAR ~17,800 points, camera ~600 ms and avoidance enable=true, consistent with the fault clearing after cooling. Causality is inferred from the error frame and timing; no `rm_error` frame was captured because the previous bridge did not record error frames.

Bridge change: `LiveRobot` now records `errors`/`add_error`/`rm_error` frames, exposes `robot_errors`, `controller_mode` and `body_height_m` in `/status`, refuses `stand` and `arm` on active 1xx/3xx/6xx faults, and drops `controller_ready` (stopping an armed run) while such a fault is active. Fifteen new tests plus the eighteen existing pass (33 total). No robot request was issued during this work; the standing robot was only read through the existing loopback status endpoint.

Added `scripts/air-demo agent`: a dimOS blueprint (`MoontologySkills` + `McpServer` + optional `McpClient`) that gives an LLM read access to the scene ontology, measured robot status and camera, and write access only to the gated `/mission` and `/stop` endpoints. `.cursor/mcp.json` points Cursor at `http://127.0.0.1:9990/mcp`. See [air-demo.md](air-demo.md#reasoning-with-dimos-agent-layer). Not started in this task: the coordinator needs the macOS LCM multicast route (`sudo`) and, for the in-process LLM, an `OPENAI_API_KEY` or a running Ollama; neither is present on this machine.

## Why the Go2 never walked: commanded speed below the gait threshold (community-verified)

Sole-agent session, 23:09–23:30. Reviewed the prior forward attempts against community sources rather than adding another trial:

- `runs/forward-test-1788586917546490000.json`: BalanceStand code 0, 16 nonzero `rt/wirelesscontroller` messages with `ly=0.04` for 0.35 s → 0.0456 mm measured. `runs/mission-1788585062699788000.json`: Sport `Move` 1008 yaw pulses at 0.30 rad/s for 0.35 s → 0.026 rad measured per pulse (the controller does respond to 1008, but only ramps part-way in 0.35 s); forward pulses at 0.04 m/s produced no gait.
- legion1581/go2_webrtc_connect `examples/go2/data_channel/sportmode_mcf/sportmode_mcf.py` (our firmware family, MCF ≥ 1.1.7): `Move` is a fire-and-forget `noreply` request with default `vx=0.3`, `vyaw=0.5`, and "joints may be locked after StandUp — run BalanceStand (1002) before any Move". Its `obstacles_avoid/obstacles_avoid.py` drives with the simulated joystick at `ly=0.9`, published at **50 Hz for 0.5 s**, and states the obstacle-avoid service intercepts and safety-filters joystick input when avoidance is on.
- unitreerobotics/unitree_sdk2 `example/go2/go2_sport_client.cpp` and unitree_ros2 `go2_sport_client.cpp`: `Move(0.3, 0, 0.3)` re-sent on a 500 ms timer; community velocity helpers send at ~50 Hz and note the robot stops ~250 ms after commands cease.
- unitree_sdk2 `obstacles_avoid_api.hpp` / unitree_sdk2_python `obstacles_avoid_client.py`: obstacle-avoid `Move` (1003, `{"x","y","yaw","mode":0}`) and `UseRemoteCommandFromApi` (1004) exist for API driving while avoidance is enabled. Not used yet; kept as the fallback if Sport 1008 proves overridden with avoidance on.
- The installed dimOS `move()` maps `Twist.linear.x` straight onto joystick `ly`; 0.04 is inside the stick deadzone.

Conclusion: nothing in the bridge was broken; the bounded capability was tuned to values (0.04 m/s, 0.35 s) the Go2 controller treats as "hold stance". Changes, all in `robot-bridge`:

- `BoundedCapability`: `MAX_FORWARD` 0.04 → 0.25 m/s, `MAX_YAW` 0.30 → 0.50 rad/s, `MAX_PULSE` 0.35 → 0.80 s (≤ 0.2 m nominal per lease). Travel/radius/yaw/action/run limits unchanged (0.60 m, 0.45 m, 4.0 rad, 120, 90 s). Odometry-jump veto is now time-aware (`jump_limits(dt)`: 0.05 m + 2·v·dt) so a Wi-Fi gap at walking speed is not misread as a jump, while a reordered clock never widens it.
- Wi-Fi jitter tolerance: `STALE_SECONDS` 0.5 → 1.5 s, applied to `delayed_source_odometry`, map feedback validity and `PhysicalSensors.MAX_AGE`. Motion is still bounded by the 50 Hz deadman lease and the robot's own onboard avoidance regardless of odometry.
- Mission per-pulse envelope scales with the commanded pulse (1.5× commanded + ramp slack) instead of the fixed 5 cm/0.20 rad written for 1.4 cm pulses. Forward test is one pulse.
- `arm --skip-box-check` exposed on the CLI (operator already cleared the stationary box cycle; LiDAR obstacle veto, freshness, avoidance confirmation and hardware-fault gates all remain). New `stand-down --clear-area` (Sport `StandDown` 1005) so a standing robot with a hot hip motor can rest; refused while armed or mid-mission.
- 34 tests pass.

Physical attempt blocked: at 23:04 the robot raised **306-4** (motor 6, rear-right hip, driver overheating) after ~1.5 h standing; the previous bridge disconnected at 23:07. When this session's bridge tried to connect at 23:26 the Go2 at 192.168.8.115 had left the network (ARP entry retained, 100 % ping loss, ports 9991/8081 closed, multicast discovery empty) — consistent with power-off, low battery or a Wi-Fi drop. No motor command was issued in this session. Next physical step, once the robot is back on the LAN and cooled: `connect --posture-only` → read `robot_errors` → `reset` → `calibrate` → `arm --clear-lane --robot-standing --recover --skip-box-check` → `forward-test` (one 0.8 s pulse at 0.25 m/s, measured) → `mission`.

## Physical walk verified: excavator mission VERIFIED through dimOS (23:48)

Robot back on the LAN after a power cycle (faults cleared; odometry receipt delay 0.3 ms, max 126 ms — the earlier 0.5–1 s jitter was the pre-reboot state). The Unitree app held the single WebRTC slot until the operator closed it. Connected through the installed dimOS `UnitreeWebRTCConnection`, controller `mcf`, standing 0.319 m, onboard avoidance confirmed enabled.

1. `forward-test`: one Sport `Move` lease at 0.25 m/s for 0.8 s → **0.132 m measured forward**, heading held within 0.02 rad, 33 frames all code 0, clean deadman stop (`runs/forward-test-*.json`). This alone falsifies every earlier "the robot ignores commands" hypothesis: the previous 0.04 m/s request was simply below the gait threshold. The map, however, rejected the resulting pose (`Occupied by H04`) because the test walks along the raw physical heading and 0.13 m is 5.3 scene units at scale 40.
2. First mission (`runs/mission-1788590425312865000.json`): 29 actions in 23 s, 105° in-place turn then a 0.10 m step (map distance 12.1 → 5.5). Ended by the map rejecting a pose as `Occupied by H01`: the approach goal sat 0.5 scene units (1.2 cm physical) from the technician's footprint, and turning drift was ~3–5 cm. Also observed: yaw pulses shorter than ~0.3 s produce no rotation, and a ±0.08 rad heading tolerance makes the quadruped dither.
3. Fixes: map planner (`src/relay/approach.ts`) now chooses an approach goal whose straight lane keeps `CLEARANCE` 1.2 units from other footprints (exact 0.4 footprint only for the final 1.2 units) and the excavator's `interaction_radius` is a shared constant `EXCAVATOR_INTERACTION_RADIUS = 6` (the inspect ring must be wider than one Go2 step, ~3 units at scale 40). Bridge: `HEADING_TOLERANCE` 0.30 rad, `MIN_PULSE` 0.30 s, waypoint "reached" = ¾ of one minimum step, LiDAR corridor lookahead 0.95 → 0.65 m (one lease + stopping distance + margin), and `calibrate --face-waypoint` maps the current physical heading onto the approach bearing so the mission starts with a straight walk instead of an in-place turn.
4. Second mission (`mission-1788590937548124000.json`): **success**, 3.4 s, 6 actions — forward 0.63 s, one −0.5 rad/s correction, forward 0.30 s, then `inspect → inspected`, `activate → ready`, `verify → VERIFIED`. Physical travel 0.203 m, yaw travel 0.33 rad, map round-trip mean 56 ms / max 207 ms. Map state: `rover-1 VERIFIED`, phase `VERIFIED`, robot avatar at (−4.62, 2.28). Robot left standing, disarmed, no faults.

Tests: 34 bridge + 5 map. Community references used: legion1581/go2_webrtc_connect MCF and obstacle-avoid examples, unitreerobotics/unitree_sdk2 sport/obstacles_avoid clients, unitree_ros2 sport example.

## Multi-target navigation verified: building, then humanoid, with room awareness (5 Sep, 00:11–00:12)

Request: after the excavator mission, verify the Go2 can reason toward a *building* and then a *humanoid* on the map — not necessarily arrive, but turn/walk in the right direction while staying aware of the living room. Both the map relay and bridge were excavator-only (`rover-1`), so a bounded generic capability was added first:

- Map (`src/relay/LiveMapState.ts`, `src/main.ts`, `src/relay/approach.ts`): `mission op=approach`/`op=target` accept any registered asset id (`H04`, `digging-bot`, `Airlock-2A`, …) or layout region id (`Building-West`, `Doorway-2A`, …); unknown ids → `unknown_target`. Regions are approached toward their centroid. The planner sweeps standoff radii asking for a straight clear lane only and runs the grid search once, last: the first version ran A* for every radius on the render thread (1.2 s frames), which the bridge's own `presentation_tab_hidden_or_render_stale` gate (>750 ms) correctly refused twice before any motion. After the fix replies are 9–250 ms.
- Bridge (`air_runtime.navigate`, `POST /navigate`, `air-demo navigate <id> --max-steps N`, dimOS skill `navigate_toward`): at most N (1..12) pulses using the mission's steering (yaw until |bearing| ≤ 0.30 rad, else forward), same envelopes, LiDAR corridor veto on every pulse, disarms on completion. Report records target distance/bearing before and after and the room summary at each step.
- Room awareness (`air_sensors.py`): `sectors_m` (nearest LiDAR return per 45° sector within 2 m), `nearest_turn_m`, `nearest_turn_bearing_rad`. Turn-halo veto `TURN_HALO` 0.70 → 0.60 m: the Go2's body corners sweep ≈0.40 m in an in-place yaw, so 0.60 m keeps a 50 % margin (same ratio as the 0.65 m corridor vs 0.30 m lease+stop). Motivation: the robot had walked to 0.67 m from a living-room object during the excavator run, which would otherwise have vetoed every turn while being physically outside the sweep. Pinned by `test_turn_halo_and_room_sectors` (0.67 m ahead: turn allowed, forward allowed; 0.55 m: both vetoed).

Run (bridge `start --live`, `connect`, `reset`, `calibrate --scale 40` at physical yaw 1.23 rad, `arm --clear-lane --robot-standing --skip-box-check`; robot standing, no faults, room before leg 1: front 0.68 m, left 1.35, rear 1.35, right 0.95):

1. Leg 1 `navigate Building-West --max-steps 10` (`runs/navigate-1788592280986301000.json`): **success / step_limit**, 13.9 s. Target: region `West habitat shell`, map bearing 2.61 → 0.94 rad (improvement 1.67 rad), 10 yaw pulses (+0.5 rad/s × 0.80 s), measured yaw travel 2.07 rad, drift 0.226 m (inside the 0.45 m radius). Room awareness during the turn: as the nose swept past the object (steps 4–7, nearest forward 0.59–0.63 m) `forward_blocked` was true and the planner issued yaw only; final front clearance 1.42 m. Map: phase `APPROACHING`, target `Building-West`, avatar (1.45, 7.11) yaw 2.16.
2. Target choice for leg 2 made from the observation like an agent would: `digging-bot` (humanoid technician) at bearing +0.24 rad, standoff 0.19 m, front sector 1.43 m clear — preferred over the nearer-on-map `H04` at −1.18 rad where the room is tightest (0.71 m).
3. Leg 2 `navigate digging-bot --max-steps 4` (`runs/navigate-1788592348583493000.json`): **success / step_limit**, 5.2 s. Step 1 forward 0.25 m/s × 0.76 s → map distance 9.89 → 4.67 units (halved); the map re-planned a nearer standoff and steps 2–4 yawed toward it (bearing 0.78 → 0.31). Physical travel 0.214 m, yaw 0.58 rad, final front clearance 1.35 m, no faults, body height 0.315 m. Map: phase `APPROACHING`, target `digging-bot`, humanoid at 4.17 units bearing 0.19.

Robot left standing, disarmed, no active errors. Tests: 35 bridge + 5 map. For the hackathon space: the same commands with larger `--max-steps` (≤12 per call, chain calls) and the 0.60 m radius / 0.45 m-from-origin envelopes re-armed per leg; `calibrate --face-waypoint` remains excavator-specific.

## Overnight rehearsal: gait fix, scene atlas, pre-planned traverse (5 Sep, 01:00–03:30)

Request (robot off): fix the avatar "jutting" (legs sliding instead of walking), then map the whole environment so the Go2 recognises it at boot without per-scene training, estimate the path from the humanoid locations, mark animated assets as mobile, anticipate pitfalls so the hackathon run time is short. Everything stayed inside dimOS + the existing bridge; no envelope constant changed.

Avatar (`src/go2/Go2GaitAnimator.ts`, `src/go2/Go2Agent.ts`, `air_live.py`): procedural per-limb trot with IK driven by measured velocity; render-behind interpolation and a critically damped follower so a telemetry sample never teleports the body; the bridge subscribes to `LOW_STATE` and forwards the 12 motor angles (`joint_angles`), which drive the URDF when fresh (`robot_pose.joint_source` = telemetry / procedural / rest). Bridge telemetry post rate raised.

Scene atlas (`src/levels/sceneAtlas.ts` → `scripts/build-scene-atlas.mjs` → `public/scene-atlas.json` + `docs/scene-atlas.md`): every entity carries a mobility class (static / animated_in_place / patrol / agent / door), the H-01…H-08 reasoning labels and questions, expected positions; Scene 1 route planned with the map's own planner from live footprints (digging-bot → rover-1 → H02 → Doorway-2A, 26.4 units = 0.66 m at scale 40). Scene 2 is the empty 3.6 × 6.2 foyer (legs planned, not runnable); Scene 3 does not exist. Map observation entities now expose `mobility`, `sequence_label`, `atlas_role`, `expected_position`, `displacement_from_expected` (schema updated). Bridge: `air_atlas.py` loads the atlas at calibrate; `traverse` runs one leg per arm with mobile-target re-observation, face, close-in and interactions; `atlas`, `drift`, `preflight` commands; dimOS skills `scene_atlas`, `scene_drift`, `traverse_leg`; the system prompt carries the atlas brief.

Rehearsal findings, each fixed and turned into an atlas pitfall + unit test where geometric:
1. `map_boundary: Occupied by H01` — a step legal along the *validated* heading was driven at the tolerated yaw 0.2 rad off and clipped the footprint. Then, with only the current yaw checked, the candidate flipped between −30° and −60° on alternate turn pulses (8 wasted pulses at the doorway lane). Fix: a candidate must be clear across its whole ±0.30 rad band (`_driveable`).
2. `map_boundary: North habitat shell` — 0.24 rad heading error over a 7-unit pulse. Fix: `LATERAL_TOLERANCE` caps forward pulses (predicted miss ≤ 0.6 units); `_step_is_clear` mirrors `WorldLayout.sample/footprint/constrain` (swept footprints, doorway > building > terrain precedence).
3. False arrival: planner intermediate path nodes were treated like ring goals. Fix: `approach` returns `kind` (here / goal / path_node) and `radius`; only a goal within 40 % of a physical step is arrival; progress toward a path node is measured toward the node.
4. Chasing stale waypoints after a detour cost a 180° recovery. Fix: re-plan after every forward pulse.
5. Turn pulses ate the step budget (an about-face is ~8 pulses). Fix: `max_steps` counts forward pulses; turns have a per-leg budget from `MAX_YAW_TRAVEL`.
6. Close-in to the excavator ran out of its 3 shared pulses mid-turn (the only band-clear candidate past H01 sits ~70° off) → `inspect not valid`. Fix: separate turn/forward budgets in `_close_in`.
7. Larger room ⇒ smaller scale ⇒ a leg longer than one arm's 0.60 m / 0.45 m envelope would trip `physical_envelope` and report failure. Fix: `_envelope_budget` predicts each pulse and ends the leg as `arm_envelope_budget` (resumable; the next arm continues the same leg).
8. Transition leg: reaching the airlock changes the world and the observation read fails (`scene_changed_read_observation`). Fix: `_world_transition_after` recognises it as `world_transition_triggered`; `resetDemo` re-arms the airlock (`resetScene1`).
9. Ops: the map publishes only while its tab renders (`caffeinate -u`, foreground tab); a `VERIFIED` excavator no longer disarms the run; `reset` retries `demo_spawn_unavailable` once.
10. Publisher pin: after a tab reload/close the relay's authority pin survived forever (`authority_already_pinned` for every new tab until Vite restarted — hit twice tonight). `server/mapRelay.js` now lets a visible local tab take over once the pinned tab has been silent for 10 s (`DEAD_PUBLISHER_MS`); regression test in `tests/map-relay.test.mjs`.

Final replay stability (bridge `start --replay`, map on a second Vite server, `traverse --all --reset-progress --max-steps 12`): scale 40 — 3/3 scenes complete, per leg 2 / 0 / 1–2 / 3 forward steps, rover-1 `inspect → activate → verify VERIFIED` every run, no map rejections (`feedback_error` none), ~35 s per scene; scale 10 — 2/2 complete through resumable `arm_envelope_budget` stops (leg 4 needs ~5 arms, binding budget = 0.45 m radius). Preflight all PASS except WARN `lcm_multicast_route` (fix printed), WARN `agent_llm_backend` (no key in this shell), INFO robot unreachable (off). Tests: 49 bridge (`unittest discover`), 16 map (`node --test`), `tsc` clean, `build-scene-atlas --check` up to date. Left running for the morning: Vite on 5173 with the map tab publishing, bridge in replay (`start --live` replaces it); final end-to-end on that setup: preflight OK, Scene 1 complete in 17 s (1 / 0 / 1 / 3 forward steps, rover-1 VERIFIED). Runbook: [hackathon-runbook.md](hackathon-runbook.md).

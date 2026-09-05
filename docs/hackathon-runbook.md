# Hackathon runbook — Go2 Scene 1 traverse (4-hour build window)

Everything below was rehearsed overnight in replay against the live map (see
[demo-session-record.md](demo-session-record.md), "Overnight rehearsal"). The goal of the
morning is *not* to teach the robot the scene: the scene is pre-mapped in the
[scene atlas](scene-atlas.md) (`public/scene-atlas.json`), the bridge loads it at
`calibrate`, and every leg is planned, budgeted and guarded before a pulse is sent.
The morning is boot → preflight → arm one leg at a time.

Source of truth for commands: [air-demo.md](air-demo.md). Safety gates never move:
connect / calibrate / arm / stand / stop are operator CLI actions; the dimOS agent
only reasons and calls bounded skills.

## 0. Before the robot is switched on (10 min, no hardware)

```bash
cd ~/moontology
caffeinate -u -t 14400 &                 # display must stay awake: the map publishes only while it renders
sudo route -n add -net 224.0.0.0/4 -interface lo0   # LCM multicast for dimOS modules (preflight WARNs if missing)
npm run dev -- --host 127.0.0.1          # Vite on 5173 (air-demo start also spawns it if absent)
```

Open exactly one browser tab at `http://127.0.0.1:5173/` and keep it in the
foreground (a second tab or a hidden tab loses publisher authority / raises
`render_age_ms` > 750 and the run stops with `presentation_tab_hidden_or_render_stale`).
If you close or reload the tab, the new tab takes publisher authority by itself once the
old one has been silent for 10 s (`server/mapRelay.js`); `curl -s 127.0.0.1:5173/api/map/health`
should show `publisher_connected: true` before you continue. No Vite restart needed.

```bash
scripts/air-demo start --replay          # bridge in replay while the robot is off
scripts/air-demo reset && scripts/air-demo calibrate --scale 40
scripts/air-demo preflight               # all PASS except WARN agent_llm_backend / INFO robot_reachable
scripts/air-demo traverse --all --reset-progress --max-steps 12   # ~35 s: the whole Scene 1 in replay
scripts/air-demo atlas --brief           # what the agent knows at boot
```

If `traverse --all` does not print `scene_complete`, stop and read the failing leg's
`stopped_by` before touching hardware — the same code drives the robot.

Agent backend, pick one:
- `export OPENAI_API_KEY=...` then `scripts/air-demo agent --model gpt-4o`
- `scripts/air-demo agent --model ollama:<name>` (local)
- `scripts/air-demo agent --no-llm` → tools on `http://127.0.0.1:9990/mcp`; Cursor's
  `.cursor/mcp.json` already points at it, so the Cursor agent can reason with
  `observe_scene`, `scene_atlas`, `scene_drift`, `traverse_leg`, `navigate_toward`,
  `run_excavator_mission`, `robot_status`, `stop_robot`.

## 1. Robot boot (15 min)

1. Power on, let it stand with the Unitree remote. Stop every other controller
   (Laptop #2, the Unitree app) — the bridge takes an exclusive lock but cannot prove
   remote ownership.
2. Same private Wi-Fi as the Air. `scripts/air-demo discover` → use the discovered IP.
3. `scripts/air-demo shutdown && scripts/air-demo start --live`
4. `scripts/air-demo connect --robot-ip <IP> --sole-controller-confirmed`
5. `scripts/air-demo reset && scripts/air-demo calibrate --scale <S> --face-waypoint`
   (robot still). Scale = map units per physical metre:
   - living room: `--scale 40` → whole Scene 1 = 0.66 m of walking, every leg fits one arm;
   - larger space: `--scale 10` → 2.64 m total; leg 4 (doorway, 15 units) is 1.5–1.9 m and
     needs ~5 arms (each arm allows 0.60 m travel / 0.45 m radius). `--scale 20` is the
     compromise if the floor is ~3 × 3 m.
6. `scripts/air-demo preflight --robot-ip <IP>` — required checks must PASS.
7. `scripts/air-demo sensor-check --stage obstructed` with a box in front, remove it,
   `--stage clear` within 120 s.
8. Hip motors ran hot last night after ~20 min standing: between legs use
   `scripts/air-demo stand-down --clear-area`, then `stand --clear-area` before the next arm.

## 2. Run the scene (one arm per leg)

```bash
scripts/air-demo arm --clear-lane --robot-standing
scripts/air-demo traverse --wait --max-steps 12        # runs the next unfinished leg, prints its report
```

Repeat arm + traverse until the report says `scene_complete`. Progress lives in
`runtime.local/traverse-progress.json`; `traverse --reset-progress` starts over,
`traverse --leg N` forces a leg. `--max-steps` bounds forward pulses only; turns have
their own budget.

Leg order and what "done" looks like:
- Leg 1 `digging-bot` (H-01, mobile → re-observed first): standoff 2.3 units, `face` true.
  Context evidence only; no interaction.
- Leg 2 `rover-1`: already inside the 6-unit ring after leg 1 → `steps 0`, `close_in`
  steps into the ring if the last standoff left it 0.1–0.3 units outside, then
  `inspect → activate → verify` (`VERIFIED`). This is the audience moment.
- Leg 3 `H02` (H-02, mobile): about-face from the excavator (~8 turn pulses) then 1–2
  forward steps. Baseline location of the utility worker.
- Leg 4 `Doorway-2A`: 15 units south-east, 2–3 forward steps at scale 40. Reaching the
  standoff is arrival; the Scene 2 transition fires when the Go2 is within the airlock
  trigger — `navigate Airlock-2A --max-steps 2` after arming again if you want to cross.

Read `stopped_by` in every report:
- `arrived` → next leg.
- `step_limit` / `turn_limit` → leg is unfinished, just arm and run it again.
- `arm_envelope_budget` (`envelope_budget_exhausted`: travel / radius / yaw_travel /
  run_seconds) → normal at scale ≤ 20; arm and run again.
- `step_blocked_by_footprint` / `step_blocked_by_footprint_at_path_node` → the robot is
  boxed in by a humanoid or vehicle footprint; `scripts/air-demo drift` to see what moved,
  then `navigate <somewhere open> --max-steps 2` to step out.
- `physical_sensors` veto (`forward_blocked`, `turn_blocked`) → the real room, not the
  map: look at `sectors_m` / `nearest_turn_bearing_rad`, clear it, re-arm.
- `scene_changed_read_observation` → the map reloaded or transitioned; `reset`,
  `calibrate`, re-arm.
- `measured_action_envelope` / `odometry_jump` → the robot moved more than commanded
  (slip, push). Check the robot, then `reset` + `calibrate`.

`scripts/air-demo stop` at any moment; the Unitree remote's STOP stays in hand.

## 3. What the agent should be asked

The prompt already carries the atlas brief. Good instructions that stay inside the
gates:
- "Observe the scene and tell me which humanoids are mobile and whether any is away
  from its expected stop." → `observe_scene`, `scene_drift`.
- "Run the next atlas leg and report what the robot physically measured." →
  `traverse_leg` (refused unless armed — arm first).
- "Is rover-1 doing what it claims? Verify it." → leg 2 / `run_excavator_mission`.
The agent cannot connect, calibrate or arm; if it says it did, it is wrong.

## 4. Known limits (do not discover these live)

- Scene 2 is a 3.6 × 6.2-unit foyer with no placed assets; Scene 3 does not exist.
  H-03 … H-08 are reasoning labels the ontology and prompt already know; their legs are
  `planned`, not runnable.
- `Building-*` regions are NO_ENTRY; "go to the building" = standoff on the walkway side.
- Background rovers patrol the east apron; the route stays west/south and every leg
  re-observes mobile targets (`pre_check.restaged`).
- The URDF avatar now trots per limb from measured velocity and follows telemetry with a
  critically damped follower; measured joint angles (`LOW_STATE`) drive it when fresh.
  If the avatar looks wrong, the bridge is still fine — it is a rendering path.
- Replay's simulated odometry returns 96 % of the commanded motion; live numbers will
  differ, the gates are sized for that (1.5 s Wi-Fi jitter, 0.75 s map freshness).

Full pitfall list with severities: [scene-atlas.md → Pitfalls](scene-atlas.md#pitfalls).

# Physical Go2 integration boundary

```text
Mac / Moontology
  Three.js + operator UI
          |
          | authenticated LAN WebSocket
          v
Jetson Orin
  dimOS + MoontologyBridge
          |
          | Unitree WebRTC, high-level commands only
          v
Unitree Go2
  onboard balance, gait, obstacle avoidance, safety
```

## Host roles

- Mac: visualization and operator control.
- Orin: robot-side dimOS runtime, telemetry normalization, command limits.
- Go2: physical sensing and onboard locomotion.

Fill `MAC_IP`, `ORIN_IP`, and `GO2_IP` only in shell environment variables or
ignored local environment files. Do not commit credentials or network secrets.

## Safety boundary

- Browser commands never address joints or motors.
- Physical velocity commands are disabled by default.
- STOP supersedes any active timed velocity command.
- The server clamps speed and duration.
- Planner goals stay disabled until physical odometry, STOP, and bounded
  velocity tests pass.
- The official Go2 connection currently stands and balance-stands during
  startup; launching it requires the same physical clearance as a movement
  test.

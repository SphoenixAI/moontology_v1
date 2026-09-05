# Moontology dimOS bridge

This is an external dimOS blueprint; it does not copy or modify dimOS. It
normalizes Go2 odometry for Moontology and accepts only bounded `stop` and
velocity commands over a LAN WebSocket.

## Install

Install dimOS first, then install this package into the same Python 3.12
environment:

```bash
source ~/moontology-robot/.venv/bin/activate
uv pip install -e /path/to/moontology/robot-bridge
moontology-bridge --help
```

dimOS 0.0.14+ also discovers the external blueprint as
`moontology-bridge.websocket`. The dedicated launcher works with the currently
installed stable dimOS 0.0.13 release.

## Safety defaults

- `MOONTOLOGY_COMMANDS_ENABLED` defaults to false.
- `stop` remains accepted when other commands are disabled.
- Velocity is clamped to ±0.20 m/s forward, ±0.10 m/s lateral,
  ±0.50 rad/s yaw, and 500 ms maximum duration.
- `local_goal` remains disabled until the planner is validated on the
  physical robot.
- No bridge command uses raw motors or joints.

Do not launch a real Go2 blueprint until the operator has confirmed
`GARAGE READY`. The current official `GO2Connection.start()` stands the robot
up automatically.

## Orin runtime

Before installing or changing the Orin, collect its hardware/software report:

```bash
bash robot-bridge/scripts/orin-preflight.sh
```

After Go2 discovery, telemetry validation, and the safety confirmation:

```bash
export ROBOT_IP=<GO2_IP>
export MOONTOLOGY_ALLOWED_ORIGINS=http://<MAC_IP>:5173
export MOONTOLOGY_BRIDGE_TOKEN=<RANDOM_LOCAL_TOKEN>
export MOONTOLOGY_COMMANDS_ENABLED=0

moontology-bridge --robot-ip "$ROBOT_IP" --viewer none
```

Health check:

```bash
curl http://<ORIN_IP>:8765/health
```

Enable bounded commands only after STOP and physical clearance are verified:

```bash
export MOONTOLOGY_COMMANDS_ENABLED=1
```

Moontology configuration belongs in an ignored `.env.local`:

```bash
VITE_GO2_BRIDGE_URL=ws://<ORIN_IP>:8765/ws
VITE_GO2_BRIDGE_TOKEN=<RANDOM_LOCAL_TOKEN>
```

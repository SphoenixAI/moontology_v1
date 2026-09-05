from __future__ import annotations

import argparse
import os


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run the official dimOS Go2 basic blueprint with the "
            "fail-closed Moontology bridge."
        )
    )
    parser.add_argument(
        "--robot-ip",
        default=os.getenv("ROBOT_IP"),
        help="Go2 LAN IP (or set ROBOT_IP)",
    )
    parser.add_argument(
        "--viewer",
        choices=("none", "rerun"),
        default="none",
        help="dimOS viewer backend",
    )
    return parser


def main() -> None:
    args = _parser().parse_args()
    if not args.robot_ip:
        raise SystemExit("--robot-ip or ROBOT_IP is required")

    from dimos.core.coordination.blueprints import autoconnect
    from dimos.core.coordination.module_coordinator import ModuleCoordinator
    from dimos.robot.unitree.go2.blueprints.basic.unitree_go2_basic import (
        unitree_go2_basic,
    )

    from .server import MoontologyBridge

    blueprint = autoconnect(
        unitree_go2_basic,
        MoontologyBridge.blueprint(),
    ).global_config(
        robot_ip=args.robot_ip,
        viewer=args.viewer,
    )
    ModuleCoordinator.build(blueprint).loop()


if __name__ == "__main__":
    main()

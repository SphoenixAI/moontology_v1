from __future__ import annotations

import unittest

from moontology_bridge.protocol import (
    CommandValidationError,
    StopCommand,
    VelocityCommand,
    parse_command,
)


class CommandProtocolTests(unittest.TestCase):
    def test_stop_is_always_recognized(self) -> None:
        self.assertEqual(parse_command({"type": "stop"}), StopCommand())

    def test_velocity_is_clamped_to_bounded_limits(self) -> None:
        command = parse_command(
            {
                "type": "velocity",
                "forward": 10,
                "lateral": -10,
                "yaw": 5,
                "durationMs": 30_000,
            }
        )
        self.assertEqual(
            command,
            VelocityCommand(
                forward=0.2,
                lateral=-0.1,
                yaw=0.5,
                duration_ms=500,
            ),
        )

    def test_local_goal_remains_disabled(self) -> None:
        with self.assertRaisesRegex(
            CommandValidationError,
            "planner is validated",
        ):
            parse_command({"type": "local_goal", "x": 1, "y": 0})

    def test_non_finite_velocity_is_rejected(self) -> None:
        with self.assertRaisesRegex(CommandValidationError, "finite number"):
            parse_command(
                {
                    "type": "velocity",
                    "forward": float("nan"),
                    "lateral": 0,
                    "yaw": 0,
                    "durationMs": 100,
                }
            )


if __name__ == "__main__":
    unittest.main()

# Habitat airlock entry repair

Saved in `/Users/sphoenix/moontology` on 2026-09-05. These changes are local working-tree edits, alongside existing work; they have not been committed or pushed by this task.

The facade now uses two beveled, rigid pressure-door leaves. The locks turn, the seal unseats, and the leaves swing outward over 2.2 seconds. They keep their shape throughout opening and closing. The frame overlaps the uneven scanned apron below the gameplay floor so it meets the building without a floating seam. The original FBX, GLB, textures, PNG door source, and World Labs splats were not rewritten.

`airlockPlacement.ts` shares the 1.8 m opening between the visual, approach trigger, threshold, and invisible passage boundary. The registered anchor is `[-0.6, 0.95, -18.35]`. Scene 1 layout revision is now 4. The supported lane continues through the opening at floor Y=-0.23; adjacent habitat walls and the back of the passage still block movement. The existing scene atlas was regenerated from authored source and its explicitly labeled older obstacle snapshot. It is not a fresh robot observation.

Approaching opens the leaves. Crossing the threshold waits for the opening to finish, then uses the existing fade and World Labs loader exactly once. Scene 1 stays available until World 2 successfully loads. Slow SPZ loads no longer fail after an arbitrary default 45-second deadline; genuine errors retain the exit-before-retry behavior. Humanoid task animation continues during the approach/opening and pauses for the actual world transition.

The destination remains the existing `Futuristic Museum Interiors.spz` World 2 and its existing calibrated Go2 spawn. Its chase camera now sits 1 m behind Go2 at 1.25 m above the floor, below the entrance arch, with the robot fully inside the calculated camera frame. Robot pose, physical calibration, STOP, relay, and physical controller were preserved. No physical movement was issued.

## Verification

- Twelve focused airlock checks passed: rigid opening/closing, footprint clearance at the center and both sides, adjacent walls, one load per crossing, missing visual, genuine load failure, slow readiness, cancellation, safety gate, and interior camera. The final camera framing was rechecked mathematically against the full robot envelope.
- Four existing layout checks passed: all demo stops supported, swept wall blocking, all route legs walkable, and transformed boundary observations.
- Typecheck, production build, focused application/test lint, script syntax, atlas consistency, and diff whitespace checks passed.
- In the actual presentation browser at `http://127.0.0.1:5173/?airlockTest`, virtual Go2 walked from outside the entrance to `[-0.60, -0.23, -17.96]`, the door reported `OPEN`, and the transition reached `scene2` at `[0.00, -0.01, 0.00]`. This exercised the existing running map and actual World 2 asset.
- Final browser verification completed after unlocking the Mac on 2026-09-05 at 17:00 UTC (10:00 am Pacific). The actual presentation tab walked through the airlock with the final camera settings: `door OPEN`, entry at `[-0.60, -0.23, -17.97]`, then `scene2` at `[0.00, -0.01, 0.00]`. Go2 was fully visible below the entrance arch. Console evidence showed one transition request at `17:00:26.477Z`, load start at `17:00:27.419Z`, and World 2 loaded at `17:00:30.468Z`, with no browser errors recorded during the check. The presentation tab was returned to `/` to remove the development rehearsal panel.
- The preview later stopped responding. Port 5173 was verified to have no listener before restoring the existing Vite preview on that port; the restored root URL returned HTTP 200. No second preview or dimOS process was started.
- After the final walkthrough, the normal `/` presentation loaded successfully with the route ready, FOLLOW GO2 enabled, and H01, H04, H02, H03, and H06 all reporting playing animations. The development airlock panel is absent. This task issued no physical movement and did not change physical controller state.

For a stationary-robot recheck, use the existing development-only `?airlockTest` panel: stage outside the entrance, then walk through. Its virtual walk is blocked whenever the telemetry bridge is connected. This check does not exercise Laptop #2 or authorize physical motion.

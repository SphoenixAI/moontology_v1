# Moontology operational intelligence

The existing `OntologyStore` owns one `WorldIntelligence` runtime. The existing
Three.js registry still owns scene transforms, and the existing UI receives
derived snapshots through its original subscription. No new server, renderer,
database, robot controller, or synchronization channel was added.

## Running the first loop

Keep the presentation browser at **http://127.0.0.1:5173/** visible. In the existing
**Scene 1 · Demo route** panel, press **Run cable stall demo · simulated**. Open
**Operational Intelligence** to inspect the selected `CABLE-ROVER-01`.

The button emits an ACTIVE self-report and, through the same normalized adapter
used for live input, 500 ms samples of zero motion, position delta, and cable reel
rotation. After at least five continuous seconds, the canonical state is:

- expected DEPLOYING; reported ACTIVE; observed STALLED; authoritative STALLED;
- an open discrepancy carrying source, confidence, evidence IDs, provenance,
  consequence, recommendation, and resolution fields;
- `CableDeployment-17 → CableRun-17 → PowerNode-B → Habitat-2` at risk, plus
  registered dependent work and the planning ISRU processor;
- the cable actor's semantic animation gate paused. The current cable model is
  static; animated actors use the same gate in the existing AnimationMixer loop.

All these samples say **DEMO**. They are not physical Go2 measurements. Demo
evidence cannot override a target after live evidence has been received.
Repeated demos preserve discrepancy/event history for the current page session.

## Canonical state and reconciliation

`src/ontology/worldState.ts` defines assets, tasks, facilities, power nodes,
routes, resources/sites, robot resource state, trust sources, paths, environment
events, observations, discrepancies, and the mission. Four state channels stay
separate, with separate report/observation sources and provenance.

`WorldIntelligence.ts` applies explicit rules for timed stalls, dependency risk,
resource shortage, location mismatch, source arbitration, path isolation,
navigation HOLD, and airlock seal/pressure contradictions. Operator inspection
requests do not invent a Go2 dispatch or verification result. Resolving an issue
records its resolution; it does not resume an actor or a physical controller.

Defaults for this demo are a 5 s stall window, maximum 2 s sample gap/freshness,
0.001 zero-delta tolerance, minimum observation confidence 0.75, minimum source
trust 0.65, location mismatch over 0.75 world units, and pressure slope over
0.05 kPa/s. Physical deployments need measured sensor tolerances and pressure
limits; this run verifies deterministic software behavior.

Graph direction matters: `A dependsOn B` propagates B's failure to A; `A supplies
B` and `A assignedTo T` propagate A's failure to B/T. Traversal is cycle-safe.
An AT_RISK dependency is not a fabricated physical power failure.

The five resource inventories and four resource sites are explicitly DEMO
planning fixtures. They do not label unseen splat features. `ISRU-01` is a
planning entity, not a new mesh. Site ranking considers known supply, confidence,
difficulty and distance. Resource recommendations list eligible extraction and
transport assets; actual collection and discovery rates remain separate
(kg/min and characterized sites/hour). No physical reassignment is dispatched.

## Existing relay and consumer boundary

The inspected checkout uses the consolidated **Air loopback** relay:

`http://127.0.0.1:5173/api/map`

`GET /observation` remains the observation path. It now includes `intelligence`
and per-entity `semantic_state` / `animation_paused_by_ontology`. Existing entity
world positions still come directly from live Object3D world transforms. The
same browser/session/revision/sequence fields identify the presentation scene.
Registry additions/removals are mirrored into semantics; removal keeps history
and removes availability. Unregistered splat content remains unknown.

`POST /intelligence` passes through the existing pinned-publisher relay, same
origin checks, loopback restriction, fresh read-token/context checks, command
deduplication and deadlines. Every request needs a fresh `read_token` from
`GET /observation` and a unique `command_id`. Supported `op` values:

- `observation`: `observation` is a normalized sample.
- `report`: `target`, `state`, and explicit `provenance` LIVE or DEMO.
- `trust`: `source` is a `TrustSource`. Operator configuration, not sensor truth.
- `network_path`: `path` is a `NetworkPath`; isolation/alternate is semantic.
- `resource`: `target`, `inventory`, `requiredSupply`, `provenance`.
- `robot_resource`: `robot` is `RobotResourceState`, plus `provenance`.
- `resource_site`: `site` is `ResourceSite`, including provenance.
- `resolve`: `discrepancy_id`, `reason`; retains motion holds.
- `history`: optional `cursor` and `limit` (max 24), returning
  `intelligence_history` with events/observations/discrepancies and total counts.
- `cable_demo`: the same simulated sequence as the existing scene-panel button.

Regular publications contain recent history and total counts; complete
append-only history remains in the in-memory service and is paged through the
same endpoint. It lasts for the browser runtime, not across a full page reload.

The existing Python `MapClient` in
`robot-bridge/src/moontology_bridge/air_core.py` now exposes `submit_perception`
and `report_asset`. It uses its existing read/POST transport and safety context.
The exact consumer wiring for the coding session that owns real perception is:

```python
# Reuse that session's existing MapClient instance. Do not start a bridge.
map_client.report_asset("CABLE-ROVER-01", "ACTIVE", provenance="LIVE")
map_client.submit_perception(
    sample_id=measured_sample.id,
    source="GO2-01",
    target="CABLE-ROVER-01",
    metric="position_delta",
    value=measured_sample.delta_in_current_map_units,
    confidence=measured_sample.confidence,
    timestamp_ms=measured_sample.timestamp_ms,
    provenance="LIVE",
    frame="three_world",
    unit="world_units",
)
```

Live motion/location samples require the calibrated current `three_world` frame
and `world_units`; reel rotation requires `radians`; pressure slope requires
`kPa/s`. Go2's own odometry is not evidence of another asset's motion. Target
recognition, independent measurement, calibration and freshness must come from
the perception owner; reasoning remains here. Sources must be registered and
trusted. Navigation sources start unavailable until explicitly configured and
supported by fresh observations. Source identities are asserted by the existing
authorized local consumer; this does not add sensor authentication.

**No live semantic perception connection to Laptop #2 was established.** Its
previously supplied address `10.0.0.202:8765` is not this localhost HTTP endpoint.
No Laptop #2 workspace path is assumed or modified. The relay's current loopback
access control was preserved; do not point remote code at localhost and assume
it reaches the Air. Remote wiring requires the existing authorized connection
to the Air, owned by that coding session.

## Safety and validation

Navigation mistrust/staleness latches HOLD, pauses applicable actors, disarms
the existing live-map mission and uses the existing physical STOP path when
telemetry control is active. Map reset/world change/disconnect invalidates
evidence windows and pending map context. Fresh samples or reconnection do not
auto-resume physical motion. The controller's existing arming/calibration gate
remains separate. Airlock contradictions block the existing transition trigger.

Run `node scripts/test-ontology.mjs` for the ten requested acceptance cases plus
malformed input, timing gaps, provenance, relay context, and animation checks.
Run `PYTHONPATH=robot-bridge/src python3 -m unittest discover -s robot-bridge/tests
-p 'test_ontology_adapter.py'` for the consumer boundary. The pre-existing
`test_air_contract.py` additionally requires the installed dimOS interpreter.
These tests use synthetic inputs and do not connect to hardware.

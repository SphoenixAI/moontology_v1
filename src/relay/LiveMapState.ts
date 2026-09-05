import { Vector3, Quaternion, type Object3D } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { OntologyStore } from '../ontology/OntologyStore';
import { EXCAVATOR_INTERACTION_RADIUS } from './approach';
import { expectedPositionOf, mobilityOf, roleOf, sequenceLabelOf } from '../levels/sceneAtlas';
import type { TrustSource, NetworkPath, RobotResourceState, ResourceSite } from '../ontology/worldState';

type State = 'offline' | 'inspected' | 'ready' | 'VERIFIED';
type Phase = 'IDLE' | 'RUNNING' | 'APPROACHING' | 'INSPECTING' | 'ACTIVATING' | 'VERIFYING' | 'HELD' | 'VERIFIED';
type Position = { x: number; y: number; z: number };
export interface MapContext {
  registry: AssetRegistry;
  ontology: OntologyStore;
  robot(): Object3D | null;
  world(): { identity: string; ready: boolean; hold: string | null; metersToWorldUnits: number };
  applyPose(position: Position, yaw: number): string | null;
  /** Measured 12 joint angles (Unitree motor order, radians); visual only. */
  applyJoints?(angles: number[]): boolean;
  jointSource?(): 'procedural' | 'telemetry' | 'rest' | null;
  legacyTelemetryActive(): boolean;
  resetDemo?(): string | null;
  /** Planner waypoint plus what it is (here / goal on the standoff ring / intermediate path node) and the ring radius. */
  planApproach?(targetId?: string): (Position & { kind?: 'here' | 'goal' | 'path_node'; radius?: number }) | null;
  performance?(): { frames: number; last_frame_ms: number; max_frame_ms: number; render_age_ms: number | null; visible: boolean };
}
export interface Command {
  id: string; kind: string; body: Record<string, unknown>;
  context: { scene_session_id: string; scene_revision: number; observation_sequence: number; read_at: number } | null;
  expires_at: number;
}
const visible = (root: Object3D) => {
  let node: Object3D | null = root;
  while (node) { if (!node.visible) return false; node = node.parent; }
  return root.parent !== null;
};
const position = (root: Object3D): Position => {
  const p = root.getWorldPosition(new Vector3()); return { x: p.x, y: p.y, z: p.z };
};
// Go2's authored forward axis is +X; positive Three.js Y yaw turns toward -Z.
const yawOf = (root: Object3D) => {
  const direction = new Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new Quaternion()));
  return Math.atan2(-direction.z, direction.x);
};
export class LiveMapState {
  sceneSessionId = crypto.randomUUID();
  sceneRevision = 1;
  private sequence = 0;
  private worldIdentity: string;
  private lastTick = Date.now();
  private lastPose: Position | null = null;
  private lastYaw = 0;
  private holdPose = false;
  private source: 'manual' | 'physical_odometry' | 'replay' = 'manual';
  private telemetryAt = 0;
  private telemetrySequence = -1;
  private telemetryFresh = false;
  private runId: string | null = null;
  private mode: 'rehearsal' | 'telemetry' | 'replay' = 'rehearsal';
  private armed = false;
  private phase: Phase = 'IDLE';
  private target: string | null = null;
  private reportedPhase: string | null = null;
  private roverState: State = 'offline';
  private event = { kind: 'scene_started', timestamp: new Date().toISOString() };
  private cached = new Map<string, { fingerprint: string; status: number; error?: string }>();
  private layoutSignature = '';
  private context: MapContext;
  readonly browserId: string;
  readonly browserUrl: string;
  constructor(context: MapContext, browserId: string, browserUrl: string) {
    this.context = context; this.browserId = browserId; this.browserUrl = browserUrl;
    this.worldIdentity = context.world().identity;
  }
  private invalidate(kind: string, newSession = false) {
    if (newSession || ['scene_heartbeat_lost', 'telemetry_disconnected', 'telemetry_stale', 'relay_disconnected'].includes(kind)) this.context.ontology.invalidateEvidence(kind);
    if (newSession) this.sceneSessionId = crypto.randomUUID();
    this.sceneRevision++; this.armed = false;
    if (this.runId) this.phase = 'HELD';
    this.holdPose = this.runId !== null || this.source !== 'manual'; this.telemetryFresh = false;
    this.event = { kind, timestamp: new Date().toISOString() };
  }
  resetNotice(reason = 'scene_reset') { this.invalidate(reason, true); }
  savedPose() { return this.source !== 'manual' || this.mode === 'telemetry' && this.runId ? { position: this.lastPose, yaw: this.lastYaw, source: this.source } : null; }
  restorePose(saved: { position: Position; yaw: number; source?: string }) {
    if (!saved?.position || ![saved.position.x, saved.position.y, saved.position.z, saved.yaw].every(Number.isFinite)) return;
    this.lastPose = saved.position; this.lastYaw = saved.yaw;
    this.source = saved.source === 'physical_odometry' ? 'physical_odometry' : saved.source === 'replay' ? 'replay' : 'manual'; this.holdPose = true;
    this.event = { kind: 'scene_reloaded_reread_required', timestamp: new Date().toISOString() };
  }
  tick(now = Date.now()) {
    const world = this.context.world();
    const root = this.context.robot();
    if (this.context.ontology.getMissionState().state === 'HOLD' && (this.armed || this.runId && this.phase !== 'HELD')) this.invalidate('ontology_safety_hold');
    if (world.identity !== this.worldIdentity) {
      this.worldIdentity = world.identity; this.invalidate('world_changed', true);
    } else if (now - this.lastTick > 1500) {
      this.invalidate('scene_heartbeat_lost');
    }
    this.lastTick = now;
    const layout = this.context.ontology.getSnapshot().layout;
    const signature = JSON.stringify([world.ready, layout?.world, layout?.layoutRevision,
      layout?.obstacleRevision, layout?.regions, ...this.context.registry.values().map(asset =>
        [asset.config.id, asset.root.userData.sceneMotionSource === 'SCHEDULED_BACKGROUND'
          ? ['SCHEDULED_BACKGROUND', asset.root.userData.scenePlacementRevision ?? 0] : position(asset.root), visible(asset.root)])]);
    if (this.layoutSignature && signature !== this.layoutSignature) this.sceneRevision++;
    this.layoutSignature = signature;
    if (this.telemetryFresh && now - this.telemetryAt > 2000) this.invalidate('telemetry_stale');
    if (world.hold && this.event.kind !== world.hold) this.invalidate(world.hold);
    if (root) {
      if (this.holdPose && this.lastPose) {
        const p = new Vector3(this.lastPose.x, this.lastPose.y, this.lastPose.z);
        root.position.copy(root.parent ? root.parent.worldToLocal(p) : p);
        // AgentRoot is parented under an unrotated scene asset layer.
        root.rotation.y = this.lastYaw;
      } else { this.lastPose = position(root); this.lastYaw = yawOf(root); }
    }
  }
  ownsPose() { return this.source !== 'manual' || this.holdPose; }
  isMissionHeld() { return this.phase === 'HELD'; }
  observation() {
    this.tick();
    const root = this.context.robot(), world = this.context.world();
    const pose = root ? { ...position(root), yaw: yawOf(root), frame: 'three_world', source: this.source,
      telemetry_fresh: this.telemetryFresh, telemetry_sequence: this.telemetrySequence,
      telemetry_age_ms: this.telemetryAt ? Date.now() - this.telemetryAt : null,
      joint_source: this.context.jointSource?.() ?? null } : null;
    const snapshot = this.context.ontology.getSnapshot();
    const entities = this.context.registry.values().flatMap(asset => {
      const semantic = snapshot.objects.find(object => object.id === asset.config.id);
      if (!semantic) return [];
      const p = position(asset.root), isVisible = visible(asset.root);
      const distance = pose ? Math.hypot(p.x - pose.x, p.z - pose.z) / world.metersToWorldUnits : null;
      const bearing = pose ? Math.atan2(Math.sin(Math.atan2(-(p.z - pose.z), p.x - pose.x) - pose.yaw),
        Math.cos(Math.atan2(-(p.z - pose.z), p.x - pose.x) - pose.yaw)) : null;
      const excavator = asset.config.id === 'EXC-01';
      const state = excavator ? this.roverState : semantic.properties.backgroundMotionState &&
        ['STAGED', 'ACTIVE'].includes(semantic.properties.status)
        ? `SCENE_${semantic.properties.backgroundMotionState}` : semantic.properties.status;
      const radius = excavator ? EXCAVATOR_INTERACTION_RADIUS : null;
      const actions = !this.context.ontology.canAnimate(asset.config.id) || !excavator || !isVisible || !world.ready || distance === null ? [] :
        state === 'VERIFIED' ? [] : distance > radius! ? ['approach'] :
          state === 'offline' ? ['inspect'] : state === 'inspected' ? ['activate'] : ['verify'];
      // Atlas annotations: how the object moves and which story beat it carries, plus
      // drift from its authored placement so re-staged humanoids are recognised.
      const expected = expectedPositionOf(asset.config.id);
      const displacement = expected ? Math.hypot(p.x - expected[0], p.z - expected[2]) : null;
      return [{ id: excavator ? 'rover-1' : asset.config.id === 'H01' ? 'digging-bot' : asset.config.id, scene_object_id: asset.config.id,
        type: excavator ? 'excavator' : asset.config.id === 'H01' ? 'humanoid technician' : semantic.type, state, world_position: p, distance_from_robot: distance, bearing,
        visible: isVisible, line_of_sight: null, interaction_radius: radius,
        semantic_state: this.context.ontology.getAssetState(asset.config.id) ?? null,
        animation_paused_by_ontology: asset.root.userData.semanticPaused === true,
        interactable: actions.length > 0 && actions[0] !== 'approach',
        object_affordances: excavator ? ['approach', 'inspect', 'activate', 'verify'] : [], currently_valid_actions: actions,
        mobility: mobilityOf(asset.config.id) ?? 'static', sequence_label: sequenceLabelOf(asset.config.id), atlas_role: roleOf(asset.config.id),
        expected_position: expected ? { x: expected[0], y: expected[1], z: expected[2] } : null,
        displacement_from_expected: displacement === null ? null : Number(displacement.toFixed(3)) }];
    });
    return { scene_session_id: this.sceneSessionId, scene_revision: this.sceneRevision,
      observation_sequence: ++this.sequence, timestamp: new Date().toISOString(), map_ready: world.ready,
      active_world: world.identity, robot_pose: pose,
      intelligence: { ...snapshot.semantic, observations: snapshot.semantic.observations.slice(-24), events: snapshot.semantic.events.slice(-24), discrepancies: snapshot.semantic.discrepancies.slice(-24),
        history_counts: snapshot.semantic.historyCounts },
      mission_state: { run_id: this.runId, phase: this.phase, reported_phase: this.reportedPhase,
        target_id: this.target, mode: this.mode, map_armed: this.armed, physical_arming: 'local_operator_gate',
        verification_scope: 'map_semantic_only', hold_reason: this.holdPose ? this.event.kind : null },
      entities, performance: this.context.performance?.() ?? null, layout: snapshot.layout ?? null, last_event: this.event,
      authoritative_browser: { browser_id: this.browserId, url: this.browserUrl },
      spatial_contract: { frame: 'three_world', up: '+Y', forward_at_zero_yaw: '+X',
        yaw_positive_toward: '-Z', position_units: 'world_units', meters_to_world_units: world.metersToWorldUnits,
        distance_units: 'meters_planar_xz', bearing_units: 'radians_relative_to_robot',
        visible_means: 'registered_object_and_ancestors_visible', line_of_sight: 'unknown_not_raycast_verified' } };
  }
  handle(command: Command) {
    this.tick();
    let history: ReturnType<OntologyStore['getHistory']> | undefined;
    let navigation: (Position & { kind?: string; radius?: number }) | null | undefined;
    const finish = (status: number, error?: string) => ({ id: command.id, status,
      body: { ok: status < 400, ...(error ? { error, requires_observation: true } : {}), observation: this.observation(), ...(history ? { intelligence_history: history } : {}), ...(navigation !== undefined ? { navigation } : {}) } });
    if (Date.now() > command.expires_at) return finish(409, 'expired_command');
    if (command.kind === 'observation') return finish(200);
    const c = command.context, b = command.body;
    if (!c || c.scene_session_id !== this.sceneSessionId || c.scene_revision !== this.sceneRevision || Date.now() - c.read_at > 2000)
      return finish(409, 'scene_changed_read_observation');
    const key = String(b.command_id);
    const { read_token: _token, ...payload } = b; void _token;
    const fingerprint = JSON.stringify({ kind: command.kind, payload });
    const previous = this.cached.get(key);
    if (previous) return previous.fingerprint === fingerprint ? finish(previous.status, previous.error) : finish(409, 'command_id_reused');
    let status = 200, error: string | undefined, spawnBlock: string | null;
    const reject = (reason: string) => { status = 409; error = reason; };
    const world = this.context.world();
    if (command.kind === 'intelligence') {
      try {
        const ontology = this.context.ontology;
        if (b.op === 'history') history = ontology.getHistory(Number(b.cursor ?? 0), Number(b.limit ?? 24));
        else if (b.op === 'robot_resource' && ['LIVE', 'DEMO'].includes(String(b.provenance))) ontology.updateRobotResource(b.robot as RobotResourceState, b.provenance as 'LIVE' | 'DEMO');
        else if (b.op === 'resource_site') ontology.updateResourceSite(b.site as ResourceSite);
        else if (b.op === 'observation') ontology.ingestObservation(b.observation);
        else if (b.op === 'report' && ['LIVE', 'DEMO'].includes(String(b.provenance))) ontology.ingestReport(String(b.target), String(b.state), b.provenance as 'LIVE' | 'DEMO');
        else if (b.op === 'trust') ontology.configureTrust(b.source as TrustSource);
        else if (b.op === 'network_path') ontology.configurePath(b.path as NetworkPath);
        else if (b.op === 'resource' && ['LIVE', 'DEMO'].includes(String(b.provenance))) ontology.updateResource(String(b.target), Number(b.inventory), Number(b.requiredSupply), b.provenance as 'LIVE' | 'DEMO');
        else if (b.op === 'resolve') ontology.resolveDiscrepancy(String(b.discrepancy_id), String(b.reason ?? ''));
        else if (b.op === 'cable_demo') ontology.startCableDemo();
        else reject('unknown_intelligence_operation');
      } catch (e) { status = 400; error = e instanceof Error ? e.message : 'invalid_intelligence_command'; }
    } else if (this.context.ontology.getMissionState().state === 'HOLD' && ['mission', 'interaction', 'telemetry'].includes(command.kind) && b.op !== 'hold' && b.connected !== false) {
      reject('ontology_safety_hold_operator_revalidation_required');
    } else if (command.kind === 'reset') {
      if (!['mission', 'session', 'demo'].includes(String(b.scope))) reject('scope_must_be_mission_session_or_demo');
      else if (this.source !== 'manual' && this.telemetryFresh) reject('disconnect_telemetry_before_rehearsal_reset');
      else if (b.scope === 'demo' && (spawnBlock = this.context.resetDemo?.() ?? null)) reject(`demo_spawn_unavailable: ${spawnBlock}`);
      else {
        this.invalidate(b.scope === 'session' ? 'session_reset' : 'mission_reset', b.scope === 'session');
        this.runId = null; this.phase = 'IDLE'; this.target = null; this.reportedPhase = null;
        this.roverState = 'offline'; this.mode = 'rehearsal'; this.armed = false;
        this.source = 'manual'; this.holdPose = false; this.telemetrySequence = -1; this.telemetryAt = 0;
        this.syncRover();
        const root = this.context.robot(); if (root) { this.lastPose = position(root); this.lastYaw = yawOf(root); }
      }
    } else if (command.kind === 'mission') {
      switch (b.op) {
        case 'start':
          if (!world.ready || !this.context.registry.get('EXC-01')) reject('map_not_ready');
          else if (b.target_id !== 'rover-1' || !['rehearsal', 'telemetry', 'replay'].includes(String(b.mode))) reject('invalid_target_or_mode');
          else if (this.runId) reject('reset_required_before_new_run');
          else { this.runId = crypto.randomUUID(); this.target = 'rover-1'; this.mode = b.mode as typeof this.mode;
            this.phase = 'RUNNING'; this.armed = false; this.sceneRevision++;
            if (this.mode !== 'rehearsal') { this.holdPose = true; this.event = {kind: 'awaiting_telemetry', timestamp: new Date().toISOString()}; }
          } break;
        case 'arm':
          // A VERIFIED excavator does not end the run: the scene traverse continues to later
          // legs (H-02, the habitat doorway). Its interactions stay closed (valid actions = []).
          if (!this.runId || !world.ready || world.hold || (this.mode !== 'rehearsal' && !this.telemetryFresh)) reject('run_ready_and_fresh_telemetry_required');
          else { this.armed = true; this.holdPose = false; this.phase = 'RUNNING'; this.sceneRevision++; } break;
        case 'approach': {
          // Default: the excavator mission target. Any registered asset or layout region id may
          // be approached explicitly; interactions stay excavator-only.
          const targetId = b.target_id === undefined ? 'EXC-01' : this.resolveTarget(String(b.target_id));
          if (!this.runId || !world.ready) reject('run_ready_required');
          else if (!targetId) reject('unknown_target');
          else { navigation = this.context.planApproach?.(targetId) ?? null;
            if (!navigation) reject('no_current_map_path');
            else if (this.armed) { this.phase = 'APPROACHING'; this.reportedPhase = 'APPROACHING'; }
          } break; }
        case 'hold': this.invalidate('consumer_hold'); break;
        case 'phase':
          if (!this.runId || !this.armed) reject('mission_not_armed');
          else if (!['APPROACHING', 'INSPECTING', 'ACTIVATING', 'VERIFYING'].includes(String(b.phase))) reject('invalid_phase');
          else { this.reportedPhase = String(b.phase); this.phase = b.phase as Phase; this.sceneRevision++; } break;
        case 'target': {
          const targetId = this.resolveTarget(String(b.target_id));
          if (!targetId) reject('unknown_target');
          else { this.target = String(b.target_id);
            if (this.context.registry.get(targetId)) this.context.ontology.selectEntity(targetId);
            this.sceneRevision++; } break; }
        default: reject('unknown_mission_operation');
      }
    } else if (command.kind === 'interaction') {
      const rover = this.observation().entities.find(entity => entity.id === b.entity_id);
      if (b.entity_id !== 'rover-1' || !rover) reject('unknown_interactive_entity');
      else if (!rover.visible || !world.ready) reject('entity_unavailable');
      else if (rover.distance_from_robot === null || rover.distance_from_robot > rover.interaction_radius!) reject('approach_required');
      else if (!this.armed || !this.runId || this.target !== 'rover-1') reject('mission_not_armed');
      else if (!rover.currently_valid_actions.includes(String(b.action))) reject('invalid_action_for_state');
      else {
        this.roverState = b.action === 'inspect' ? 'inspected' : b.action === 'activate' ? 'ready' : 'VERIFIED';
        this.phase = b.action === 'inspect' ? 'INSPECTING' : b.action === 'activate' ? 'ACTIVATING' : 'VERIFIED';
        if (this.roverState === 'VERIFIED') this.armed = false;
        this.sceneRevision++; this.syncRover();
      }
    } else if (command.kind === 'telemetry') {
      if (!this.runId || this.mode === 'rehearsal') reject('telemetry_run_required');
      else if ((this.mode === 'telemetry' && b.source !== 'physical_odometry') || (this.mode === 'replay' && b.source !== 'replay')) reject('telemetry_source_mode_mismatch');
      else if (this.context.legacyTelemetryActive()) reject('existing_bridge_owns_pose');
      else if (b.connected === false) { this.invalidate('telemetry_disconnected'); }
      else if (world.hold || !world.ready) reject('map_not_ready_or_held');
      else {
        const p = b.position as Position | undefined;
        if (b.frame !== 'three_world' || b.connected !== true || !p || ![p.x, p.y, p.z, b.yaw, b.sample_sequence, b.timestamp_ms].every(v => typeof v === 'number' && Number.isFinite(v))) reject('invalid_pose');
        else if (!Number.isSafeInteger(b.sample_sequence) || Number(b.sample_sequence) <= this.telemetrySequence) reject('out_of_order_telemetry');
        else if (Date.now() - Number(b.timestamp_ms) > 2000 || Number(b.timestamp_ms) - Date.now() > 500) reject('stale_telemetry_timestamp');
        else {
          const blocked = this.context.applyPose(p, Number(b.yaw));
          if (blocked) { this.invalidate('map_pose_rejected'); reject(blocked); }
          else { this.source = this.mode === 'replay' ? 'replay' : 'physical_odometry'; this.holdPose = !this.armed; this.telemetryAt = Date.now();
            // Optional measured leg joints ride along with the pose; they only articulate the visual rig.
            const joints = b.joint_angles;
            if (Array.isArray(joints) && joints.length === 12 && joints.every(v => typeof v === 'number' && Number.isFinite(v)))
              this.context.applyJoints?.(joints as number[]);
            this.telemetrySequence = Number(b.sample_sequence); this.telemetryFresh = true;
            const root = this.context.robot()!; this.lastPose = position(root); this.lastYaw = yawOf(root);
          }
        }
      }
    } else reject('unknown_command');
    if (status < 400 && !['telemetry', 'intelligence'].includes(command.kind)) this.context.ontology.setDemoMissionState('EXC-01', this.roverState, this.phase, this.mode);
    this.cached.set(key, { fingerprint, status, error });
    if (this.cached.size > 256) this.cached.delete(this.cached.keys().next().value!);
    return finish(status, error);
  }
  /** Map an observation/entity id or layout region id onto the scene id the planner uses. */
  private resolveTarget(id: string): string | null {
    const sceneId = id === 'rover-1' ? 'EXC-01' : id === 'digging-bot' ? 'H01' : id;
    if (this.context.registry.get(sceneId)) return sceneId;
    const layout = this.context.ontology.getSnapshot().layout;
    return layout?.regions?.some((r: { id: string }) => r.id === sceneId) ? sceneId : null;
  }
  private syncRover() {
    // Explicit simulated state property: never fabricate physical inspection evidence.
    const root = this.context.registry.get('EXC-01')?.root;
    if (root) root.userData.mapMissionState = this.roverState;
    this.context.ontology.setDemoMissionState('EXC-01', this.roverState, this.phase, this.mode);
  }
}

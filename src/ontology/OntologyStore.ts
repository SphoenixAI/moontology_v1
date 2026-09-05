import { seedOperationalIntelligence } from './operationalSeed';
import { WorldIntelligence } from './WorldIntelligence';
import type { Provenance, TrustSource, NetworkPath, RobotResourceState, ResourceSite } from './worldState';
import { LUNAR_TASK_PROFILES } from './lunarTaskProfiles';
import type {
  DerivedIntelligence,
  EvidenceComparison,
  FleetSummary,
  ObservationInput,
  OntologyActionRecord,
  OntologyActionRequest,
  OntologyObject,
  OntologyPosition,
  OntologyRelation,
  OntologySeed,
  OntologySnapshot,
  OntologyTraceEntry,
  SelectedAnalysis,
  TelemetryUpdate,
} from './types';

type OntologyListener = (snapshot: OntologySnapshot) => void;



const clampPercentage = (value: number): number =>
  Math.max(0, Math.min(100, value));

export class OntologyStore {
  private readonly intelligence: WorldIntelligence;
  private semanticEventsSeen = 0;
  private demoStartedAt: number | null = null;
  private demoLastSample = 0;
  private registeredSceneIds = new Set<string>();
  private batchDepth = 0;
  private batchPending = false;
  private readonly mission: OntologySeed['mission'];
  private readonly objects = new Map<string, OntologyObject>();
  private relations: OntologyRelation[];
  private readonly discrepancyIds = new Set<string>();
  private readonly actions: OntologyActionRecord[] = [];
  private readonly trace: OntologyTraceEntry[];
  private readonly listeners = new Set<OntologyListener>();
  private selectedEntityId: string;
  private revision = 0;
  private sequence = 19;
  private layoutRegionIds = new Set<string>();
  private layoutProvider: (() => OntologySnapshot['layout']) | null = null;

  constructor(seed: OntologySeed) {
    this.intelligence = new WorldIntelligence(seed.objects, seed.relations);
    seedOperationalIntelligence(this.intelligence);
    this.mission = { ...seed.mission };
    for (const object of seed.objects) {
      this.objects.set(object.id, {
        ...object,
        capabilities: [...object.capabilities],
        properties: { ...object.properties },
      });
    }
    this.relations = this.intelligence.state.relations;
    seed.discrepancyIds.forEach((id) => this.discrepancyIds.add(id));
    this.trace = seed.trace.map((entry) => ({ ...entry }));
    this.selectedEntityId = seed.selectedEntityId;

    if (!this.objects.has(this.selectedEntityId)) {
      throw new Error(
        `[ontology] Initial selection "${this.selectedEntityId}" does not exist.`,
      );
    }
  }

  setSceneLabel(scene: string): void {
    this.mission.scene = scene;
    this.commit();
  }

  /** Scene playback is distinct from physical observations and task evidence. */
  setSceneCue(id: string, action: string, state: 'READY' | 'PLAYING' | 'PAUSED' | 'COMPLETE'): void {
    const subject = this.requireObject(id);
    if (subject.properties.rehearsalState === state && subject.properties.rehearsalAction === action) return;
    subject.properties.rehearsalState = state;
    subject.properties.rehearsalAction = action;
    if (state === 'PLAYING') {
      this.selectedEntityId = id;
      this.mission.phase = `SCENE REHEARSAL · ${action}`;
    }
    this.commit();
  }

  setBackgroundMotion(id: string, state: string): void {
    const object = this.objects.get(id); if (!object) return;
    if (object.properties.backgroundMotionState === state) return;
    object.properties.backgroundMotionState = state;
    this.commit();
  }
  canAnimateBackground(id: string): boolean {
    const properties = this.objects.get(id)?.properties;
    return this.canAnimate(id) && !!properties && ['STAGED', 'ACTIVE'].includes(properties.status) &&
      (!properties.health || properties.health === 'NOMINAL');
  }

  /** Read the same evidence as the main UI, without changing its selection. */
  getProximityBrief(id: string) {
    const object = this.objects.get(id), profile = LUNAR_TASK_PROFILES[id];
    if (!object || !profile) return null;
    const analysis = this.buildAnalysis(id);
    const related = new Set([id, object.properties.currentTask, ...analysis.intelligence.downstreamImpact.map(i=>i.objectId)]);
    const issues = [...this.objects.values()].filter(o=>o.type==='Alert' && o.properties.status==='OPEN' && related.has(o.properties.subjectId));
    const task = object.properties.currentTask ? this.objects.get(object.properties.currentTask) : null;
    return { id, task: task?.label ?? profile.title,
      hardware: issues.length ? `${issues.length} open · ${issues[0].description ?? issues[0].label}` : `Unverified · ${profile.hardwareCheck}`,
      reasoning: analysis.evidence.result === 'DISCREPANCY' ? 'Report ≠ observation → inspect locally'
        : analysis.evidence.result === 'ALIGNED' ? 'Evidence agrees → continue task'
        : analysis.intelligence.verificationRequired ? 'Verification requested → await Go2 evidence' : profile.reasoning,
      evidence: analysis.evidence.observed.state === 'NOT OBSERVED' ? 'Scene cue · physical evidence pending'
        : `${analysis.evidence.observed.source} · ${analysis.evidence.observed.state}`,
      result: issues.length ? 'DISCREPANCY' : analysis.evidence.result,
    };
  }

  setDemoMissionState(id: string, state: string, phase: string, source: string): void {
    const object = this.objects.get(id); if (!object) return;
    if (object.properties.demoMissionState === state && this.mission.phase === `EXCAVATOR · ${phase}`) return;
    object.properties.demoMissionState = state; object.properties.demoMissionSource = source;
    object.properties.status = state; this.mission.phase = `EXCAVATOR · ${phase}`;
    this.commit();
  }

  subscribe(listener: OntologyListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** One UI notification for a complete live-transform sample, not one per coordinate. */
  batch(update: () => void): void {
    this.batchDepth++;
    try { update(); } finally {
      this.batchDepth--;
      if (!this.batchDepth && this.batchPending) { this.batchPending = false; this.commit(); }
    }
  }

  setLayoutProvider(provider: () => OntologySnapshot['layout']): void {
    this.layoutProvider = provider;
    this.commit();
  }

  syncLayoutRegions(): void {
    const layout = this.layoutProvider?.();
    const live = new Set<string>(); let changed = false;
    for (const region of layout?.regions ?? []) {
      live.add(region.id);
      const xs = region.polygon.map(p => p[0]), zs = region.polygon.map(p => p[1]);
      const properties = { status: region.kind === 'building' ? 'NO_ENTRY' : 'MAPPED',
        position: { x: (Math.min(...xs)+Math.max(...xs))/2, y: region.floorY ?? 0, z: (Math.min(...zs)+Math.max(...zs))/2 },
        footprint: { width: Math.max(...xs)-Math.min(...xs), depth: Math.max(...zs)-Math.min(...zs) },
        role: region.kind, source: 'PRESENTATION_MAP_AUTHORED_LAYOUT', boundary: region.polygon, validActions: region.validActions };
      if (JSON.stringify(this.objects.get(region.id)?.properties) !== JSON.stringify(properties)) {
        this.objects.set(region.id, { id: region.id, type: region.kind === 'building' ? 'Habitat' : region.kind === 'walkway' ? 'Route' : 'WorkZone',
          label: region.label, capabilities: ['Inspectable'], properties }); changed = true;
      }
    }
    for (const id of this.layoutRegionIds) if (!live.has(id)) { this.objects.delete(id); changed = true; }
    if (this.layoutRegionIds.has(this.selectedEntityId) && !live.has(this.selectedEntityId)) this.selectedEntityId = 'GO2-01';
    this.layoutRegionIds = live;
    if (changed) this.commit();
  }

  updateSurface(id: string, region: string, status: string): void {
    const object = this.objects.get(id);
    if (!object || object.properties.surfaceRegion === region && object.properties.placementStatus === status) return;
    object.properties.surfaceRegion = region; object.properties.placementStatus = status; this.commit();
  }

  getSnapshot(): OntologySnapshot {
    this.projectSemanticState();
    const objects = [...this.objects.values()];
    return {
      semantic: this.getSemanticSnapshot(),
      layout: this.layoutProvider?.() ?? null,
      revision: this.revision,
      mission: this.mission,
      objects,
      relations: [...this.relations],
      selectedEntityId: this.selectedEntityId,
      discrepancyIds: [...this.discrepancyIds],
      actions: [...this.actions],
      trace: this.trace.slice(-60),
      analysis: this.buildAnalysis(this.selectedEntityId),
      fleet: this.buildFleetSummary(objects),
    };
  }

  selectEntity(id: string): void {
    if (!this.objects.has(id) || this.selectedEntityId === id) {
      return;
    }
    this.selectedEntityId = id;
    this.commit();
  }

  recordObservation(input: ObservationInput): OntologyObject<'Observation'> {
    this.ingestObservation({ id: input.id ?? crypto.randomUUID(), source: input.observerId, target: input.subjectId,
      timestamp: Date.now(), metric: 'state', value: input.state, confidence: input.confidence, provenance: 'DEMO' });
    const observation: OntologyObject<'Observation'> = { id: input.id ?? `Observation-${++this.sequence}`, type: 'Observation',
      label: `SIMULATED ${input.observerId} observation`, description: input.note, capabilities: [],
      properties: { status: 'DEMO_EVIDENCE', observedState: input.state, observedBehavior: input.behavior,
        confidence: input.confidence, source: `DEMO · ${input.observerId}`, subjectId: input.subjectId, lastObservation: new Date().toISOString() } };
    this.objects.set(observation.id, observation); this.commit(); return observation;
  }

  updateReportedState(
    objectId: string,
    reportedState: string,
    update: TelemetryUpdate = {},
  ): void {
    const object = this.requireObject(objectId);
    this.intelligence.report(objectId, reportedState, 'LIVE');
    object.properties.reportedState = reportedState;
    const timestamp = this.nextTimestamp();
    const report: OntologyObject<'TelemetryReport'> = {
      id: `Telemetry-${objectId}-${this.sequence}`,
      type: 'TelemetryReport',
      label: `${objectId} telemetry`,
      capabilities: [],
      properties: {
        status: 'RECEIVED',
        reportedState,
        confidence: update.confidence ?? 0.95,
        source: update.source ?? objectId,
        subjectId: objectId,
        lastObservation: timestamp,
      },
    };
    this.objects.set(report.id, report);
    this.commit();
  }

  updateTaskProgress(taskId: string, progress: number): void {
    const task = this.requireObject(taskId);
    if (task.type !== 'Task') {
      throw new Error(`[ontology] "${taskId}" is not a Task.`);
    }
    task.properties.taskProgress = clampPercentage(progress);
    const semanticTask = this.intelligence.entity(taskId);
    if (semanticTask) semanticTask.expectedState = progress >= 100 ? 'COMPLETE' : 'IN_PROGRESS';
    task.properties.status =
      progress >= 100 ? 'COMPLETE' : progress > 0 ? 'IN_PROGRESS' : 'AT_RISK';
    this.commit();
  }

  setAssetHealth(objectId: string, health: string): void {
    const object = this.requireObject(objectId);
    object.properties.health = health;
    const asset = this.intelligence.entity(objectId);
    if (asset) { asset.health = health; if (health === 'FAILED' || health === 'DEGRADED') this.intelligence.setState(asset, health, 'operator_health', health, 'OPERATOR'); }
    if (health === 'DEGRADED' || health === 'FAILED') {
      object.properties.status = health;
    }
    this.commit();
  }

  updatePosition(objectId: string, position: OntologyPosition): void {
    const object = this.requireObject(objectId);
    const current = object.properties.position;
    if (
      current &&
      Math.abs(current.x - position.x) < 0.02 &&
      Math.abs(current.y - position.y) < 0.02 &&
      Math.abs(current.z - position.z) < 0.02
    ) {
      return;
    }
    object.properties.position = { ...position };
    const asset = this.intelligence.entity(objectId);
    if (asset) asset.location = { ...position };
    this.commit();
  }

  createDiscrepancy(objectId: string, reason: string): void {
    this.intelligence.raiseIssue(objectId, reason); this.commit();
  }

  requestVerification(
    subjectId: string,
    observerId = 'GO2-01',
  ): OntologyActionRecord {
    this.intelligence.event('inspection_requested', subjectId, 'Independent Go2 inspection requested; physical execution remains behind the existing controller safety gate.', 'OPERATOR');
    const subject = this.requireObject(subjectId);
    const observer = this.requireObject(observerId);
    subject.properties.verificationStatus = 'REQUESTED';
    // A semantic request does not dispatch physical motion or fabricate an asset report.
    observer.properties.currentTask = `VERIFY:${subjectId}`;

    const existingRelation = this.relations.find(
      (item) =>
        item.from === observerId &&
        item.to === subjectId &&
        item.type === 'observes',
    );
    if (existingRelation) {
      existingRelation.status = 'REQUESTED';
    } else {
      this.relations.push({
        id: `${observerId}:observes:${subjectId}`,
        from: observerId,
        to: subjectId,
        type: 'observes',
        status: 'REQUESTED',
      });
    }

    const timestamp = this.nextTimestamp();
    const action = this.addAction({
      type: 'requestPhysicalInspection',
      targetId: subjectId,
      actorId: 'MISSION-CONTROL',
      summary: `Physical verification requested for ${subjectId}`,
      timestamp,
      parameters: { observerId },
    });
    this.trace.push(
      {
        id: `trace-verification-${this.sequence}`,
        kind: 'action',
        label: 'Physical verification requested',
        timestamp,
        status: 'complete',
      },
      {
        id: `trace-dispatch-${this.sequence}`,
        kind: 'action',
        label: `${observerId} inspection requested; awaiting physical execution`,
        timestamp,
        status: 'active',
      },
    );
    this.commit();
    return action;
  }

  confirmVerification(input: ObservationInput): void {
    this.recordObservation(input);
    this.requireObject(input.subjectId).properties.verificationStatus = 'CONFIRMED';
    this.commit();
  }

  executeOntologyAction(
    request: OntologyActionRequest,
  ): OntologyActionRecord {
    if (request.type === 'requestPhysicalInspection') {
      const observerId =
        typeof request.parameters?.observerId === 'string'
          ? request.parameters.observerId
          : 'GO2-01';
      return this.requestVerification(request.targetId, observerId);
    }

    const target = this.requireObject(request.targetId);
    const timestamp = this.nextTimestamp();
    let summary = `${request.type} executed for ${request.targetId}`;

    if (request.type === 'reassignTask') {
      const replacementId = request.parameters?.replacementId;
      const taskId =
        typeof request.parameters?.taskId === 'string'
          ? request.parameters.taskId
          : target.properties.currentTask;
      if (typeof replacementId !== 'string' || !taskId) {
        throw new Error(
          '[ontology] reassignTask requires replacementId and taskId.',
        );
      }
      const replacement = this.requireObject(replacementId);
      const task = this.requireObject(taskId);
      this.relations = this.relations.filter(
        (item) =>
          !(
            item.from === request.targetId &&
            item.to === taskId &&
            item.type === 'assignedTo'
          ),
      );
      if (
        !this.relations.some(
          (item) =>
            item.from === replacementId &&
            item.to === taskId &&
            item.type === 'assignedTo',
        )
      ) {
        this.relations.push({
          id: `${replacementId}:assignedTo:${taskId}`,
          from: replacementId,
          to: taskId,
          type: 'assignedTo',
          status: 'REASSIGNED',
        });
      }
      delete target.properties.currentTask;
      replacement.properties.currentTask = taskId;
      replacement.properties.status = 'REASSIGNED';
      task.properties.status = 'RECOVERING';
      this.intelligence.state.relations = this.relations.map(e => ({ ...e }));
      const old = this.intelligence.entity(target.id), next = this.intelligence.entity(replacementId);
      if (old) old.assignedTask = undefined;
      if (next) next.assignedTask = taskId;
      summary = `${task.label} reassigned from ${request.targetId} to ${replacementId}`;

      const alert = [...this.objects.values()].find(
        (object) =>
          object.type === 'Alert' &&
          object.properties.subjectId === request.targetId,
      );
      if (alert) {
        alert.properties.status = 'MITIGATED';
      }
      this.trace.push({
        id: `trace-reassigned-${this.sequence}`,
        kind: 'action',
        label: `Task reassigned to ${replacementId}`,
        timestamp,
        status: 'complete',
      });
    } else if (request.type === 'isolateAsset') {
      const a = this.intelligence.entity(target.id);
      if (a) this.intelligence.setState(a, 'ISOLATED', 'operator_isolation', 'Operator isolated this asset.', 'OPERATOR');
    } else if (request.type === 'resumeAsset') {
      throw new Error('Fresh independent verification and explicit safety revalidation required; resume does not assert ACTIVE.');
    } else if (request.type === 'holdFleet') {
      for (const object of this.objects.values()) {
        if (object.capabilities.includes('MobileAsset')) {
          object.properties.status = 'HOLD';
        }
      }
      this.intelligence.hold('Operator fleet hold');
      summary = 'Mobile fleet placed on hold';
    } else if (request.type === 'rerouteAsset') {
      const a = this.intelligence.entity(target.id);
      if (a) a.expectedState = 'REROUTING';
      this.intelligence.event('reroute_requested', target.id, 'Reroute requested; no physical movement or route verification inferred.', 'OPERATOR');
    }

    const action = this.addAction({
      ...request,
      actorId: request.actorId ?? 'MISSION-CONTROL',
      summary,
      timestamp,
      parameters: request.parameters ?? {},
    });
    this.commit();
    return action;
  }

  private addAction(input: {
    type: OntologyActionRecord['type'];
    targetId: string;
    actorId: string;
    summary: string;
    timestamp: string;
    parameters: Readonly<Record<string, string | number | boolean>>;
  }): OntologyActionRecord {
    const action: OntologyActionRecord = {
      id: `Action-${input.type}-${this.sequence}`,
      type: input.type,
      targetId: input.targetId,
      actorId: input.actorId,
      status: 'EXECUTED',
      summary: input.summary,
      timestamp: input.timestamp,
      parameters: input.parameters,
    };
    this.actions.push(action);
    return action;
  }

  private buildAnalysis(entityId: string): SelectedAnalysis {
    const object = this.requireObject(entityId);
    const evidence = this.buildEvidence(object);
    const intelligence: DerivedIntelligence = {
      discrepancy: this.discrepancyIds.has(entityId),
      taskAtRisk: this.findAtRiskTasks(object),
      downstreamImpact: this.buildImpactChain(entityId),
      replacementCandidates: this.findReplacementCandidates(entityId),
      verificationRequired:
        object.properties.verificationStatus === 'REQUIRED' ||
        object.properties.verificationStatus === 'REQUESTED',
    };
    return { entityId, evidence, intelligence };
  }

  private buildEvidence(object: OntologyObject): EvidenceComparison {
    const task = object.properties.currentTask
      ? this.objects.get(object.properties.currentTask)
      : undefined;
    const progress = task?.properties.taskProgress;
    const latestObservation = [...this.objects.values()]
      .filter(
        (candidate) =>
          candidate.type === 'Observation' &&
          candidate.properties.subjectId === object.id,
      )
      .at(-1);
    const report = [...this.objects.values()]
      .filter(
        (candidate) =>
          candidate.type === 'TelemetryReport' &&
          candidate.properties.subjectId === object.id,
      )
      .at(-1);

    const semantic = this.intelligence.entity(object.id);
    return {
      authoritative: { state: semantic?.authoritativeState ?? object.properties.status,
        detail: semantic?.blockedBy.length ? `Blocked by ${semantic.blockedBy.join(', ')}` : 'Selected by deterministic reconciliation',
        source: `${semantic?.provenance ?? 'PLAN'} · ${semantic?.authoritySource ?? 'MISSION_PLAN'}`, confidence: semantic?.observationConfidence },
      expected: {
        state:
          object.properties.expectedState ??
          task?.properties.expectedState ??
          object.properties.status,
        detail: task
          ? `${task.label} · progress ${progress ?? 0}%`
          : object.properties.role ?? object.label,
        source: 'MISSION PLAN',
      },
      reported: {
        state: object.properties.reportedState ?? 'NO REPORT',
        detail: report?.label ?? 'Latest autonomous state report',
        source: semantic?.lastReportedAt ? `${semantic.reportedProvenance} · ${semantic.reportedSource}` : report?.properties.source ?? object.id,
        confidence: report?.properties.confidence,
      },
      observed: {
        state: object.properties.observedState ?? 'NOT OBSERVED',
        detail:
          object.properties.observedBehavior ??
          latestObservation?.description ??
          'No physical behavior classification',
        source: semantic?.lastObservedAt ? `${semantic.observedProvenance} · ${semantic.observedSource}` : 'NO INDEPENDENT OBSERVATION',
        confidence:
          latestObservation?.properties.confidence ??
          object.properties.confidence,
      },
      result: this.discrepancyIds.has(object.id)
        ? 'DISCREPANCY'
        : !semantic?.lastObservedAt || semantic.observedState === 'NOT_OBSERVED' || semantic.reportedState === 'NO_REPORT' ? 'UNVERIFIED' : 'ALIGNED',
    };
  }

  private findAtRiskTasks(object: OntologyObject): string[] {
    const taskIds = new Set<string>();
    if (object.properties.currentTask) {
      taskIds.add(object.properties.currentTask);
    }
    for (const item of this.relations) {
      if (item.from === object.id && item.type === 'assignedTo') {
        taskIds.add(item.to);
      }
    }
    return [...taskIds].filter((id) => {
      const status = this.objects.get(id)?.properties.status;
      return status === 'AT_RISK' || status === 'BLOCKED';
    });
  }

  private buildImpactChain(entityId: string): DerivedIntelligence['downstreamImpact'] {
    return this.intelligence.downstream(entityId).flatMap(id => {
      const object = this.objects.get(id); return object ? [{ objectId: id, label: object.label, state: object.properties.status }] : [];
    });
  }

  private findReplacementCandidates(entityId: string): string[] {
    const object = this.objects.get(entityId);
    if (
      !object ||
      object.type !== 'Humanoid' ||
      !object.properties.currentTask
    ) {
      return [];
    }
    const requiredSkills = object.properties.skills ?? [];
    return [...this.objects.values()]
      .filter(
        (candidate) =>
          candidate.id !== entityId &&
          candidate.type === 'Humanoid' &&
          candidate.properties.health === 'NOMINAL' &&
          (candidate.properties.skills ?? []).some((skill) =>
            requiredSkills.includes(skill),
          ),
      )
      .map((candidate) => candidate.id);
  }

  private buildFleetSummary(objects: readonly OntologyObject[]): FleetSummary {
    const fleet = objects.filter((object) => !!this.intelligence.state.assets[object.id]);
    const nominal = fleet.filter(
      (object) => object.properties.health === 'NOMINAL' && this.canAnimate(object.id),
    ).length;
    const hasFailed = fleet.some(
      (object) => object.properties.health === 'FAILED',
    );
    return {
      nominal,
      total: fleet.length,
      state: hasFailed
        ? 'CRITICAL'
        : nominal === fleet.length
          ? 'NOMINAL'
          : 'ATTENTION',
    };
  }

  private requireObject(id: string): OntologyObject {
    const object = this.objects.get(id);
    if (!object) {
      throw new Error(`[ontology] Unknown object "${id}".`);
    }
    return object;
  }

  private nextTimestamp(): string {
    this.sequence += 1;
    return new Date().toISOString();
  }

  updateRobotResource(robot: RobotResourceState, provenance: Provenance) { this.intelligence.updateRobotResource(robot, provenance); this.commit(); }
  updateResourceSite(site: ResourceSite) { this.intelligence.updateResourceSite(site); this.commit(); }
  getHistory(cursor = 0, limit = 24) {
    const w = this.intelligence.state, offset = Math.max(0, Math.floor(cursor)), count = Math.max(1, Math.min(24, Math.floor(limit)));
    if (!Number.isFinite(offset) || !Number.isFinite(count)) throw new Error('invalid_history_cursor');
    return structuredClone({ cursor: offset, next: offset + count, events: w.events.slice(offset, offset + count), observations: w.observations.slice(offset, offset + count), discrepancies: w.discrepancies.slice(offset, offset + count),
      counts: { events: w.events.length, observations: w.observations.length, discrepancies: w.discrepancies.length } });
  }
  getResourceState(id: string) { return structuredClone(this.intelligence.state.resources[id]); }
  syncSceneRegistry(entities: { id: string; type: OntologyObject['type']; label: string; position: OntologyPosition }[]): void {
    const ids = new Set(entities.map(e => e.id)); let changed = false;
    for (const e of entities) {
      if (!this.objects.has(e.id)) {
        const object: OntologyObject = { ...e, capabilities: ['Inspectable'], properties: { status: 'REGISTERED', position: e.position, source: 'PRESENTATION_MAP' } };
        this.objects.set(e.id, object); this.intelligence.register(object);
        this.intelligence.event('entity_registered', e.id, 'Mission entity registered alongside the live Object3D.', 'PLAN'); changed = true;
      }
    }
    for (const id of this.registeredSceneIds) if (!ids.has(id)) {
      const a = this.intelligence.entity(id);
      if (a) { a.available = false; this.intelligence.setState(a, 'REMOVED', 'entity_removed', 'Removed from the live registry; historical evidence retained.', 'PLAN'); }
      changed = true;
    }
    this.registeredSceneIds = ids; if (changed) this.commit();
  }
  getTrustState() { return structuredClone(this.intelligence.state.trustSources); }
  configureTrust(source: TrustSource, provenance: Provenance = 'OPERATOR') { this.intelligence.configureTrust(source, provenance); this.commit(); }
  configurePath(path: NetworkPath, provenance: Provenance = 'OPERATOR') { this.intelligence.configurePath(path, provenance); this.commit(); }
  updateResource(id: string, inventory: number, required: number, provenance: Provenance) { this.intelligence.updateResource(id, inventory, required, provenance); this.commit(); }
  invalidateEvidence(reason: string) { this.demoStartedAt = null; this.intelligence.invalidateEvidence(reason); this.commit(); }
  resolveDiscrepancy(id: string, reason: string) { this.intelligence.resolveDiscrepancy(id, reason); this.commit(); }
  getWorldState() { return structuredClone(this.intelligence.state); }
  private getSemanticSnapshot() {
    const w = this.intelligence.state;
    // Full history stays in the service; render/publisher updates remain bounded.
    return structuredClone({ ...w, observations: w.observations.slice(-24), events: w.events.slice(-24), discrepancies: w.discrepancies.slice(-24),
      historyCounts: { observations: w.observations.length, events: w.events.length, discrepancies: w.discrepancies.length } });
  }
  getAssetState(id: string) { const a = this.intelligence.entity(id); return a && structuredClone(a); }
  getMissionState() { return structuredClone(this.intelligence.state.missionStatus); }
  getDiscrepancies() { return structuredClone(this.intelligence.state.discrepancies); }
  canAnimate(id: string) { return this.intelligence.canAnimate(id); }
  ingestObservation(raw: unknown, now = Date.now()) {
    const result = this.intelligence.ingest(raw, now); this.commit(); return result;
  }
  ingestReport(id: string, state: string, provenance: Provenance, now = Date.now()) {
    this.intelligence.report(id, state, provenance, now); this.commit();
  }
  startCableDemo(now = Date.now()): void {
    if (this.intelligence.state.observations.some(o => o.target === 'CABLE-ROVER-01' && o.provenance === 'LIVE'))
      throw new Error('Live cable evidence exists; simulated samples cannot override it.');
    const cable = this.intelligence.entity('CABLE-ROVER-01'); if (!cable) return;
    cable.expectedState = 'DEPLOYING'; this.demoStartedAt = now; this.demoLastSample = 0;
    this.intelligence.report(cable.id, 'ACTIVE', 'DEMO', now); this.selectedEntityId = cable.id; this.commit();
  }
  tickIntelligence(now = Date.now()): void {
    if (this.demoStartedAt !== null && now - this.demoLastSample >= 500) {
      this.demoLastSample = now;
      for (const metric of ['motion_delta', 'position_delta', 'reel_rotation']) this.intelligence.ingest({
        id: `cable-demo-${this.demoStartedAt}-${now}-${metric}`, source: 'GO2-01', target: 'CABLE-ROVER-01',
        metric, value: 0, timestamp: now, confidence: .94, provenance: 'DEMO' }, now);
      if (now - this.demoStartedAt >= 6000) this.demoStartedAt = null;
    }
    this.intelligence.tick(now);
    if (this.semanticEventsSeen !== this.intelligence.state.events.length) this.commit();
  }
  private projectSemanticState(): void {
    for (const a of this.intelligence.entities()) {
      if (!this.objects.has(a.id)) this.objects.set(a.id, { id: a.id, type: a.assetType as OntologyObject['type'], label: a.id, capabilities: [], properties: { status: a.authoritativeState, source: 'DEMO_PLAN' } });
      const object = this.objects.get(a.id)!;
      Object.assign(object.properties, { status: a.authoritativeState, authoritativeState: a.authoritativeState,
        expectedState: a.expectedState, reportedState: a.reportedState, observedState: a.observedState,
        confidence: a.observationConfidence, currentTask: a.assignedTask, health: a.health,
        lastObservation: a.lastObservedAt ? new Date(a.lastObservedAt).toISOString() : undefined });
    }
    for (const d of this.intelligence.state.discrepancies) {
      this.objects.set(d.id, { id: d.id, type: 'Alert', label: `${d.target} · ${d.rule}`, description: `${d.provenance}: ${d.missionConsequence} ${d.recommendedAction}`,
        capabilities: [], properties: { status: d.resolved ? 'MITIGATED' : 'OPEN', severity: d.severity, source: d.observationSource, subjectId: d.target } });
      if (d.resolved && !this.intelligence.state.discrepancies.some(other => other.target === d.target && !other.resolved)) this.discrepancyIds.delete(d.target);
      if (!d.resolved) { this.discrepancyIds.add(d.target); const p = this.objects.get(d.target)?.properties;
        if (p && !['REQUESTED', 'CONFIRMED'].includes(p.verificationStatus ?? '')) p.verificationStatus = 'REQUIRED'; }
    }
    for (const r of Object.values(this.intelligence.state.resources)) this.objects.set(r.id, { id: r.id, type: 'Resource', label: r.id, capabilities: [],
      description: `${r.provenance} · ${r.recommendation}`, properties: { status: r.priority, role: `${r.inventory}/${r.requiredSupply} ${r.unit} · shortage ${r.shortage}`, source: r.provenance } });
    for (const s of Object.values(this.intelligence.state.trustSources)) this.objects.set(`Source:${s.id}`, { id: `Source:${s.id}`, type: 'TrustSource', label: s.id, capabilities: [],
      properties: { status: s.state, confidence: s.trustScore, role: `${s.role} · ${s.independenceGroup}` } });
    for (const p of Object.values(this.intelligence.state.networkPaths)) this.objects.set(`Path:${p.id}`, { id: `Path:${p.id}`, type: 'NetworkPath', label: p.id, capabilities: [],
      properties: { status: p.isolationState, confidence: p.trust, role: `Alternate: ${p.alternate ?? 'none'}` } });
    for (const e of this.intelligence.state.events.slice(this.semanticEventsSeen)) this.trace.push({ id: e.id,
      kind: e.rule === 'observation_received' ? 'observation' : 'decision', label: `${e.provenance} · ${e.target}: ${e.reason}`,
      timestamp: new Date(e.timestamp).toISOString(), status: 'complete' });
    this.semanticEventsSeen = this.intelligence.state.events.length;
  }

  private commit(): void {
    if (this.batchDepth) { this.batchPending = true; return; }
    this.intelligence.propagate();
    this.revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

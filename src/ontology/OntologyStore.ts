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

const IMPACT_RELATIONS = new Set([
  'assignedTo',
  'dependsOn',
  'supplies',
  'blocks',
]);

const clampPercentage = (value: number): number =>
  Math.max(0, Math.min(100, value));

export class OntologyStore {
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

  constructor(seed: OntologySeed) {
    this.mission = seed.mission;
    for (const object of seed.objects) {
      this.objects.set(object.id, {
        ...object,
        capabilities: [...object.capabilities],
        properties: { ...object.properties },
      });
    }
    this.relations = seed.relations.map((item) => ({ ...item }));
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

  subscribe(listener: OntologyListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): OntologySnapshot {
    const objects = [...this.objects.values()];
    return {
      revision: this.revision,
      mission: this.mission,
      objects,
      relations: [...this.relations],
      selectedEntityId: this.selectedEntityId,
      discrepancyIds: [...this.discrepancyIds],
      actions: [...this.actions],
      trace: [...this.trace],
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
    const subject = this.requireObject(input.subjectId);
    this.requireObject(input.observerId);
    const observationId =
      input.id ?? `Observation-${input.observerId}-${this.sequence}`;
    const timestamp = input.timestamp ?? this.nextTimestamp();
    const observation: OntologyObject<'Observation'> = {
      id: observationId,
      type: 'Observation',
      label: `${input.observerId} observation of ${input.subjectId}`,
      description: input.note,
      capabilities: [],
      properties: {
        status: 'AUTHORITATIVE',
        observedState: input.state,
        observedBehavior: input.behavior,
        confidence: input.confidence,
        source: input.observerId,
        subjectId: input.subjectId,
        lastObservation: timestamp,
      },
    };

    this.objects.set(observation.id, observation);
    subject.properties.observedState = input.state;
    subject.properties.observedBehavior = input.behavior;
    subject.properties.lastObservation = timestamp;
    subject.properties.confidence = input.confidence;
    this.trace.push({
      id: `trace-observation-${this.sequence}`,
      kind: 'observation',
      label: `${input.observerId} observation recorded`,
      timestamp,
      status: 'complete',
    });
    this.commit();
    return observation;
  }

  updateReportedState(
    objectId: string,
    reportedState: string,
    update: TelemetryUpdate = {},
  ): void {
    const object = this.requireObject(objectId);
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
    task.properties.status =
      progress >= 100 ? 'COMPLETE' : progress > 0 ? 'IN_PROGRESS' : 'AT_RISK';
    this.commit();
  }

  setAssetHealth(objectId: string, health: string): void {
    const object = this.requireObject(objectId);
    object.properties.health = health;
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
    this.commit();
  }

  createDiscrepancy(objectId: string, reason: string): void {
    const object = this.requireObject(objectId);
    object.properties.verificationStatus = 'REQUIRED';
    if (this.discrepancyIds.has(objectId)) {
      this.commit();
      return;
    }

    this.discrepancyIds.add(objectId);
    const timestamp = this.nextTimestamp();
    this.objects.set(`Alert-${objectId}-${this.sequence}`, {
      id: `Alert-${objectId}-${this.sequence}`,
      type: 'Alert',
      label: `${objectId} state discrepancy`,
      description: reason,
      capabilities: [],
      properties: {
        status: 'OPEN',
        severity: 'AMBER',
        source: 'ONTOLOGY_RULE',
        subjectId: objectId,
      },
    });
    this.trace.push({
      id: `trace-discrepancy-${this.sequence}`,
      kind: 'detection',
      label: 'Discrepancy detected',
      timestamp,
      status: 'complete',
    });
    this.commit();
  }

  requestVerification(
    subjectId: string,
    observerId = 'GO2-01',
  ): OntologyActionRecord {
    const subject = this.requireObject(subjectId);
    const observer = this.requireObject(observerId);
    subject.properties.verificationStatus = 'REQUESTED';
    observer.properties.status = 'DISPATCHED';
    observer.properties.reportedState = 'EN_ROUTE';
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
        label: `${observerId} dispatched`,
        timestamp,
        status: 'active',
      },
    );
    this.commit();
    return action;
  }

  confirmVerification(input: ObservationInput): void {
    this.recordObservation(input);
    const subject = this.requireObject(input.subjectId);
    const observer = this.requireObject(input.observerId);
    subject.properties.verificationStatus = 'CONFIRMED';
    subject.properties.health = 'DEGRADED';
    subject.properties.status = 'DEGRADED';
    observer.properties.status = 'VERIFIED';
    observer.properties.reportedState = 'INSPECTION_COMPLETE';

    const observes = this.relations.find(
      (item) =>
        item.from === input.observerId &&
        item.to === input.subjectId &&
        item.type === 'observes',
    );
    if (observes) {
      observes.status = 'CONFIRMED';
    }

    const timestamp = this.nextTimestamp();
    const replacements = this.findReplacementCandidates(input.subjectId);
    this.trace.push(
      {
        id: `trace-confirmed-${this.sequence}`,
        kind: 'observation',
        label: 'Discrepancy confirmed',
        timestamp,
        status: 'complete',
      },
      {
        id: `trace-degraded-${this.sequence}`,
        kind: 'decision',
        label: `${input.subjectId} marked DEGRADED`,
        timestamp,
        status: 'complete',
      },
    );
    if (replacements[0]) {
      this.trace.push({
        id: `trace-replacement-${this.sequence}`,
        kind: 'decision',
        label: `Replacement candidate ${replacements[0]} identified`,
        timestamp,
        status: 'active',
      });
    }
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
      target.properties.status = 'ISOLATED';
    } else if (request.type === 'resumeAsset') {
      target.properties.status = 'ACTIVE';
    } else if (request.type === 'holdFleet') {
      for (const object of this.objects.values()) {
        if (object.capabilities.includes('MobileAsset')) {
          object.properties.status = 'HOLD';
        }
      }
      summary = 'Mobile fleet placed on hold';
    } else if (request.type === 'rerouteAsset') {
      target.properties.status = 'REROUTING';
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

    return {
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
        source: report?.properties.source ?? object.id,
        confidence: report?.properties.confidence,
      },
      observed: {
        state: object.properties.observedState ?? 'NOT OBSERVED',
        detail:
          object.properties.observedBehavior ??
          latestObservation?.description ??
          'No physical behavior classification',
        source: latestObservation?.properties.source ?? 'SCENE MOTION',
        confidence:
          latestObservation?.properties.confidence ??
          object.properties.confidence,
      },
      result: this.discrepancyIds.has(object.id)
        ? 'DISCREPANCY'
        : 'ALIGNED',
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
    const impact: DerivedIntelligence['downstreamImpact'][number][] = [];
    const visited = new Set([entityId]);
    let frontier = [entityId];

    for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const sourceId of frontier) {
        for (const item of this.relations) {
          if (
            item.from !== sourceId ||
            !IMPACT_RELATIONS.has(item.type) ||
            visited.has(item.to)
          ) {
            continue;
          }
          const target = this.objects.get(item.to);
          if (!target) {
            continue;
          }
          visited.add(item.to);
          next.push(item.to);
          impact.push({
            objectId: target.id,
            label: target.label,
            state: target.properties.status,
            relation: item.type,
          });
        }
      }
      frontier = next;
    }
    return impact;
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
    const fleet = objects.filter((object) => object.type === 'Humanoid');
    const nominal = fleet.filter(
      (object) => object.properties.health === 'NOMINAL',
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
    return `T+00:19:${String(this.sequence).padStart(2, '0')}`;
  }

  private commit(): void {
    this.revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

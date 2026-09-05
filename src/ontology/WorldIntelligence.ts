import type { OntologyObject, OntologyRelation } from './types';
import { isPosition, normalizeObservation } from './ObservationAdapter';
import type { AssetState, Observation, Provenance, WorldState, TrustSource, NetworkPath, RobotResourceState, ResourceSite } from './worldState';

export const STALL_THRESHOLD_MS = 5000;
export const EVIDENCE_FRESH_MS = 2000;
export const TRUST_THRESHOLD = .65;
const stopped = new Set(['STALLED', 'HOLD', 'ISOLATED', 'FAILED', 'FAULT', 'UNTRUSTED', 'LEAK_SUSPECTED', 'REMOVED', 'OFF_TASK / NO_PROGRESS']);
const motionMetrics = ['motion_delta', 'position_delta', 'reel_rotation'];

/** Pure semantic runtime owned by the existing OntologyStore. No renderer or hardware I/O. */
export class WorldIntelligence {
  readonly state: WorldState;
  private serial = 0;
  private evidenceSince = 0;
  private readonly zeroWindows = new Map<string, { start: number; last: number; ids: string[] }>();
  constructor(objects: readonly OntologyObject[], relations: readonly OntologyRelation[], now = Date.now()) {
    this.state = { now, revision: 0, assets: {}, tasks: {}, facilities: {}, powerNodes: {}, routes: {},
      resources: {}, resourceSites: {}, robotResources: {}, observations: [], discrepancies: [], events: [],
      relations: structuredClone([...relations]), trustSources: {}, networkPaths: {}, environmentEvents: {},
      missionStatus: { state: 'NOMINAL', holdReasons: [], navigationSource: null, recommendation: 'Await independent observations.' } };
    for (const object of objects) this.register(object);
    for (const id of Object.keys(this.state.assets)) this.state.trustSources[id] = {
      id, role: id === 'GO2-01' ? 'observer' : 'reporter', independenceGroup: id,
      trustScore: id === 'GO2-01' ? .94 : .8, availability: true, state: 'AVAILABLE' };
  }
  register(object: OntologyObject): void {
    const catalog = ['Humanoid', 'Go2', 'Rover', 'Excavator', 'CableRover'].includes(object.type) ? this.state.assets
      : object.type === 'Task' ? this.state.tasks : object.type === 'PowerNode' ? this.state.powerNodes
        : object.type === 'Route' ? this.state.routes : ['Habitat', 'Airlock', 'CableRun', 'Facility'].includes(object.type) ? this.state.facilities : null;
    if (!catalog || this.entity(object.id)) return;
    const p = object.properties;
    catalog[object.id] = { id: object.id, assetType: object.type, location: p.position && { ...p.position }, assignedTask: p.currentTask,
      expectedState: p.expectedState ?? p.status, reportedState: p.reportedState ?? 'NO_REPORT', observedState: 'NOT_OBSERVED',
      authoritativeState: p.status, authoritySource: 'MISSION_PLAN', provenance: 'PLAN', batteryOrPower: p.battery,
      health: p.health ?? 'UNKNOWN', motionState: 'UNKNOWN', blockedBy: [], available: true,
      dependencies: this.state.relations.filter(e => e.from === object.id && ['dependsOn', 'requires'].includes(e.type)).map(e => e.to) };
  }
  entities(): AssetState[] { return Object.values({ ...this.state.assets, ...this.state.tasks, ...this.state.facilities, ...this.state.powerNodes, ...this.state.routes }); }
  entity(id: string): AssetState | undefined {
    for (const catalog of [this.state.assets, this.state.tasks, this.state.facilities, this.state.powerNodes, this.state.routes]) if (Object.hasOwn(catalog, id)) return catalog[id];
    return undefined;
  }
  event(rule: string, target: string, reason: string, provenance: Provenance, evidenceIds: string[] = [], from?: string, to?: string): void {
    this.state.events.push({ id: `Semantic-${++this.serial}`, timestamp: this.state.now, rule, target, reason, provenance, evidenceIds: [...evidenceIds], from, to });
    this.state.revision++;
  }
  setState(asset: AssetState, next: string, rule: string, reason: string, provenance: Provenance, evidenceIds: string[] = [], source = rule): void {
    if (asset.authoritativeState === next && asset.authoritySource === source && asset.provenance === provenance) return;
    if (stopped.has(asset.authoritativeState) && !stopped.has(next) && rule !== 'operator_revalidation') {
      this.event('response_required', asset.id, `Fresh evidence suggests ${next}; operator revalidation must release ${asset.authoritativeState}.`, provenance, evidenceIds); return;
    }
    const previous = asset.authoritativeState;
    asset.authoritativeState = next; asset.authoritySource = source; asset.provenance = provenance;
    this.event(rule, asset.id, reason, provenance, evidenceIds, previous, next);
  }
  report(id: string, state: string, provenance: Provenance = 'LIVE', now = Date.now()): void {
    const a = this.entity(id); if (!a) throw new Error('unknown_report_target');
    if (typeof state !== 'string' || !state.length || state.length > 128) throw new Error('invalid_report_state');
    this.state.now = now; a.reportedState = state; a.reportedSource = id; a.reportedProvenance = provenance; a.lastReportedAt = now;
    this.event('asset_report', id, `Self-report ${state}; independent evidence required for authority.`, provenance);
  }
  ingest(raw: unknown, now = Date.now()): Observation {
    const o = normalizeObservation(raw, now), a = this.entity(o.target);
    if (!a || !a.available) throw new Error('unknown_or_removed_observation_target');
    if (!this.state.trustSources[o.source]) throw new Error('unregistered_observation_source');
    const duplicate = this.state.observations.find(item => item.id === o.id);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(o)) throw new Error('observation_id_reused');
      return duplicate;
    }
    const prior = this.state.observations.findLast(item => item.source === o.source && item.target === o.target && item.metric === o.metric && item.provenance === o.provenance);
    if (prior && prior.timestamp >= o.timestamp) throw new Error('out_of_order_observation');
    this.state.now = now; this.state.observations.push(o);
    this.event('observation_received', a.id, `${o.source}: ${o.metric} = ${JSON.stringify(o.value)}; confidence ${o.confidence}`, o.provenance, [o.id]);
    if (!this.eligible(o) || (o.metric !== 'reported_location' && !this.isBestEvidence(o))) {
      this.event('evidence_excluded', a.id, 'Untrusted, dependent, low-confidence, or simulated evidence superseded by live evidence.', o.provenance, [o.id]);
      return o;
    }
    if (o.metric !== 'reported_location') {
      a.lastObservedAt = o.timestamp; a.observationConfidence = o.confidence;
      a.observedSource = o.source; a.observedProvenance = o.provenance;
    }
    if (motionMetrics.includes(o.metric)) {
      const key = `${o.provenance}:${o.source}:${o.target}:${o.metric}`;
      if (Math.abs(Number(o.value)) <= .001) {
        const window = this.zeroWindows.get(key);
        this.zeroWindows.set(key, window && o.timestamp - window.last <= EVIDENCE_FRESH_MS
          ? { start: window.start, last: o.timestamp, ids: [...window.ids, o.id] } : { start: o.timestamp, last: o.timestamp, ids: [o.id] });
        a.motionState = 'STATIC';
      } else {
        for (const k of this.zeroWindows.keys()) if (k.startsWith(`${o.provenance}:${o.source}:${o.target}:`)) this.zeroWindows.delete(k);
        a.motionState = 'MOVING';
      }
    }
    if (o.metric === 'state' || o.metric === 'motion_state') {
      a.observedState = String(o.value);
      const active = ['ACTIVE', 'DEPLOYING', 'WORKING', 'MOVING'];
      const materialConflict = ![a.expectedState, a.reportedState].includes(String(o.value)) &&
        !(active.includes(String(o.value)) && [a.expectedState, a.reportedState].some(s => active.includes(s)));
      if (materialConflict) this.discrepancy(a, 'state_conflict', o, 'Expected/reported state contradicts independent observation.', 'Inspect and reconcile the task before resuming.');
      this.setState(a, String(o.value), 'state_reconciliation', 'Trusted independent observation selected.', o.provenance, [o.id], o.source);
    }
    this.reconcileObservation(o, a);
    this.tick(now);
    return o;
  }
  private reconcileObservation(o: Observation, a: AssetState): void {
    if (o.metric === 'pressure_slope' || o.metric === 'seal_intact') this.state.environmentEvents[`${a.id}:${o.metric}`] = { id: `${a.id}:${o.metric}`, state: String(o.value), observedAt: o.timestamp, provenance: o.provenance };
    if (o.metric === 'reported_location' && isPosition(o.value)) a.reportedLocation = { ...o.value };
    if (o.metric === 'physical_location' && isPosition(o.value)) a.observedLocation = { ...o.value };
    const physical = this.state.observations.findLast(v => v.target === a.id && v.metric === 'physical_location' && this.eligible(v) && this.state.now - v.timestamp <= EVIDENCE_FRESH_MS);
    if (physical && ['reported_location', 'physical_location'].includes(o.metric) && a.reportedLocation && a.observedLocation) {
      const p = a.reportedLocation, q = a.observedLocation;
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > .75) {
        a.observedState = 'LOCATION_MISMATCH';
        this.discrepancy(a, 'location_mismatch', physical, 'Reported location is unsafe for route planning.', 'Replan from fresh observed geometry.');
        this.setState(a, 'HOLD', 'location_mismatch', 'Trusted physical location contradicts reported location by more than 0.75 world units.', physical.provenance, [physical.id, o.id], physical.source);
        for (const route of Object.values(this.state.routes)) if (this.state.relations.some(e => e.from === a.id && e.to === route.id && ['routesThrough', 'blocks'].includes(e.type))) {
          this.setState(route, 'AT_RISK', 'location_mismatch', `Route assumptions invalidated by ${a.id}.`, o.provenance, [o.id]);
          if (!route.blockedBy.includes(a.id)) route.blockedBy.push(a.id);
        }
      }
    }
    if (a.assetType === 'Airlock' && a.reportedState === 'SEALED' &&
      (o.metric === 'seal_intact' && o.value === false || o.metric === 'pressure_slope' && Math.abs(Number(o.value)) > .05)) {
      a.observedState = 'LEAK_SUSPECTED';
      this.discrepancy(a, 'airlock_leak_suspected', o, 'Pressure boundary cannot be relied on.', 'Hold entry; independently inspect seal and pressure.');
      this.setState(a, 'LEAK_SUSPECTED', 'airlock_leak_suspected', 'SEALED report contradicted by local seal/pressure evidence.', o.provenance, [o.id], o.source);
    }
    if (o.metric === 'navigation_safe') this.arbitrateNavigation();
  }
  configureTrust(source: TrustSource, provenance: Provenance = 'OPERATOR'): void {
    if (['__proto__', 'constructor', 'prototype'].includes(source.id)) throw new Error('invalid_source_id');
    if (!source.id || !source.independenceGroup || !Number.isFinite(source.trustScore) || source.trustScore < 0 || source.trustScore > 1 || typeof source.availability !== 'boolean' || !['observer', 'reporter', 'navigation'].includes(source.role)) throw new Error('invalid_trust_source');
    this.state.trustSources[source.id] = { ...source, state: !source.availability ? 'UNAVAILABLE' : source.trustScore < TRUST_THRESHOLD ? 'UNTRUSTED' : 'AVAILABLE' };
    this.event('trust_source_changed', source.id, `Trust ${source.trustScore}; available ${source.availability}.`, provenance);
    // Revocation removes authority immediately; no self-report is used as fallback.
    for (const a of this.entities()) if (a.authoritySource === source.id && (!source.availability || source.trustScore < TRUST_THRESHOLD)) {
      const previousGroup = source.independenceGroup;
      const fallback = this.state.observations.filter(o => o.target === a.id && o.metric === 'state' && this.state.now - o.timestamp <= EVIDENCE_FRESH_MS && this.eligible(o) && this.state.trustSources[o.source].independenceGroup !== previousGroup)
        .sort((a, b) => this.state.trustSources[b.source].trustScore - this.state.trustSources[a.source].trustScore || b.timestamp - a.timestamp)[0];
      this.setState(a, fallback ? String(fallback.value) : 'HOLD', 'source_untrusted', fallback ? `Independent fallback ${fallback.source} selected.` : 'Authority revoked; no fresh independent fallback.', fallback?.provenance ?? provenance, fallback ? [fallback.id] : [], fallback?.source ?? 'source_untrusted');
      if (fallback) { a.observedState = String(fallback.value); a.observationConfidence = fallback.confidence; a.observedSource = fallback.source; a.observedProvenance = fallback.provenance; a.lastObservedAt = fallback.timestamp; }
    }
    this.arbitrateNavigation();
  }
  configurePath(path: NetworkPath, provenance: Provenance = 'OPERATOR'): void {
    if (['__proto__', 'constructor', 'prototype'].includes(path.id)) throw new Error('invalid_path_id');
    if (!path.id || !Number.isFinite(path.trust) || path.trust < 0 || path.trust > 1 || !['UP', 'DOWN'].includes(path.linkState)) throw new Error('invalid_network_path');
    this.state.networkPaths[path.id] = { ...path, isolationState: path.trust < TRUST_THRESHOLD || path.linkState !== 'UP' ? 'ISOLATED' : 'CONNECTED' };
    for (const p of Object.values(this.state.networkPaths)) if (p.isolationState === 'ISOLATED') {
      p.alternate = Object.values(this.state.networkPaths).filter(n => n.id !== p.id && n.linkState === 'UP' && n.trust >= TRUST_THRESHOLD).sort((a, b) => b.trust - a.trust)[0]?.id;
    }
    const selected = this.state.networkPaths[path.id];
    this.event('network_path_untrusted', path.id, `${selected.isolationState}; trusted alternate ${selected.alternate ?? 'none'}. Recommendation only; no network configuration changed.`, provenance);
  }
  private arbitrateNavigation(): void {
    const nav = this.state.observations.filter(o => o.metric === 'navigation_safe');
    if (!nav.length) return; // No live navigation is claimed or held merely because demo seed has no sensors.
    const previous = this.state.missionStatus.navigationSource;
    const latest = new Map<string, Observation>();
    for (const o of nav) if (this.eligible(o) && this.state.now - o.timestamp <= EVIDENCE_FRESH_MS) latest.set(o.source, o);
    const ranked = [...latest.values()].sort((a, b) => this.state.trustSources[b.source].trustScore - this.state.trustSources[a.source].trustScore || b.timestamp - a.timestamp);
    const chosen = ranked[0];
    this.state.missionStatus.navigationSource = chosen?.source ?? null;
    for (const s of Object.values(this.state.trustSources).filter(s => s.role === 'navigation')) s.state = !s.availability ? 'UNAVAILABLE' : s.trustScore < TRUST_THRESHOLD ? 'UNTRUSTED' : s.id === chosen?.source ? 'AUTHORITATIVE' : ranked.some(o => o.source === s.id && this.state.trustSources[o.source].independenceGroup !== this.state.trustSources[chosen!.source].independenceGroup) ? 'FALLBACK' : 'AVAILABLE';
    if (previous !== (chosen?.source ?? null)) this.event('source_untrusted', 'NAVIGATION', `Independent navigation authority: ${chosen?.source ?? 'none'}.`, chosen?.provenance ?? nav.at(-1)!.provenance, chosen ? [chosen.id] : []);
    if (!chosen || chosen.value !== true) this.hold(!chosen ? 'Navigation observations stale or untrusted' : `Unsafe navigation reported by ${chosen.source}`, chosen?.provenance ?? nav.at(-1)!.provenance, chosen ? [chosen.id] : []);
  }
  updateResource(id: string, inventory: number, requiredSupply: number, provenance: Provenance = 'LIVE'): void {
    const resource = this.state.resources[id];
    if (!resource || ![inventory, requiredSupply].every(n => Number.isFinite(n) && n >= 0)) throw new Error('invalid_resource_update');
    resource.inventory = inventory; resource.requiredSupply = requiredSupply; resource.provenance = provenance;
    this.evaluateResources();
  }
  updateRobotResource(robot: RobotResourceState, provenance: Provenance): void {
    if (!this.state.assets[robot.robotId] || !['extraction', 'transport'].includes(robot.role) ||
      ![robot.collectedAmount, robot.carryingAmount, robot.capacity, robot.collectionRate, robot.discoveryRate, robot.battery].every(v => Number.isFinite(v) && v >= 0) ||
      robot.battery > 1 || robot.carryingAmount > robot.capacity || robot.assignedResource && !this.state.resources[robot.assignedResource] ||
      robot.currentLocation && !isPosition(robot.currentLocation)) throw new Error('invalid_robot_resource_state');
    this.state.robotResources[robot.robotId] = structuredClone(robot);
    this.event('resource_collection_update', robot.robotId, `Collecting ${robot.assignedResource ?? 'unassigned'}: collection ${robot.collectionRate} kg/min; discovery ${robot.discoveryRate} characterized sites/hour.`, provenance);
    this.evaluateResources();
  }
  updateResourceSite(site: ResourceSite): void {
    if (['__proto__', 'constructor', 'prototype'].includes(site.id)) throw new Error('invalid_site_id');
    if (!site.id || !this.state.resources[site.resourceType] || !isPosition(site.location) ||
      ![site.estimatedRemaining, site.requiredSupply, site.extractionDifficulty, site.distanceToProcessor, site.confidence].every(v => Number.isFinite(v) && v >= 0) || site.confidence > 1 || site.extractionDifficulty > 1 || !['DEMO', 'LIVE'].includes(site.provenance)) throw new Error('invalid_resource_site');
    this.state.resourceSites[site.id] = structuredClone(site);
    this.event('resource_site_update', site.id, `Known supply ${site.estimatedRemaining} kg; confidence ${site.confidence}.`, site.provenance);
    this.evaluateResources();
  }
  evaluateResources(): void {
    for (const r of Object.values(this.state.resources)) {
      const old = JSON.stringify(r);
      r.shortage = Math.max(0, r.requiredSupply - r.inventory); r.priority = r.shortage ? 'HIGH' : 'NORMAL';
      const siteScore = (id: string) => { const s = this.state.resourceSites[id]; return Math.min(s.estimatedRemaining, r.shortage || r.requiredSupply) * s.confidence / ((1 + s.extractionDifficulty) * (1 + s.distanceToProcessor)); };
      r.rankedSites = Object.values(this.state.resourceSites).filter(s => s.resourceType === r.id && s.estimatedRemaining > 0 && s.confidence >= .5).map(s => s.id).sort((a, b) => siteScore(b) - siteScore(a));
      r.candidateRobots = Object.values(this.state.robotResources).filter(robot => {
        const a = this.entity(robot.robotId); return a?.available && this.canAnimate(a.id) && a.health === 'NOMINAL' &&
          ['STAGED', 'STANDBY', 'IDLE'].includes(a.authoritativeState) && ['AVAILABLE', 'IDLE'].includes(robot.taskState) && !a.blockedBy.length && robot.battery > .2 && robot.capacity > robot.carryingAmount;
      }).map(robot => robot.robotId);
      r.recommendation = r.shortage ? `${r.shortage} ${r.unit} short. Survey/extract at ${r.rankedSites[0] ?? 'no sufficiently known site'}; redirect eligible capacity: ${r.candidateRobots.join(', ') || 'none'}. Operator approval required for physical execution.` : 'Required supply covered.';
      if (old !== JSON.stringify(r)) this.event('low_resource', r.id, r.recommendation, r.provenance);
      if (r.shortage) for (const id of this.downstream(r.id)) {
        const a = this.entity(id); if (!a) continue;
        if (!a.blockedBy.includes(r.id)) a.blockedBy.push(r.id);
        if (!stopped.has(a.authoritativeState) && a.authoritativeState !== 'AT_RISK') this.setState(a, 'AT_RISK', 'low_resource', `${r.id} shortage: ${r.shortage} ${r.unit}.`, r.provenance);
      }
      else for (const a of this.entities()) if (a.blockedBy.includes(r.id)) {
        a.blockedBy = a.blockedBy.filter(id => id !== r.id);
        if (!a.blockedBy.length && a.authoritativeState === 'AT_RISK' && !this.state.assets[a.id]) this.setState(a, a.expectedState, 'resource_recovered', `${r.id} supply requirement covered.`, r.provenance);
      }
    }
  }
  eligible(o: Observation): boolean {
    const s = this.state.trustSources[o.source];
    return !!s && s.availability && s.trustScore >= TRUST_THRESHOLD && o.confidence >= .75 &&
      (o.metric === 'reported_location' || s.independenceGroup !== o.target) && o.timestamp >= this.evidenceSince &&
      !(o.provenance === 'DEMO' && this.state.observations.some(v => v.target === o.target && v.provenance === 'LIVE'));
  }
  private isBestEvidence(o: Observation): boolean {
    const ranked = this.state.observations.filter(v => v.target === o.target && v.metric === o.metric && this.eligible(v) && this.state.now - v.timestamp <= EVIDENCE_FRESH_MS)
      .sort((a, b) => this.state.trustSources[b.source].trustScore - this.state.trustSources[a.source].trustScore || b.timestamp - a.timestamp);
    return ranked[0]?.id === o.id;
  }
  invalidateEvidence(reason: string, now = Date.now()): void {
    this.state.now = now; this.evidenceSince = now; this.zeroWindows.clear();
    const activeEvidence = this.state.observations.length > 0;
    this.event('scene_evidence_invalidated', 'LUNAR-OPS-01', reason, 'PLAN');
    if (activeEvidence) this.hold(reason, 'OPERATOR');
  }
  resolveDiscrepancy(id: string, reason: string): void {
    const d = this.state.discrepancies.find(d => d.id === id && !d.resolved);
    if (!d || !reason.trim()) throw new Error('open_discrepancy_and_resolution_required');
    d.resolved = true; d.resolvedAt = this.state.now;
    this.event('discrepancy_resolved', d.target, reason + ' Motion holds remain latched.', 'OPERATOR', d.evidenceIds);
  }
  tick(now = Date.now()): boolean {
    this.state.now = now; const revision = this.state.revision;
    for (const a of Object.values(this.state.assets)) {
      if (a.reportedState !== 'ACTIVE') continue;
      const metrics = a.assetType === 'CableRover' ? motionMetrics : ['motion_delta'];
      for (const source of Object.keys(this.state.trustSources)) for (const provenance of ['LIVE', 'DEMO'] as const) {
        const windows = metrics.map(m => this.zeroWindows.get(`${provenance}:${source}:${a.id}:${m}`));
        if (windows.some(w => !w || now - w.last > EVIDENCE_FRESH_MS || w.last - w.start < STALL_THRESHOLD_MS)) continue;
        const evidence = this.state.observations.findLast(o => o.source === source && o.target === a.id && o.provenance === provenance);
        if (!evidence || !this.eligible(evidence)) continue;
        const ids = windows.flatMap(w => w!.ids);
        a.observedState = 'STALLED';
        this.discrepancy(a, 'asset_stall', evidence, 'Cable deployment and dependent power/facilities at risk.', 'Hold this asset; request independent inspection, service or reassignment.', ids);
        this.setState(a, 'STALLED', 'asset_stall', `ACTIVE report contradicted by ${metrics.join(', ')} = 0 for at least ${STALL_THRESHOLD_MS} ms.`, provenance, ids, source);
      }
    }
    this.arbitrateNavigation();
    this.evaluateResources();
    this.propagate();
    return revision !== this.state.revision;
  }
  raiseIssue(id: string, reason: string): void {
    const a = this.entity(id); if (!a) throw new Error('unknown_issue_target');
    this.discrepancy(a, 'operator_issue', { id: '', source: 'MISSION-CONTROL', confidence: 0, provenance: 'OPERATOR' }, reason, 'Request independent inspection; no physical observation has been inferred.', []);
  }
  discrepancy(a: AssetState, rule: string, o: Pick<Observation, 'id' | 'source' | 'confidence'> & { provenance: Provenance }, consequence: string, action: string, evidenceIds = [o.id]): void {
    if (this.state.discrepancies.some(d => d.target === a.id && d.rule === rule && !d.resolved)) return;
    const d = { id: `Discrepancy-${++this.serial}`, target: a.id, rule, expectedState: a.expectedState, reportedState: a.reportedState,
      observedState: a.observedState, observationSource: o.source, observationConfidence: o.confidence,
      severity: 'AMBER' as const, missionConsequence: consequence, recommendedAction: action, createdAt: this.state.now,
      resolved: false, evidenceIds: [...evidenceIds], provenance: o.provenance };
    this.state.discrepancies.push(d); this.event(rule, a.id, `${consequence} ${action}`, o.provenance, evidenceIds);
  }
  downstream(id: string): string[] {
    const visited = new Set([id]), queue = [id];
    for (let i = 0; i < queue.length; i++) for (const e of this.state.relations) {
      const target = e.from === queue[i] && ['assignedTo', 'supplies', 'blocks'].includes(e.type) ? e.to
        : e.to === queue[i] && ['dependsOn', 'requires'].includes(e.type) ? e.from : null;
      if (target && !visited.has(target)) { visited.add(target); queue.push(target); }
    }
    return queue.slice(1);
  }
  propagate(): void {
    for (const source of this.entities().filter(a => stopped.has(a.authoritativeState))) {
      for (const id of this.downstream(source.id)) {
        const target = this.entity(id); if (!target) continue;
        if (!target.blockedBy.includes(source.id)) target.blockedBy.push(source.id);
        if (!stopped.has(target.authoritativeState) && target.authoritativeState !== 'AT_RISK') this.setState(target, 'AT_RISK', 'blocked_dependency', `Depends on ${source.id} (${source.authoritativeState}).`, source.provenance);
      }
    }
    const mission = this.state.missionStatus;
    const next = mission.holdReasons.length ? 'HOLD' : this.state.discrepancies.some(d => !d.resolved) || this.entities().some(a => a.authoritativeState === 'AT_RISK') ? 'AT_RISK' : 'NOMINAL';
    if (mission.state !== next) { const prev = mission.state; mission.state = next; this.event('mission_status', 'LUNAR-OPS-01', 'Derived from open discrepancies, dependencies and latched holds.', 'PLAN', [], prev, next); }
  }
  canAnimate(id: string): boolean {
    const a = this.entity(id); return !a || a.available && !stopped.has(a.authoritativeState) && !this.state.missionStatus.holdReasons.length;
  }
  hold(reason: string, provenance: Provenance = 'OPERATOR', evidenceIds: string[] = []): void {
    if (this.state.missionStatus.holdReasons.includes(reason)) return;
    this.state.missionStatus.holdReasons.push(reason);
    for (const a of Object.values(this.state.assets)) if (!stopped.has(a.authoritativeState)) this.setState(a, 'HOLD', 'fleet_hold', reason, provenance, evidenceIds);
    this.event('fleet_hold', 'LUNAR-OPS-01', reason + ' Operator revalidation required; no automatic resume.', provenance, evidenceIds);
    this.propagate();
  }
}

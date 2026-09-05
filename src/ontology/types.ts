export const ONTOLOGY_OBJECT_TYPES = [
  'Humanoid',
  'Go2',
  'Rover',
  'Excavator',
  'CableRover',
  'Task',
  'WorkZone',
  'Route',
  'PowerNode',
  'CableRun',
  'Habitat',
  'Airlock',
  'CargoContainer',
  'Observation',
  'TelemetryReport',
  'Alert',
] as const;

export type OntologyObjectType = (typeof ONTOLOGY_OBJECT_TYPES)[number];

export const ONTOLOGY_RELATION_TYPES = [
  'assignedTo',
  'locatedAt',
  'dependsOn',
  'supplies',
  'blocks',
  'chargesAt',
  'observes',
  'routesThrough',
] as const;

export type OntologyRelationType =
  (typeof ONTOLOGY_RELATION_TYPES)[number];

export const ONTOLOGY_CAPABILITIES = [
  'Inspectable',
  'Taskable',
  'MobileAsset',
  'PowerConsumer',
] as const;

export type OntologyCapability =
  (typeof ONTOLOGY_CAPABILITIES)[number];

export const ONTOLOGY_ACTION_TYPES = [
  'requestPhysicalInspection',
  'reassignTask',
  'holdFleet',
  'rerouteAsset',
  'isolateAsset',
  'resumeAsset',
] as const;

export type OntologyActionType =
  (typeof ONTOLOGY_ACTION_TYPES)[number];

export interface OntologyPosition {
  x: number;
  y: number;
  z: number;
}

export interface OntologyFootprint {
  width: number;
  depth: number;
}

export interface OntologyProperties {
  status: string;
  battery?: number;
  health?: string;
  position?: OntologyPosition;
  footprint?: OntologyFootprint;
  taskProgress?: number;
  expectedState?: string;
  reportedState?: string;
  observedState?: string;
  observedBehavior?: string;
  lastObservation?: string;
  confidence?: number;
  currentTask?: string;
  role?: string;
  verificationStatus?: 'NOT_REQUIRED' | 'REQUIRED' | 'REQUESTED' | 'CONFIRMED';
  skills?: readonly string[];
  source?: string;
  subjectId?: string;
  severity?: 'INFO' | 'AMBER' | 'RED';
  rehearsalState?: string;
  rehearsalAction?: string;
}

export interface OntologyObject<
  Type extends OntologyObjectType = OntologyObjectType,
> {
  id: string;
  type: Type;
  label: string;
  description?: string;
  capabilities: readonly OntologyCapability[];
  properties: OntologyProperties;
}

export interface OntologyRelation {
  id: string;
  from: string;
  to: string;
  type: OntologyRelationType;
  status?: string;
}

export interface MissionContext {
  id: string;
  label: string;
  scene: string;
  phase: string;
  worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export interface OntologySeed {
  mission: MissionContext;
  objects: readonly OntologyObject[];
  relations: readonly OntologyRelation[];
  selectedEntityId: string;
  discrepancyIds: readonly string[];
  trace: readonly OntologyTraceEntry[];
}

export interface ObservationInput {
  id?: string;
  observerId: string;
  subjectId: string;
  state: string;
  behavior?: string;
  confidence: number;
  note: string;
  timestamp?: string;
}

export interface TelemetryUpdate {
  source?: string;
  confidence?: number;
}

export interface OntologyActionRequest {
  type: OntologyActionType;
  targetId: string;
  actorId?: string;
  parameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface OntologyActionRecord {
  id: string;
  type: OntologyActionType;
  targetId: string;
  actorId: string;
  status: 'REQUESTED' | 'EXECUTED' | 'FAILED';
  summary: string;
  timestamp: string;
  parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface OntologyTraceEntry {
  id: string;
  kind: 'detection' | 'observation' | 'decision' | 'action';
  label: string;
  timestamp: string;
  status: 'complete' | 'active' | 'pending';
}

export interface EvidenceState {
  state: string;
  detail: string;
  source: string;
  confidence?: number;
}

export interface EvidenceComparison {
  expected: EvidenceState;
  reported: EvidenceState;
  observed: EvidenceState;
  result: 'ALIGNED' | 'DISCREPANCY' | 'UNVERIFIED';
}

export interface ImpactEntry {
  objectId: string;
  label: string;
  state: string;
  relation?: OntologyRelationType;
}

export interface DerivedIntelligence {
  discrepancy: boolean;
  taskAtRisk: readonly string[];
  downstreamImpact: readonly ImpactEntry[];
  replacementCandidates: readonly string[];
  verificationRequired: boolean;
}

export interface SelectedAnalysis {
  entityId: string;
  evidence: EvidenceComparison;
  intelligence: DerivedIntelligence;
}

export interface FleetSummary {
  nominal: number;
  total: number;
  state: 'NOMINAL' | 'ATTENTION' | 'CRITICAL';
}

export interface OntologySnapshot {
  revision: number;
  mission: MissionContext;
  objects: readonly OntologyObject[];
  relations: readonly OntologyRelation[];
  selectedEntityId: string;
  discrepancyIds: readonly string[];
  actions: readonly OntologyActionRecord[];
  trace: readonly OntologyTraceEntry[];
  analysis: SelectedAnalysis;
  fleet: FleetSummary;
}

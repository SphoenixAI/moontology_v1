import type { OntologyPosition, OntologyRelation } from './types';

export type Provenance = 'LIVE' | 'DEMO' | 'PLAN' | 'OPERATOR';
export type ObservationMetric = 'motion_delta' | 'position_delta' | 'reel_rotation' | 'motion_state' | 'state' | 'physical_location' | 'reported_location' | 'pressure_slope' | 'seal_intact' | 'navigation_safe';
export interface Observation {
  id: string; source: string; target: string; timestamp: number;
  metric: ObservationMetric; value: number | string | boolean | OntologyPosition;
  location?: OntologyPosition; confidence: number; provenance: 'LIVE' | 'DEMO';
  frame?: 'three_world'; unit?: 'world_units' | 'radians' | 'kPa/s';
}
export interface AssetState {
  id: string; assetType: string; location?: OntologyPosition; observedLocation?: OntologyPosition;
  reportedLocation?: OntologyPosition; assignedTask?: string;
  expectedState: string; reportedState: string; observedState: string; authoritativeState: string;
  reportedSource?: string; reportedProvenance?: Provenance; lastReportedAt?: number;
  observedSource?: string; observedProvenance?: Provenance;
  authoritySource: string; provenance: Provenance; batteryOrPower?: number; health: string;
  motionState: string; lastObservedAt?: number; observationConfidence?: number;
  blockedBy: string[]; dependencies: string[]; available: boolean;
}
export interface Discrepancy {
  id: string; rule: string; target: string; expectedState: string; reportedState: string;
  observedState: string; observationSource: string; observationConfidence: number;
  severity: 'AMBER' | 'RED'; missionConsequence: string; recommendedAction: string;
  createdAt: number; resolved: boolean; resolvedAt?: number; evidenceIds: string[]; provenance: Provenance;
}
export interface SemanticEvent {
  id: string; timestamp: number; rule: string; target: string; reason: string;
  from?: string; to?: string; evidenceIds: string[]; provenance: Provenance;
}
export interface ResourceState {
  id: string; inventory: number; requiredSupply: number; unit: string; priority: 'NORMAL' | 'HIGH';
  shortage: number; recommendation: string; candidateRobots: string[]; rankedSites: string[]; provenance: Provenance;
}
export interface ResourceSite {
  id: string; location: OntologyPosition; resourceType: string; estimatedRemaining: number;
  requiredSupply: number; extractionDifficulty: number; confidence: number; distanceToProcessor: number; provenance: Provenance;
}
export interface RobotResourceState {
  robotId: string; role: 'extraction' | 'transport'; assignedResource?: string;
  collectedAmount: number; carryingAmount: number; capacity: number; collectionRate: number; discoveryRate: number;
  currentLocation?: OntologyPosition; destination?: string; battery: number; taskState: string; eta: number | null;
}
export interface TrustSource {
  id: string; role: 'observer' | 'navigation' | 'reporter'; independenceGroup: string;
  trustScore: number; availability: boolean; state: 'AVAILABLE' | 'UNTRUSTED' | 'AUTHORITATIVE' | 'FALLBACK' | 'UNAVAILABLE';
}
export interface NetworkPath { id: string; trust: number; linkState: 'UP' | 'DOWN'; isolationState: 'CONNECTED' | 'ISOLATED'; alternate?: string }
export interface WorldState {
  now: number; revision: number;
  historyCounts?: { events: number; observations: number; discrepancies: number };
  assets: Record<string, AssetState>; tasks: Record<string, AssetState>; facilities: Record<string, AssetState>;
  powerNodes: Record<string, AssetState>; routes: Record<string, AssetState>;
  resources: Record<string, ResourceState>; resourceSites: Record<string, ResourceSite>; robotResources: Record<string, RobotResourceState>;
  observations: Observation[]; discrepancies: Discrepancy[]; events: SemanticEvent[]; relations: OntologyRelation[];
  trustSources: Record<string, TrustSource>; networkPaths: Record<string, NetworkPath>;
  environmentEvents: Record<string, { id: string; state: string; observedAt: number; provenance: Provenance }>;
  missionStatus: { state: 'NOMINAL' | 'AT_RISK' | 'HOLD'; holdReasons: string[]; navigationSource: string | null; recommendation: string };
}

import type { WorldIntelligence } from './WorldIntelligence';

/** Planning fixtures, not claims about unlabeled splat geometry or lunar deposits. */
export function seedOperationalIntelligence(engine: WorldIntelligence): void {
  const w = engine.state;
  for (const [id, inventory, requiredSupply] of [
    ['PolarWaterVolatiles', 70, 60], ['OxygenFeedstock', 118, 150], ['AluminumFeedstock', 45, 40],
    ['SiliconFeedstock', 32, 30], ['ConstructionRegolith', 600, 500],
  ] as const) w.resources[id] = { id, inventory, requiredSupply, unit: 'kg', priority: 'NORMAL', shortage: 0,
    recommendation: '', candidateRobots: [], rankedSites: [], provenance: 'DEMO' };
  for (const [id, resourceType, supply, difficulty, confidence, distance] of [
    ['Highland-A', 'OxygenFeedstock', 240, .4, .86, 12], ['PSR-Edge-C', 'PolarWaterVolatiles', 300, .8, .72, 25],
    ['Highland-B', 'OxygenFeedstock', 600, .8, .65, 24], ['Regolith-A', 'ConstructionRegolith', 1200, .2, .92, 8],
  ] as const) w.resourceSites[id] = { id, resourceType, location: { x: 0, y: 0, z: 0 }, estimatedRemaining: supply,
    requiredSupply: w.resources[resourceType].requiredSupply, extractionDifficulty: difficulty, confidence,
    distanceToProcessor: distance, provenance: 'DEMO' };
  for (const [id, role, capacity] of [['EXC-01', 'extraction', 120], ['EXC-02', 'extraction', 120], ['LOGISTICS-ROVER-01', 'transport', 180], ['ROVER-01', 'transport', 90]] as const)
    w.robotResources[id] = { robotId: id, role, collectedAmount: 0, carryingAmount: 0, capacity,
      collectionRate: 0, discoveryRate: 0, battery: .8, taskState: 'AVAILABLE', eta: null };
  engine.register({ id: 'ISRU-01', type: 'Facility', label: 'ISRU processor (planning)', capabilities: [], properties: { status: 'PLANNED', source: 'DEMO_PLAN' } });
  for (const [from, type, to] of [['ISRU-01', 'requires', 'OxygenFeedstock'], ['ISRU-01', 'dependsOn', 'PowerNode-B'], ['ISRU-01', 'processes', 'ConstructionRegolith'], ['ROVER-01', 'carries', 'AluminumFeedstock']] as const)
    w.relations.push({ id: `${from}:${type}:${to}`, from, type, to });
  for (const [id, trust, group] of [['OrbitalPNT', .9, 'orbital'], ['LocalLiDAR', .93, 'lidar'], ['InertialReference', .88, 'inertial'], ['VisualOdometry', .85, 'camera']] as const)
    w.trustSources[id] = { id, role: 'navigation', trustScore: trust, independenceGroup: group, availability: false, state: 'UNAVAILABLE' };
  // No active path is invented. A consumer/operator explicitly registers available paths.
  engine.evaluateResources(); engine.propagate();
}

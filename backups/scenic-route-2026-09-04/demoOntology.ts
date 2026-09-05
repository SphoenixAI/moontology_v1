import type { LevelConfig } from '../levels/types';
import type {
  OntologyObject,
  OntologyPosition,
  OntologyRelation,
  OntologySeed,
} from './types';

const FALLBACK_POSITION: OntologyPosition = { x: 0, y: 0, z: 0 };

const positionFromTuple = (
  tuple: readonly [number, number, number] | undefined,
): OntologyPosition =>
  tuple
    ? { x: tuple[0], y: tuple[1], z: tuple[2] }
    : { ...FALLBACK_POSITION };

const getAssetPosition = (
  level: LevelConfig,
  id: string,
  fallback: OntologyPosition,
): OntologyPosition => {
  const config = level.assets.find((asset) => asset.id === id);
  return config ? positionFromTuple(config.position) : fallback;
};

const humanoid = (
  level: LevelConfig,
  id: string,
  label: string,
  role: string,
  taskId: string | undefined,
  skills: readonly string[],
): OntologyObject<'Humanoid'> => ({
  id,
  type: 'Humanoid',
  label,
  capabilities: ['Inspectable', 'Taskable', 'MobileAsset', 'PowerConsumer'],
  properties: {
    status: 'ACTIVE',
    battery: 82 + Number(id.slice(-1)),
    health: id === 'H05' ? 'WATCH' : 'NOMINAL',
    position: getAssetPosition(level, id, FALLBACK_POSITION),
    expectedState: 'TASK_PROGRESSING',
    reportedState: 'WORKING',
    observedState: id === 'H05' ? 'OFF_TASK' : 'ON_TASK',
    observedBehavior:
      id === 'H05' ? 'REPETITIVE_OFF_TASK_MOTION' : 'EXPECTED_MOTION',
    lastObservation: 'T+00:18:42',
    confidence: id === 'H05' ? 0.64 : 0.91,
    currentTask: taskId,
    role,
    verificationStatus: id === 'H05' ? 'REQUIRED' : 'NOT_REQUIRED',
    skills,
  },
});

const relation = (
  from: string,
  type: OntologyRelation['type'],
  to: string,
  status?: string,
): OntologyRelation => ({
  id: `${from}:${type}:${to}`,
  from,
  to,
  type,
  status,
});

export const createLunarBaseOntologySeed = (
  level: LevelConfig,
): OntologySeed => {
  const go2Position = positionFromTuple(level.go2Agent?.position);

  const objects: OntologyObject[] = [
    humanoid(
      level,
      'H01',
      'Humanoid 01',
      'Regolith Excavation',
      'RegolithExcavation-04',
      ['EXCAVATION', 'SITE_PREP'],
    ),
    humanoid(
      level,
      'H02',
      'Humanoid 02',
      'Power / Cable Inspection',
      'PowerInspection-08',
      ['POWER_INSPECTION', 'CABLE_INSPECTION'],
    ),
    humanoid(
      level,
      'H03',
      'Humanoid 03',
      'Dust Mitigation / Surface Maintenance',
      'DustMitigation-12',
      ['SURFACE_MAINTENANCE', 'DUST_MITIGATION'],
    ),
    humanoid(
      level,
      'H04',
      'Humanoid 04',
      'Logistics Inventory',
      'InventoryAudit-06',
      ['LOGISTICS', 'CABLE_DEPLOYMENT'],
    ),
    humanoid(
      level,
      'H06',
      'Humanoid 06',
      'Emergency Support',
      undefined,
      ['EMERGENCY_SUPPORT'],
    ),
    {
      id: 'GO2-01',
      type: 'Go2',
      label: 'Go2 Physical Observer',
      capabilities: ['Inspectable', 'Taskable', 'MobileAsset', 'PowerConsumer'],
      properties: {
        status: 'STANDBY',
        battery: 91,
        health: 'NOMINAL',
        position: go2Position,
        expectedState: 'AVAILABLE',
        reportedState: 'STANDBY',
        observedState: 'AT_BASE',
        confidence: 0.98,
        role: 'Physical Verification',
        verificationStatus: 'NOT_REQUIRED',
        skills: ['PHYSICAL_INSPECTION', 'MOTION_OBSERVATION'],
      },
    },
    {
      id: 'ROVER-01',
      type: 'Rover',
      label: 'Utility Rover 01',
      capabilities: ['Inspectable', 'Taskable', 'MobileAsset', 'PowerConsumer'],
      properties: {
        status: 'ACTIVE',
        battery: 76,
        health: 'NOMINAL',
        position: { x: -5.8, y: 0, z: 2.4 },
        currentTask: 'RouteSurvey-02',
        role: 'Utility Transport',
      },
    },
    {
      id: 'EXC-01',
      type: 'Excavator',
      label: 'Regolith Excavator',
      capabilities: ['Inspectable', 'Taskable', 'MobileAsset', 'PowerConsumer'],
      properties: {
        status: 'ACTIVE',
        battery: 68,
        health: 'NOMINAL',
        position: getAssetPosition(level, 'EXC-01', {
          x: -4,
          y: 0,
          z: 2,
        }),
        currentTask: 'RegolithExcavation-04',
        role: 'Regolith Handling',
      },
    },
    {
      id: 'CABLE-ROVER-01',
      type: 'CableRover',
      label: 'Cable Rover 01',
      capabilities: ['Inspectable', 'Taskable', 'MobileAsset', 'PowerConsumer'],
      properties: {
        status: 'STAGED',
        battery: 88,
        health: 'NOMINAL',
        position: { x: 5.6, y: 0, z: 1.8 },
        currentTask: 'CableDeployment-17',
        role: 'Cable Feed / Tension',
      },
    },
    {
      id: 'RegolithExcavation-04',
      type: 'Task',
      label: 'Regolith Excavation',
      capabilities: [],
      properties: {
        status: 'IN_PROGRESS',
        taskProgress: 61,
        expectedState: 'PROGRESSING',
      },
    },
    {
      id: 'PowerInspection-08',
      type: 'Task',
      label: 'Power / Cable Inspection',
      capabilities: [],
      properties: {
        status: 'IN_PROGRESS',
        taskProgress: 44,
        expectedState: 'PROGRESSING',
      },
    },
    {
      id: 'DustMitigation-12',
      type: 'Task',
      label: 'Dust Mitigation',
      capabilities: [],
      properties: {
        status: 'IN_PROGRESS',
        taskProgress: 73,
        expectedState: 'PROGRESSING',
      },
    },
    {
      id: 'InventoryAudit-06',
      type: 'Task',
      label: 'Logistics Inventory',
      capabilities: [],
      properties: {
        status: 'IN_PROGRESS',
        taskProgress: 52,
        expectedState: 'PROGRESSING',
      },
    },
    {
      id: 'CableDeployment-17',
      type: 'Task',
      label: 'Cable Deployment 17',
      capabilities: [],
      properties: {
        status: 'AT_RISK',
        taskProgress: 0,
        expectedState: 'PROGRESSING',
        reportedState: 'IN_PROGRESS',
        observedState: 'NO_PROGRESS',
      },
    },
    {
      id: 'RouteSurvey-02',
      type: 'Task',
      label: 'Route Survey 02',
      capabilities: [],
      properties: {
        status: 'IN_PROGRESS',
        taskProgress: 37,
        expectedState: 'PROGRESSING',
      },
    },
    {
      id: 'WorkZone-A',
      type: 'WorkZone',
      label: 'Work Zone A',
      capabilities: ['Inspectable'],
      properties: {
        status: 'ACTIVE',
        position: { x: -5.8, y: 0, z: -2.8 },
        footprint: { width: 5.2, depth: 4.4 },
        role: 'Excavation',
      },
    },
    {
      id: 'WorkZone-B',
      type: 'WorkZone',
      label: 'Work Zone B',
      capabilities: ['Inspectable'],
      properties: {
        status: 'ACTIVE',
        position: { x: 0, y: 0, z: -2.7 },
        footprint: { width: 4.8, depth: 4.2 },
        role: 'Maintenance',
      },
    },
    {
      id: 'WorkZone-C',
      type: 'WorkZone',
      label: 'Work Zone C',
      capabilities: ['Inspectable'],
      properties: {
        status: 'ATTENTION',
        position: { x: 5.8, y: 0, z: -2.7 },
        footprint: { width: 5.2, depth: 4.4 },
        role: 'Power Extension',
      },
    },
    {
      id: 'Route-Alpha',
      type: 'Route',
      label: 'Route Alpha',
      capabilities: ['Inspectable'],
      properties: {
        status: 'OPEN',
        position: { x: 0, y: 0, z: 1.4 },
        footprint: { width: 16, depth: 1.1 },
        role: 'Primary Traverse',
      },
    },
    {
      id: 'PowerNode-B',
      type: 'PowerNode',
      label: 'Power Node B',
      capabilities: ['Inspectable'],
      properties: {
        status: 'CONNECTION_AT_RISK',
        health: 'NOMINAL',
        position: { x: 7.8, y: 0, z: 2.9 },
        role: 'Habitat Distribution',
      },
    },
    {
      id: 'CableRun-17',
      type: 'CableRun',
      label: 'Cable Run 17',
      capabilities: ['Inspectable'],
      properties: {
        status: 'INCOMPLETE',
        taskProgress: 0,
        position: { x: 6.8, y: 0, z: -0.1 },
        role: 'Power Trunk',
      },
    },
    {
      id: 'Habitat-2',
      type: 'Habitat',
      label: 'Habitat 2',
      capabilities: ['Inspectable', 'PowerConsumer'],
      properties: {
        status: 'DEPENDENCY_AFFECTED',
        health: 'NOMINAL',
        position: { x: 8.3, y: 0, z: 6 },
        footprint: { width: 4.3, depth: 2.8 },
        role: 'Crew Habitat',
      },
    },
    {
      id: 'Airlock-2A',
      type: 'Airlock',
      label: 'Airlock 2A',
      capabilities: ['Inspectable', 'PowerConsumer'],
      properties: {
        status: 'NOMINAL',
        health: 'NOMINAL',
        position: { x: 6.5, y: 0, z: 5.1 },
        role: 'Habitat Access',
      },
    },
    {
      id: 'Cargo-07',
      type: 'CargoContainer',
      label: 'Cargo Container 07',
      capabilities: ['Inspectable'],
      properties: {
        status: 'STAGED',
        position: { x: -7.2, y: 0, z: 5.7 },
        role: 'Cable Reels',
      },
    },
    {
      id: 'Telemetry-H05-018',
      type: 'TelemetryReport',
      label: 'H05 Telemetry 018',
      capabilities: [],
      properties: {
        status: 'RECEIVED',
        reportedState: 'WORKING',
        confidence: 0.96,
        source: 'H05',
        subjectId: 'H05',
      },
    },
    {
      id: 'Observation-Scene-018',
      type: 'Observation',
      label: 'Scene Motion Observation',
      capabilities: [],
      properties: {
        status: 'PROVISIONAL',
        observedState: 'OFF_TASK',
        observedBehavior: 'REPETITIVE_OFF_TASK_MOTION',
        confidence: 0.64,
        source: 'SCENE_MOTION',
        subjectId: 'H05',
      },
    },
    {
      id: 'Alert-H05-01',
      type: 'Alert',
      label: 'H05 Task-State Discrepancy',
      capabilities: [],
      properties: {
        status: 'OPEN',
        severity: 'AMBER',
        source: 'ONTOLOGY_RULE',
        subjectId: 'H05',
      },
    },
  ];

  const relations: OntologyRelation[] = [
    relation('H01', 'assignedTo', 'RegolithExcavation-04'),
    relation('H01', 'locatedAt', 'WorkZone-A'),
    relation('H02', 'assignedTo', 'PowerInspection-08'),
    relation('H02', 'locatedAt', 'WorkZone-B'),
    relation('H03', 'assignedTo', 'DustMitigation-12'),
    relation('H03', 'locatedAt', 'WorkZone-B'),
    relation('H04', 'assignedTo', 'InventoryAudit-06'),
    relation('H04', 'locatedAt', 'WorkZone-C'),
    relation('H05', 'assignedTo', 'CableDeployment-17', 'AT_RISK'),
    relation('H05', 'locatedAt', 'WorkZone-C'),
    relation('GO2-01', 'locatedAt', 'WorkZone-B'),
    relation('GO2-01', 'observes', 'H05', 'AVAILABLE'),
    relation('ROVER-01', 'routesThrough', 'Route-Alpha'),
    relation('EXC-01', 'assignedTo', 'RegolithExcavation-04'),
    relation('EXC-01', 'locatedAt', 'WorkZone-A'),
    relation('CABLE-ROVER-01', 'assignedTo', 'CableDeployment-17'),
    relation('CABLE-ROVER-01', 'routesThrough', 'Route-Alpha'),
    relation('CABLE-ROVER-01', 'chargesAt', 'PowerNode-B'),
    relation('CableDeployment-17', 'dependsOn', 'PowerNode-B', 'AT_RISK'),
    relation('CableRun-17', 'dependsOn', 'CableDeployment-17', 'BLOCKED'),
    relation('PowerNode-B', 'supplies', 'Habitat-2', 'AT_RISK'),
    relation('Habitat-2', 'dependsOn', 'PowerNode-B', 'AT_RISK'),
    relation('Airlock-2A', 'dependsOn', 'Habitat-2'),
    relation('Cargo-07', 'locatedAt', 'WorkZone-A'),
  ];

  return {
    mission: {
      id: 'LUNAR-OPS-01',
      label: 'Shackleton Mixed-Robot Base',
      scene: 'World Labs · Level 1',
      phase: 'POWER EXTENSION / SOL 018',
      worldBounds: {
        minX: -11,
        maxX: 11,
        minZ: -7,
        maxZ: 8,
      },
    },
    // Removed actors must not remain as selectable map markers or alerts.
    objects: objects.filter(object => object.id !== 'H05' && object.id !== 'Alert-H05-01'),
    relations: relations.filter(edge => edge.from !== 'H05' && edge.to !== 'H05'),
    selectedEntityId: 'H01',
    discrepancyIds: [],
    trace: [],
  };
};

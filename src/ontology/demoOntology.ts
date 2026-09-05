import type { LevelConfig } from '../levels/types';
import { SCENE_1_STOPS } from '../levels/scene1DemoRoute';
import { LUNAR_TASK_PROFILES } from './lunarTaskProfiles';
import type { OntologyObject, OntologyObjectType, OntologyPosition, OntologyRelation, OntologySeed } from './types';

const point = (p: readonly number[]): OntologyPosition => ({ x: p[0], y: p[1], z: p[2] });
const relation = (from: string, type: OntologyRelation['type'], to: string): OntologyRelation => ({ id: `${from}:${type}:${to}`, from, to, type });

export const createLunarBaseOntologySeed = (level: LevelConfig): OntologySeed => {
  const objects: OntologyObject[] = [];
  const relations: OntologyRelation[] = [];
  for (const stop of SCENE_1_STOPS) {
    const profile = LUNAR_TASK_PROFILES[stop.id];
    const actor = level.assets.find(asset => asset.id === stop.id)!;
    objects.push({ id: stop.id, type: 'Humanoid', label: `${stop.id} · ${profile.title}`, description: `${stop.detail} Research context: ${profile.title}. Hardware check: ${profile.hardwareCheck}. Scene cue, not physical evidence.`,
      capabilities: ['Inspectable', 'Taskable', 'MobileAsset'],
      properties: { status: 'STAGED', health: 'NOMINAL', position: point(actor.position), currentTask: stop.taskId,
        role: profile.title, expectedState: stop.behavior, verificationStatus: 'NOT_REQUIRED',
        rehearsalAction: stop.title, rehearsalState: 'READY', skills: [stop.behavior] } });
    objects.push({ id: stop.taskId, type: 'Task', label: profile.title, description: stop.detail, capabilities: [],
      properties: { status: 'PLANNED', expectedState: stop.behavior, source: 'SCENE_PLAN' } });
    relations.push(relation(stop.id, 'assignedTo', stop.taskId), relation(stop.id, 'locatedAt', `Stop-${stop.id}`),
      relation(stop.taskId, 'dependsOn', stop.equipment), relation('GO2-01', 'observes', stop.id));
    objects.push({ id: `Stop-${stop.id}`, type: 'WorkZone', label: stop.title, capabilities: ['Inspectable'],
      properties: { status: 'STAGED', role: stop.title, position: point(actor.position), footprint: { width: 3.2, depth: 3.2 } } });
  }
  const assetTypes: Partial<Record<string, OntologyObjectType>> = {
    'EXC-01': 'Excavator', 'EXC-02': 'Excavator', 'ROVER-01': 'Rover',
    'LOGISTICS-ROVER-01': 'Rover', 'CABLE-ROVER-01': 'CableRover', 'PowerNode-B': 'PowerNode', 'Airlock-2A': 'Airlock',
  };
  for (const asset of level.assets) {
    const type = assetTypes[asset.id]; if (!type) continue;
    objects.push({ id: asset.id, type, label: asset.role ?? asset.id, capabilities: ['Inspectable', 'Taskable'],
      properties: { status: 'STAGED', health: 'NOMINAL', position: point(asset.position), role: asset.role, currentTask: asset.association?.taskId } });
    if (asset.association?.taskId) relations.push(relation(asset.id, 'assignedTo', asset.association.taskId));
    for (const worker of asset.association?.assignedWorkers ?? []) relations.push(relation(worker, 'dependsOn', asset.id));
  }
  objects.push(
    { id: 'GO2-01', type: 'Go2', label: 'Unitree Go2', capabilities: ['Inspectable', 'Taskable', 'MobileAsset'],
      properties: { status: 'STANDBY', health: 'NOMINAL', position: point(level.go2Agent?.position ?? [0, 0, 0]), role: 'Route observer', verificationStatus: 'NOT_REQUIRED', skills: ['PHYSICAL_INSPECTION'] } },
    { id: 'CableDeployment-17', type: 'Task', label: 'Staged cable run', capabilities: [], properties: { status: 'PLANNED', expectedState: 'CONNECTOR_INSPECTED' } },
    { id: 'CableRun-17', type: 'CableRun', label: 'Cable inspection run', capabilities: ['Inspectable'], properties: { status: 'PARTIAL', position: point([-6.5, 0, -6.7]), role: 'Staged cable visual' } },
    { id: 'Habitat-2', type: 'Habitat', label: 'World 2 habitat', capabilities: ['Inspectable'], properties: { status: 'AVAILABLE', position: point([-5, -0.7, -20]), role: 'Museum entrance', footprint: { width: 12, depth: 8 } } },
    { id: 'Route-Alpha', type: 'Route', label: 'Scene 1 demo route', capabilities: ['Inspectable'], properties: { status: 'OPEN', role: 'Inventory → sampling → cable → thermal → recovery → habitat' } },
  );
  relations.push(relation('GO2-01', 'routesThrough', 'Route-Alpha'), relation('CableRun-17', 'dependsOn', 'CableDeployment-17'),
    relation('PowerNode-B', 'supplies', 'Habitat-2'), relation('Airlock-2A', 'dependsOn', 'Habitat-2'));
  const objectIds = new Set(objects.map(object => object.id));
  return { mission: { id: 'LUNAR-OPS-01', label: 'Shackleton Mixed-Robot Base', scene: 'World Labs · Level 1',
    phase: 'SCENE 1 · GUIDED REHEARSAL', worldBounds: { minX: -17, maxX: 15, minZ: -23, maxZ: 10 } },
    objects, relations: relations.filter(edge => objectIds.has(edge.from) && objectIds.has(edge.to)),
    selectedEntityId: 'H04', discrepancyIds: [], trace: [] };
};

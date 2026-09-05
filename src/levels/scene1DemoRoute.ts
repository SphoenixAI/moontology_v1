/** Shared staging, cue order and ontology vocabulary for the exterior demo. */
export const SCENE_1_STOPS = [
  { id: 'H04', title: 'Inventory log', action: 'Writing', behavior: 'WRITING_INVENTORY', taskId: 'InventoryAudit-06',
    position: [5.2, 0, 1.4], yaw: -0.7, stop: [3.7, 0, 2.3], equipment: 'LOGISTICS-ROVER-01',
    detail: 'Writing clip · inventory log beside the logistics rover.' },
  { id: 'H01', title: 'Regolith sampling', action: 'Dig And Plant Seeds', behavior: 'DIGGING_SAMPLE_BED', taskId: 'RegolithExcavation-04',
    position: [-5.9, 0, 0.4], yaw: 0.6, stop: [-4.5, 0, 1.4], equipment: 'EXC-01',
    detail: 'Digging clip · sample-bed work beside the excavation area.' },
  { id: 'H02', title: 'Cable inspection', action: 'Kneeling Inspecting', behavior: 'KNEELING_INSPECTION', taskId: 'PowerInspection-08',
    position: [-4.9, 0, -5.6], yaw: -0.7, stop: [-3.4, 0, -4.9], equipment: 'CABLE-ROVER-01',
    detail: 'Kneeling inspection clip · examine the staged cable connector.' },
  { id: 'H03', title: 'Fatigue check', action: 'h01-sweat', behavior: 'WIPING_BROW', taskId: 'WorkerRecovery-12',
    position: [1.8, 0, -6.5], yaw: -0.8, stop: [0.6, 0, -5.4], equipment: 'ROVER-01',
    detail: 'Sweat clip · a scripted fatigue cue during a rover service break.' },
  { id: 'H06', title: 'Assistance check', action: 'Defeat', behavior: 'SLUMPED_POSTURE', taskId: 'AssistanceCheck-19',
    position: [4.4, 0, -10.4], yaw: -0.9, stop: [3, 0, -9], equipment: 'Airlock-2A',
    detail: 'Defeat clip · a scripted slumped-posture check before habitat entry.' },
] as const;

export const SCENE_1_ROUTE_IDS = SCENE_1_STOPS.map(stop => stop.id);
export const SCENE_1_ROUTE_SPAWN = { x: 1.5, y: 0, z: 5, rotationY: 0.65 };

export const EQUIPMENT_STAGING: Record<string, { position: [number, number, number]; rotation: [number, number, number] }> = {
  'LOGISTICS-ROVER-01': { position: [8.1, 0, 1.4], rotation: [0, -0.65, 0] },
  'EXC-01': { position: [-9.3, 0, -0.5], rotation: [0, 0.6, 0] },
  'EXC-02': { position: [-9.4, 0, 5], rotation: [0, -0.6, 0] },
  'CABLE-ROVER-01': { position: [-8, 0, -7.2], rotation: [0, -0.25, 0] },
  'ROVER-01': { position: [5.2, 0, -5.8], rotation: [0, 0.55, 0] },
  'PowerNode-B': { position: [-5.3, 0.08, -6.2], rotation: [0, 0, 0] },
};

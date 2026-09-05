import { AIRLOCK_APERTURE, AIRLOCK_PASSAGE } from './airlockPlacement';

export type Point2 = readonly [number, number];
export interface LayoutRegion {
  id: string;
  label: string;
  kind: 'terrain' | 'walkway' | 'floor' | 'building' | 'doorway';
  polygon: readonly Point2[];
  destination?: string;
  floorY?: number;
}
export interface LayoutDefinition {
  id: 'SCENE_1' | 'SCENE_2';
  revision: number;
  supportFloor?: { bounds: readonly [number, number, number, number]; topY: number; depth: number };
  regions: readonly LayoutRegion[];
}
const rect = (x0: number, z0: number, x1: number, z1: number): Point2[] => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];

/** Surveyed gameplay labels in world-root local meters, independent of the art.
 * A continuous hidden floor supports Scene 1; generated collider dips are not
 * gameplay ground. World 2 still uses its measured floor.
 * Everything beyond the surveyed apron / foyer remains unknown and blocked.
 */
export const SCENE_1_LAYOUT: LayoutDefinition = {
  id: 'SCENE_1', revision: 4,
  supportFloor: { bounds: [-32, -32, 32, 24], topY: AIRLOCK_APERTURE.floorY, depth: 2 },
  regions: [
    { id: 'Exterior-Apron', label: 'Exterior work apron', kind: 'terrain', polygon: rect(-17,-23,15,10) },
    { id: 'Walkway-Central', label: 'Central raised walkway', kind: 'walkway', polygon: [[-1,10],[1.6,10],[1,3],[.6,0],[.7,-4],[1.7,-9],[3.6,-14],[4,-17],[2.5,-17],[2,-14],[.2,-9],[-.8,-4],[-1,0],[-.7,3]] },
    { id: 'Walkway-West', label: 'West service walkway', kind: 'walkway', polygon: [[-16,3],[-16,4.4],[-1,1.4],[0,.1],[-3,.2]] },
    { id: 'Walkway-East', label: 'East logistics walkway', kind: 'walkway', polygon: [[0,-1],[0,.5],[14,5],[14,3.5]] },
    { id: 'Walkway-Habitat', label: 'Habitat entrance walkway', kind: 'walkway', polygon: [[.2,-9],[1.8,-9],[-.1,-14], [.35,-17.5],[-1.3,-17.5],[-1.4,-13]] },
    { id: 'Building-North', label: 'North habitat shell', kind: 'building', polygon: [[-17,-25],[1.8,-25],[1.8,-21],[.6,-18.2],[-.1,-17],[-2.5,-15.8],[-8,-14.1],[-12,-15.5],[-17,-20]] },
    { id: 'Building-West', label: 'West habitat shell', kind: 'building', polygon: [[-24,1.8],[-17,2.1],[-12,2.8],[-8.8,3.5],[-7.6,5],[-8,7],[-11,10.5],[-18,14],[-24,14]] },
    { id: 'Building-East', label: 'East habitat shell', kind: 'building', polygon: [[17,4],[23,4],[23,15],[17,15],[16,12],[16,7]] },
    { id: 'Building-South', label: 'South habitat shell', kind: 'building', polygon: [[4,12],[9,12],[13,20],[2,20]] },
    // The same support floor continues through the doorway without a down-step.
    // The portal cuts only the entrance mouth, never a tunnel through the shell.
    { id: 'Doorway-2A', label: 'Habitat doorway to World 2', kind: 'doorway', polygon: rect(AIRLOCK_PASSAGE.minX, AIRLOCK_PASSAGE.backZ, AIRLOCK_PASSAGE.maxX, AIRLOCK_PASSAGE.frontZ), destination: 'SCENE_2' },
  ],
};

export const SCENE_2_LAYOUT: LayoutDefinition = {
  id: 'SCENE_2', revision: 1,
  regions: [
    { id: 'Museum-Foyer', label: 'World 2 entrance foyer', kind: 'floor', polygon: rect(-1.8,-5,1.8,1.2) },
  ],
};

import { Box3, CatmullRomCurve3, Quaternion, Vector3, type Object3D } from 'three';
import type { AssetRegistry, LoadedAsset } from '../assets/AssetRegistry';
import type { OntologyStore } from '../ontology/OntologyStore';
import type { WorldLayout } from '../world/WorldLayout';

export const BACKGROUND_ROUTES = [
  { id: 'ROVER-01', delay: 8, dwell: 12, speed: .65,
    points: [[8.3,-6],[11,-7],[12,-10],[10.5,-13],[8,-14],[6.8,-12.5],[7,-9.5]] },
  { id: 'LOGISTICS-ROVER-01', delay: 30, dwell: 18, speed: .48,
    points: [[8.5,1.4],[11,1.6],[12,.2],[10.8,-1],[9.1,-1],[8.4,.1]] },
] as const;

type TrafficState = 'WAITING' | 'DRIVING' | 'YIELDING' | 'HELD' | 'EDITED';
interface Vehicle {
  asset: LoadedAsset;
  route: typeof BACKGROUND_ROUTES[number];
  curve: CatmullRomCurve3;
  length: number;
  distance: number;
  laps: number;
  wait: number;
  radius: number;
  lastPosition: Vector3;
  lastYaw: number;
  lastScale: Vector3;
  state: TrafficState;
  wheels: { node: Object3D; radius: number; rest: Quaternion; phase: number }[];
}

/** Visual traffic on the existing render loop. Never sends hardware commands. */
export class BackgroundTraffic {
  private readonly vehicles: Vehicle[] = [];
  private paused = false;
  private readonly layout: WorldLayout;
  private readonly registry: AssetRegistry;
  private readonly ontology: OntologyStore;
  private readonly button: HTMLButtonElement | null;
  private readonly onReset = () => { this.paused = true; this.refreshButton(); };
  constructor(registry: AssetRegistry, layout: WorldLayout, ontology: OntologyStore, host?: HTMLElement) {
    this.registry = registry; this.layout = layout; this.ontology = ontology;
    for (const route of BACKGROUND_ROUTES) {
      const asset = registry.get(route.id); if (!asset) continue;
      // The imported root-motion clip remains preserved but never drives X/Z.
      asset.animation?.action.stop();
      const bounds = new Box3().setFromObject(asset.model), size = bounds.getSize(new Vector3());
      const curve = new CatmullRomCurve3(route.points.map(([x,z])=>new Vector3(x,0,z)), true, 'centripetal');
      const wheels: Vehicle['wheels'] = [];
      asset.model.traverse(node => {
        if (!/^Wheel_[FMR][LR]$/.test(node.name)) return;
        const radius = Number(node.userData.radius) * node.getWorldScale(new Vector3()).y;
        if (radius > 0) wheels.push({node, radius, rest:node.quaternion.clone(), phase:0});
      });
      if (!wheels.length) continue;
      asset.root.userData.sceneMotionSource = 'SCHEDULED_BACKGROUND';
      asset.root.userData.scenePlacementRevision = 1;
      const tangent=curve.getTangentAt(0);asset.root.rotation.y=Math.atan2(tangent.x,tangent.z);
      const vehicle: Vehicle = { asset, route, curve, length:curve.getLength(), distance:0, laps:0, wait:route.delay,
        radius:Math.hypot(size.x,size.z)/2+.12, lastPosition:asset.root.getWorldPosition(new Vector3()),
        lastYaw:asset.root.rotation.y, lastScale:asset.root.scale.clone(), state:'WAITING', wheels };
      this.vehicles.push(vehicle); this.publish(vehicle,'WAITING');
    }
    this.button = host ? document.createElement('button') : null;
    if (this.button) {
      this.button.className = 'background-traffic-toggle';
      this.button.onclick = () => { this.paused = !this.paused; this.refreshButton(); };
      this.refreshButton(); host!.append(this.button);
    }
    if (typeof window !== 'undefined') window.addEventListener('moontology:scene-reset', this.onReset);
  }
  private refreshButton(): void {
    if (this.button) this.button.textContent = this.paused ? 'Resume background traffic' : 'Pause background traffic';
  }
  private publish(v: Vehicle, state: TrafficState): void {
    v.state=state; v.asset.root.userData.sceneMotionState=state;
    this.ontology.setBackgroundMotion(v.route.id,state);
  }
  update(dt: number, robot: Object3D | null, enabled: boolean): void {
    const robotPosition = robot?.getWorldPosition(new Vector3());
    for (const v of this.vehicles) {
      const root=v.asset.root;
      if (this.registry.get(v.route.id)!==v.asset || !root.parent) continue;
      const p=root.getWorldPosition(new Vector3());
      if (Math.hypot(p.x-v.lastPosition.x,p.z-v.lastPosition.z)>.01 || Math.abs(root.rotation.y-v.lastYaw)>.01 || !root.scale.equals(v.lastScale)) {
        delete root.userData.sceneMotionSource; this.publish(v,'EDITED'); continue;
      }
      if (v.state==='EDITED') continue;
      if (!enabled || this.paused || !this.ontology.canAnimateBackground(v.route.id) ||
        (typeof document !== 'undefined' && document.hidden) || !root.visible || !root.parent.visible || !Number.isFinite(dt) || dt<=0 || dt>.25) {
        this.publish(v,'HELD'); continue;
      }
      const nearRobot = robotPosition && Math.hypot(p.x-robotPosition.x,p.z-robotPosition.z)<v.radius+1.4;
      if (nearRobot) { this.publish(v,'YIELDING'); continue; }
      if (v.wait>0) { v.wait=Math.max(0,v.wait-dt); this.publish(v,'WAITING'); continue; }
      const advance = Math.min(v.route.speed*dt, .05);
      const distance=Math.min(v.length,v.distance+advance), next=v.curve.getPointAt(distance/v.length);
      const support=this.layout.footprint(next.x,next.z,v.radius,false);
      if (!support.traversable || this.layout.occupied(next.x,next.z,v.radius, v.route.id) ||
        (robotPosition && Math.hypot(next.x-robotPosition.x,next.z-robotPosition.z)<v.radius+1.4)) {
        this.publish(v,'YIELDING'); continue;
      }
      next.y=p.y; root.position.copy(root.parent.worldToLocal(next.clone()));
      const tangent=v.curve.getTangentAt(distance/v.length);
      root.rotation.y=Math.atan2(tangent.x,tangent.z);
      for (const wheel of v.wheels) {
        wheel.phase=(wheel.phase+advance/wheel.radius)%(Math.PI*2);
        wheel.node.quaternion.copy(wheel.rest).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),wheel.phase));
      }
      root.updateMatrixWorld(true); v.distance=distance; v.lastPosition.copy(next); v.lastYaw=root.rotation.y;
      this.publish(v,'DRIVING');
      if (distance>=v.length) { v.distance=0; v.laps++; v.wait=v.route.dwell; }
    }
  }
  report() { return this.vehicles.map(v=>({id:v.route.id,state:v.state,distance:v.distance,laps:v.laps,wait:v.wait,wheels:v.wheels.length,position:v.asset.root.getWorldPosition(new Vector3()).toArray()})); }
  dispose(): void {
    this.button?.remove();
    if (typeof window!=='undefined') window.removeEventListener('moontology:scene-reset',this.onReset);
    for (const v of this.vehicles) delete v.asset.root.userData.sceneMotionSource;
  }
}

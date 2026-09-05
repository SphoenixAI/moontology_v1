import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { OntologyStore } from '../ontology/OntologyStore';
import './humanoidProximity.css';

export const chooseNearbyHumanoid = (distances: {id:string;distance:number}[], current:string|null): string|null => {
  const candidates=distances.filter(p=>Number.isFinite(p.distance)).sort((a,b)=>a.distance-b.distance);
  const previous=candidates.find(p=>p.id===current);
  if(previous && previous.distance<4.4 && (!candidates[0] || candidates[0].distance>previous.distance-.8)) return previous.id;
  return candidates[0]?.distance<3.6 ? candidates[0].id : null;
};

/** One compact graph near the closest worker. Shares the renderer and ontology. */
export class HumanoidProximityOverlay {
  private readonly layer=document.createElement('div');
  private readonly graph=document.createElement('aside');
  private readonly tether=document.createElementNS('http://www.w3.org/2000/svg','svg');
  private readonly line=document.createElementNS('http://www.w3.org/2000/svg','polyline');
  private readonly title=document.createElement('span');
  private readonly task=document.createElement('strong');
  private readonly hardware=document.createElement('span');
  private readonly reasoning=document.createElement('span');
  private readonly evidence=document.createElement('p');
  private readonly heads=new Map<string,Object3D>();
  private selected:string|null=null;
  private nextContent=0;
  private readonly registry:AssetRegistry;
  private readonly ontology:OntologyStore;
  private readonly camera:PerspectiveCamera;
  constructor(registry:AssetRegistry,ontology:OntologyStore,camera:PerspectiveCamera) {
    this.registry=registry;this.ontology=ontology;this.camera=camera;
    this.layer.className='humanoid-proximity-layer';this.layer.hidden=true;
    this.graph.className='humanoid-brief';
    const head=document.createElement('div');head.className='humanoid-brief__heading';
    const caption=document.createElement('span');caption.textContent='ONTOLOGY';head.append(this.title,caption);
    const node=(label:string,content:HTMLElement,css:string)=>{
      const box=document.createElement('div');box.className=`humanoid-brief__node ${css}`;
      const name=document.createElement('small');name.textContent=label;box.append(name,content);return box;
    };
    const branches=document.createElement('div');branches.className='humanoid-brief__branches';
    branches.append(node('OPEN HARDWARE ISSUES',this.hardware,''),node('REASONING',this.reasoning,''));
    this.evidence.className='humanoid-brief__evidence';
    this.graph.append(head,node('ASSIGNED TASK',this.task,'humanoid-brief__task'),branches,this.evidence);
    this.tether.setAttribute('aria-hidden','true');this.tether.append(this.line);
    this.layer.append(this.tether,this.graph);document.body.append(this.layer);
  }
  update(robot:Object3D|null,enabled:boolean):void {
    if(!enabled || !robot || document.hidden) {this.layer.hidden=true;this.selected=null;return;}
    const robotPos=robot.getWorldPosition(new Vector3());
    const assets=this.registry.values().filter(a=>a.config.type==='humanoid' && a.root.visible && a.root.parent?.visible);
    const id=chooseNearbyHumanoid(assets.map(a=>{
      const p=a.root.getWorldPosition(new Vector3());return{id:a.config.id,distance:Math.hypot(p.x-robotPos.x,p.z-robotPos.z)};
    }),this.selected);
    const asset=assets.find(a=>a.config.id===id);
    if(!id || !asset){this.layer.hidden=true;this.selected=null;return;}
    let head=this.heads.get(id);
    if(!head || !asset.model.getObjectById(head.id)) {
      asset.model.traverse(n=>{if(/(^|:)Head$/.test(n.name))head=n;});
      if(head)this.heads.set(id,head);
    }
    const anchor=(head??asset.root).getWorldPosition(new Vector3());anchor.y+=head ? .25 : 1.9;
    const screen=anchor.clone().project(this.camera);
    if(screen.z < -1 || screen.z>1 || Math.abs(screen.x)>1 || Math.abs(screen.y)>1) {this.layer.hidden=true;return;}
    if(id!==this.selected || performance.now()>this.nextContent) {
      const brief=this.ontology.getProximityBrief(id);if(!brief){this.layer.hidden=true;return;}
      this.title.textContent=id;this.task.textContent=brief.task;this.hardware.textContent=brief.hardware;
      this.reasoning.textContent=brief.reasoning;this.evidence.textContent=brief.evidence;
      this.graph.dataset.result=brief.result;this.graph.setAttribute('aria-label',`${id} lunar task overview`);
      this.nextContent=performance.now()+250;
    }
    this.selected=id;this.layer.hidden=false;
    const width=Math.min(300,window.innerWidth-28), height=this.graph.offsetHeight;
    const x=(screen.x*.5+.5)*window.innerWidth,y=(-screen.y*.5+.5)*window.innerHeight;
    let left=Math.max(14,Math.min(window.innerWidth-width-14,x-width/2));
    const top=Math.max(12,Math.min(window.innerHeight-height-20,y-height-32));
    // Keep the small graph out of any visible dock occupying the same height.
    for(const panel of document.querySelectorAll<HTMLElement>('.dock-panel')) {
      const box=panel.getBoundingClientRect();
      if(box.width<1 || box.height<1 || box.bottom<top || box.top>top+height)continue;
      if(left<box.right && left+width>box.left) {
        if(box.left>window.innerWidth/2)left=Math.max(14,box.left-width-14);
        else if(box.right<window.innerWidth/2)left=Math.min(window.innerWidth-width-14,box.right+14);
      }
    }
    this.graph.style.width=`${width}px`;this.graph.style.transform=`translate(${left}px,${top}px)`;
    this.line.setAttribute('points',`${left+width/2},${top+height} ${left+width/2},${top+height+12} ${x},${y}`);
  }
  dispose():void {this.layer.remove();this.heads.clear();}
}

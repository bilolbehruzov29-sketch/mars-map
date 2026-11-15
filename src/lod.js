import * as THREE from 'three';
import { loadImage, getTrekCapabilities } from './nasa-api.js';
import { latLonToVector3, vector3ToLatLon } from './geo.js';
import { DETAIL_LAYERS } from './config.js';
const rad = Math.PI / 180;
export function tileBounds(level,row,col) {
  return {west:-180+360*col/level.cols,east:-180+360*(col+1)/level.cols,
    north:90-180*row/level.rows,south:90-180*(row+1)/level.rows};
}
// Only visible-region tiles are requested. GPU cache is bounded; generations discard stale work.
export class TrekLOD {
  constructor({camera,controls,planetGroup,flatGroup,onStatus,onChange=()=>{},concurrency=6,maxTiles=160}) {
    this.onChange=onChange;this.concurrency=concurrency;this.maxTiles=maxTiles;
    Object.assign(this,{camera,controls,onStatus});
    this.globe=new THREE.Group(); this.flat=new THREE.Group();
    planetGroup.add(this.globe);flatGroup.add(this.flat);
    this.cache=new Map();this.generation=0;this.signature='';
    this.loader=new THREE.TextureLoader(); this.loader.setCrossOrigin('anonymous');
  }
  clear() {
    this.generation++; this.signature='';
    for(const item of this.cache.values()) this.dispose(item);
    this.cache.clear();
  }
  dispose(item) {
    for(const mesh of [item.sphere,item.plane]) {mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}
    item.texture.dispose();
  }
  async update(baseCaps,key,mode) {
    if(!baseCaps) {this.clear();return;}
    const generation=this.generation+1;
    let caps=baseCaps;
    const height=mode==='3d'?Math.max(0.00001,this.camera.position.length()-1):this.camera.position.distanceTo(this.controls.target);
    const center=mode==='3d'?vector3ToLatLon(this.camera.position):{lat:this.controls.target.y*90,lon:this.controls.target.x*90};
    center.lat=THREE.MathUtils.clamp(center.lat,-89.999,89.999); center.lon=(((center.lon+180)%360)+360)%360-180; // JS % keeps the sign
    if((key==='planet'||key==='optical') && height<0.2) {
      for(const detail of DETAIL_LAYERS) {
        const delta=((center.lon-detail.lon+540)%360)-180;
        if(Math.abs(center.lat-detail.lat)>detail.range || Math.abs(delta)>detail.range) continue;
        try {caps=await getTrekCapabilities(detail.id);break;}catch { /* keep lower resolution NASA base */ }
      }
    }
    if(generation!==this.generation+1)return;
    // Degree span from perspective footprint. Longitude footprint increases near poles.
    const span=mode==='3d'?Math.min(180,height*70):Math.min(180,height*70);
    const desired=Math.max(0,Math.ceil(Math.log2(180/Math.max(span,0.0001))));
    const level=caps.levels[Math.min(caps.levels.length-1,desired)];
    const row=THREE.MathUtils.clamp(Math.floor((90-center.lat)/180*level.rows),0,level.rows-1);
    const col=((Math.floor((center.lon+180)/360*level.cols)%level.cols)+level.cols)%level.cols;
    const nx=Math.min(6,Math.max(2,Math.ceil((this.camera.aspect||1)/Math.max(0.15,Math.cos(center.lat*rad)))));
    const signature=`${key}:${caps.id}:${level.id}:${row}:${col}:${nx}`;
    if(this.signature===signature)return;this.signature=signature;this.generation=generation;
    for(const item of this.cache.values()){item.sphere.visible=false;item.plane.visible=false;}
    const jobs=[];const wanted=new Set();
    for(let dy=-3;dy<=3;dy++)for(let dx=-nx;dx<=nx;dx++) {
      const r=row+dy,c=(((col+dx)%level.cols)+level.cols)%level.cols;if(r<0||r>=level.rows)continue;
      const id=`${caps.id}:${level.id}:${r}:${c}`;if(wanted.has(id))continue;wanted.add(id);
      const cached=this.cache.get(id);
      if(cached){cached.sphere.visible=cached.plane.visible=true;cached.used=Date.now();continue;}
      jobs.push({id,r,c});
    }
    let ok=0;
    const worker=async()=>{while(jobs.length && generation===this.generation){
      const {id,r,c}=jobs.shift();
      const url=caps.template.replace('{TileMatrix}',level.id).replace('{TileRow}',r).replace('{TileCol}',c);
      const img=await loadImage(url);if(!img||generation!==this.generation)continue;
      const texture=new THREE.Texture(img);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
      const b=tileBounds(level,r,c);
      // Higher tessellation for coarse tiles; patches use the same coordinate convention as geo.js.
      const segments=Math.max(2,Math.ceil((b.east-b.west)/3));
      const geom=new THREE.SphereGeometry(1,segments,Math.max(2,Math.ceil((b.north-b.south)/3)),(b.west+180)*rad,(b.east-b.west)*rad,(90-b.north)*rad,(b.north-b.south)*rad);
      const mat=()=>new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
      const sphere=new THREE.Mesh(geom,mat());sphere.renderOrder=2;
      const plane=new THREE.Mesh(new THREE.PlaneGeometry((b.east-b.west)/90,(b.north-b.south)/90),mat());
      plane.position.copy(new THREE.Vector3((b.east+b.west)/180,(b.north+b.south)/180,0.000001));plane.renderOrder=2;
      this.globe.add(sphere);this.flat.add(plane);this.cache.set(id,{sphere,plane,texture,used:Date.now()});ok++;this.onChange();
    }};
    this.onStatus(`NASA · level ${level.id} · loading local tiles…`);
    this.onChange();
    await Promise.all(Array.from({length:this.concurrency},worker));
    if(generation!==this.generation)return;
    const old=[...this.cache].filter(([id])=>!wanted.has(id)).sort((a,b)=>a[1].used-b[1].used);
    while(this.cache.size>this.maxTiles && old.length){const [id,item]=old.shift();this.dispose(item);this.cache.delete(id);}
    const count=[...wanted].filter(id=>this.cache.has(id)).length;
    this.onStatus(`NASA · ${caps.id} · L${level.id} · tiles ${count}/${wanted.size}${count?'':' · no coverage / service unavailable'}`);
  }
}

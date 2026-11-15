import * as THREE from 'three';
// CPU-only 2D renderer for browsers without WebGL. Uses the same NASA tiles and camera.
export class CanvasMapRenderer {
  constructor() {
    this.domElement=document.createElement('canvas');this.ctx=this.domElement.getContext('2d');
    this.capabilities={maxTextureSize:4096,getMaxAnisotropy:()=>1};this.isFallback=true;
  }
  setPixelRatio() {}
  setSize(w,h){this.domElement.width=w;this.domElement.height=h;}
  render(scene,camera) {
    const ctx=this.ctx,w=this.domElement.width,h=this.domElement.height;
    ctx.fillStyle='#080808';ctx.fillRect(0,0,w,h);scene.updateMatrixWorld();camera.updateMatrixWorld();
    const project=v=>{const p=v.clone().project(camera);return {x:(p.x+1)*w/2,y:(1-p.y)*h/2};};
    const objects=[];scene.traverseVisible(o=>{if(o.isMesh||o.isLine)objects.push(o);});
    const order=o=>o.geometry.type==='PlaneGeometry'?o.renderOrder:100;
    objects.sort((a,b)=>(order(a)-order(b))||(a.position.z-b.position.z));
    for(const o of objects) {
      if(o.isLine2 || o.isLineSegments2){
        const starts=o.geometry.attributes.instanceStart,ends=o.geometry.attributes.instanceEnd;ctx.strokeStyle='#ffbd87';ctx.lineWidth=o.material.linewidth||2;ctx.beginPath();for(let i=0;i<starts.count;i++){const a=project(o.localToWorld(new THREE.Vector3().fromBufferAttribute(starts,i))),b=project(o.localToWorld(new THREE.Vector3().fromBufferAttribute(ends,i)));ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();ctx.lineWidth=1;
      } else if(o.geometry.type==='PlaneGeometry') {
        const image=o.material.map?.image;if(!image||(!image.width&&!image.data))continue;
        const {width,height}=o.geometry.parameters;
        const a=project(o.localToWorld(new THREE.Vector3(-width/2,height/2,0))),b=project(o.localToWorld(new THREE.Vector3(width/2,-height/2,0)));
        if(b.x-a.x>400000||b.y-a.y>400000)continue;
        try{ctx.drawImage(image,a.x,a.y,b.x-a.x,b.y-a.y);}catch{/* neutral DataTexture placeholder */}
      } else if(o.isLine) {
        const attr=o.geometry.attributes.position;ctx.strokeStyle='#ffc18d';ctx.beginPath();
        for(let i=0;i<attr.count;i++){const p=project(o.localToWorld(new THREE.Vector3().fromBufferAttribute(attr,i)));if(i===0||(o.isLineSegments&&i%2===0))ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.stroke();
      } else if(o.geometry.type==='SphereGeometry' && o.parent?.parent?.visible && o.geometry.parameters.radius<0.1) {
        const p=project(o.getWorldPosition(new THREE.Vector3()));ctx.fillStyle=o.material.color?.getStyle()||'#6de0c2';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();
      }
    }
  }
}

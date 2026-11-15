import { MISSIONS } from './config.js';
// Displays NASA's measured horizontal coverage without inventing missing sky or terrain.
export class PanoramaViewer {
  constructor(){
    this.dialog=document.querySelector('#panoramaDialog');document.body.append(this.dialog);this.canvas=document.querySelector('#panoramaCanvas');this.ctx=this.canvas.getContext('2d');this.status=document.querySelector('#panoramaStatus');this.generation=0;
    document.querySelector('#closePanorama').onclick=()=>this.close();
    this.dialog.addEventListener('keydown',e=>{if(e.key==='Escape')this.close();if(e.key==='Tab'){const items=[...this.dialog.querySelectorAll('button,a[href],canvas')].filter(x=>!x.hidden);const a=items[0],b=items.at(-1);if(e.shiftKey&&document.activeElement===a){e.preventDefault();b.focus();}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus();}}});
    this.canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.yaw-=(e.clientX-this.drag.x)/this.canvas.clientWidth*this.fov;this.pitch+=(e.clientY-this.drag.y);this.drag={x:e.clientX,y:e.clientY};this.draw();});
    this.canvas.addEventListener('pointerup',()=>this.drag=null);this.canvas.addEventListener('pointercancel',()=>this.drag=null);
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY>0?1.15:1/1.15);},{passive:false});
    this.canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')this.yaw-=10;if(e.key==='ArrowRight')this.yaw+=10;if(e.key==='ArrowUp')this.pitch+=30;if(e.key==='ArrowDown')this.pitch-=30;if(e.key==='+'||e.key==='=')this.zoom(0.8);if(e.key==='-')this.zoom(1.25);this.draw();}});
    document.querySelector('#panoramaLeft').onclick=()=>{this.yaw-=15;this.draw();};document.querySelector('#panoramaRight').onclick=()=>{this.yaw+=15;this.draw();};document.querySelector('#panoramaZoomIn').onclick=()=>this.zoom(0.8);document.querySelector('#panoramaZoomOut').onclick=()=>this.zoom(1.25);
    new ResizeObserver(()=>this.draw()).observe(this.canvas);
  }
  async open(id){
    const generation=++this.generation;this.returnFocus=document.activeElement;this.dialog.hidden=false;document.querySelector('#app').inert=true;document.body.classList.add('viewing-panorama');
    this.image=null;this.status.hidden=false;this.status.textContent='Loading verified NASA panorama…';document.querySelector('#panoramaTitle').textContent='Mission panorama';document.querySelector('#panoramaDetails').textContent='';
    const spec=MISSIONS[id]?.panorama;
    const source=document.querySelector('#panoramaSource'),original=document.querySelector('#panoramaOriginal');
    source.href=spec?.source||'https://trek.nasa.gov/mars/';original.href=spec?'https://images.nasa.gov/details/'+spec.nasaId:'https://images.nasa.gov/';
    for(const a of [source,original]){a.target='_blank';a.rel='noopener noreferrer';}
    this.canvas.focus();this.draw();
    try{
      const response=await fetch(`/api/missions/${encodeURIComponent(id)}/panorama`,{signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'NASA panorama is unavailable.');
      if(generation!==this.generation)return;
      document.querySelector('#panoramaTitle').textContent=`${data.missionName} · ${data.coverage}°`;
      document.querySelector('#panoramaDetails').textContent=`${data.title} · ${data.date} · ${data.credit}. ${data.locationNote} ${data.coverage<360?'Only '+data.coverage+'° were captured; the missing sector is not generated.':'360° horizontal panorama; vertical coverage is limited to the original image.'}`;
      document.querySelector('#panoramaSource').href=data.source;document.querySelector('#panoramaOriginal').href=data.original;
      const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The NASA panorama image could not be loaded.'));img.src=data.image;});
      if(generation!==this.generation)return;
      this.image=image;this.coverage=data.coverage;this.yaw=this.coverage/2;this.pitch=100000;this.fov=Math.min(90,this.coverage);this.status.hidden=true;this.draw();
    }catch(error){if(generation===this.generation)this.status.textContent=error.message+' Start the site with python -m backend.run and open http://127.0.0.1:8000. NASA source links remain available below.';}
  }
  close(){this.generation++;this.dialog.hidden=true;this.image=null;document.querySelector('#app').inert=false;document.body.classList.remove('viewing-panorama');this.returnFocus?.focus();}
  zoom(factor){if(!this.image)return;this.fov=Math.max(15,Math.min(120,this.fov*factor));this.draw();}
  draw(){
    if(this.dialog.hidden)return;const w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1;this.canvas.width=w;this.canvas.height=h;const c=this.ctx;c.fillStyle='#080c15';c.fillRect(0,0,w,h);if(!this.image)return;
    const scale=w/(this.image.width*(this.fov/this.coverage)),iw=this.image.width*scale,ih=this.image.height*scale;
    this.pitch=Math.max(-Math.max(0,(ih-h)/2),Math.min(Math.max(0,(ih-h)/2),this.pitch));
    if(this.coverage===360)this.yaw=((this.yaw%360)+360)%360;else this.yaw=Math.max(this.fov/2,Math.min(this.coverage-this.fov/2,this.yaw));
    const x=w/2-this.yaw/this.coverage*iw,y=(h-ih)/2+this.pitch;
    if(this.coverage===360){for(let shift=-2;shift<=2;shift++)c.drawImage(this.image,x+shift*iw,y,iw,ih);}else c.drawImage(this.image,x,y,iw,ih);
  }
}

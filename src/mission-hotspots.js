import * as THREE from 'three';
import { latLonToVector3, latLonToPlane } from './geo.js';
export function createMissionHotspots({missions,camera,getMode,onSelect}){
  const root=document.querySelector('#missionHotspots');
  const points=Object.entries(missions).filter(([,m])=>(m.panorama||m.candidate)).map(([id,m])=>{
    const button=document.createElement('button');button.type='button';button.className='mission-hotspot';button.dataset.mission=id;button.title=m.candidate?'Research candidate · evidence and limitations':'осмотр местности';button.setAttribute('aria-label',`${m.name}: осмотр местности`);
    const dot=document.createElement('span');dot.className='hotspot-dot';
    const tooltip=document.createElement('span');tooltip.className='hotspot-tooltip';tooltip.lang='ru';tooltip.textContent=`${m.name} · осмотр местности`;
    button.append(dot,tooltip);button.onclick=()=>onSelect(id);root.append(button);return {button,mission:m};
  });
  return ()=>{
    const width=root.clientWidth,height=root.clientHeight,mode=getMode();
    for(const {button,mission:m} of points){
      const lon=((m.lon+540)%360)-180;
      const p=mode==='3d'?latLonToVector3(m.lat,lon,1.000002):latLonToPlane(m.lat,lon,0.000002);
      const front=mode!=='3d'||p.clone().normalize().dot(camera.position.clone().sub(p))>0;
      const ndc=p.clone().project(camera);
      button.hidden=!front||ndc.z< -1||ndc.z>1||Math.abs(ndc.x)>1||Math.abs(ndc.y)>1;
      if(!button.hidden)button.style.transform=`translate(${(ndc.x+1)*width/2}px,${(1-ndc.y)*height/2}px) translate(-50%,-50%)`;
    }
  };
}

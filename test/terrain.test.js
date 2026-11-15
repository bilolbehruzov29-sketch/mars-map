import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchHeight,toLocal,KM_PER_DEG} from '../src/terrain-math.js';
const patch={lat:-5,lon:137,radiusKm:10,size:3,spacingKm:10,heights:[0,10,20, 30,40,50, 60,70,80]};
test('bilinear patch height and bounds',()=>{
 assert.equal(patchHeight(patch,0,0),40);          // centre
 assert.equal(patchHeight(patch,-10,10),0);        // north-west corner
 assert.equal(patchHeight(patch,10,-10),80);       // south-east corner
 assert.equal(patchHeight(patch,5,0),45);
 assert.equal(patchHeight(patch,11,0),null);
});
test('local tangent plane matches the server convention, across the antimeridian',()=>{
 const p={lat:0,lon:179.5};
 const l=toLocal(p,0,-179.5);
 assert.ok(Math.abs(l.east-KM_PER_DEG)<1e-6);
 assert.ok(Math.abs(toLocal(p,1,179.5).north-KM_PER_DEG)<1e-6);
});
import {sunPosition,sunVector,directIrradiance,skyColors,defaultDust,formatLmst} from '../src/terrain-math.js';
test('sun geometry',()=>{
 const noonEq=sunPosition(0,0,12); assert.ok(Math.abs(noonEq.elevation-90)<1e-6);
 const morning=sunPosition(0,0,6); assert.ok(Math.abs(morning.elevation)<1e-6); assert.ok(Math.abs(morning.azimuth-90)<1e-6);   // rises due east at equinox
 const evening=sunPosition(0,0,18); assert.ok(Math.abs(evening.azimuth-270)<1e-6);
 const south=sunPosition(30,0,12); assert.ok(Math.abs(south.elevation-60)<1e-6); assert.ok(Math.abs(south.azimuth-180)<1e-6); // northern site: noon Sun in the south
 const v=sunVector({elevation:0,azimuth:90}); assert.ok(Math.abs(v.x-1)<1e-9 && Math.abs(v.y)<1e-9);
 assert.ok(sunPosition(-80,25,12).elevation<0); assert.ok(sunPosition(-80,-25,0).elevation>0); // polar night / midnight sun
});
test('dust dims the Sun and changes the sky',()=>{
 assert.ok(directIrradiance(590,60,0.3)>directIrradiance(590,60,4)*10);
 assert.equal(directIrradiance(590,-5,0.3),0);
 assert.notEqual(skyColors(40,0.5).top,skyColors(-20,0.5).top);
 assert.equal(defaultDust(true,'Sunny'),'hazy'); assert.equal(defaultDust(false,'Sunny'),'typical');
 assert.equal(formatLmst(6.05),'06:03'); assert.equal(formatLmst(24),'00:00');
});

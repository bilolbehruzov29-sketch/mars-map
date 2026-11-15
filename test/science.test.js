import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWeather,numeric} from '../src/weather.js';
import {greatCircleDistance,greatCircleArc,latLonToVector3,vector3ToLatLon} from '../src/geo.js';
import {assessRoute} from '../src/route-assessment.js';
import {tileBounds} from '../src/lod.js';
test('missing weather remains missing, latest record selected by date',()=>{
 const w=parseWeather({soles:[{sol:'1',terrestrial_date:'2020-01-01',wind_speed:'5'},{sol:'2',terrestrial_date:'2026-08-25',min_temp:'-71',max_temp:'-5',pressure:'777',wind_speed:'--'}]});
 assert.equal(w.sol,'2');assert.equal(w.wind,null);assert.equal(w.min,-71);assert.equal(numeric(''),null);assert.equal(numeric('NaN'),null);
 assert.throws(()=>parseWeather({soles:[]}));
});
test('dated or distant observations never certify a route',()=>{
 const w=parseWeather({soles:[{sol:'2',terrestrial_date:'2026-08-25',wind_speed:'--'}]});
 const a={lat:-4.5895,lon:137.4417},b={lat:-4.58,lon:137.45};
 const old=assessRoute(a,b,w,new Date('2026-11-14T00:00:00Z'));
 assert.equal(old.safe,false);assert.equal(old.weatherRelevant,false);assert.ok(old.reasons.some(r=>r.includes('not current route weather')));
 const local=assessRoute(a,b,{...w,wind:1},new Date('2026-08-26T00:00:00Z'));
 assert.equal(local.weatherRelevant,true);assert.equal(local.safe,false);
 assert.equal(assessRoute(a,b,null).safe,false);
});
test('coordinates round-trip, antimeridian and antipodes are stable',()=>{
 for(const p of [{lat:18.44,lon:77.45},{lat:-4.5895,lon:137.4417},{lat:0,lon:-179.99}]){
 const q=vector3ToLatLon(latLonToVector3(p.lat,p.lon));assert.ok(Math.abs(q.lat-p.lat)<1e-8);assert.ok(Math.abs(q.lon-p.lon)<1e-8);}
 assert.ok(greatCircleDistance(0,179.9,0,-179.9)<12);
 assert.ok(Number.isFinite(greatCircleDistance(90,0,-90,180)));
 const arc=greatCircleArc({lat:0,lon:0},{lat:0,lon:180});assert.equal(arc.length,101);assert.ok(arc.every(p=>Number.isFinite(p.x)));
});
test('WMTS geographic tile boundaries retain polar and seam alignment',()=>{
 const l={cols:4,rows:2};assert.deepEqual(tileBounds(l,0,0),{west:-180,east:-90,north:90,south:0});
 assert.deepEqual(tileBounds(l,1,3),{west:90,east:180,north:0,south:-90});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodePlan,decodePlan,profileSvg} from '../src/expedition.js';
test('share links round-trip, including non-Latin names',()=>{
 const state={stops:[{base:'curiosity',name:'Curiosity',lat:-4.59,lon:137.44},{base:'',name:'База «Север»',lat:10,lon:-170}],roundTrip:true,vehicle:'crewed',maxSlopeDeg:12,departure:'2027-01-01',stopSols:2};
 const text=encodePlan(state);
 assert.match(text,/^[A-Za-z0-9_-]+$/);
 assert.deepEqual(decodePlan(text),state);
});
test('broken share links are rejected',()=>{
 assert.throws(()=>decodePlan('not-json'));
 assert.throws(()=>decodePlan(encodePlan({stops:[{lat:0,lon:0}]})));
 assert.throws(()=>decodePlan(encodePlan({stops:[{lat:'x',lon:0},{lat:999,lon:0}]})));
});
test('profile chart escapes nothing user-controlled and spans the route',()=>{
 const svg=profileSvg([{km:0,elevationM:-4000,leg:0},{km:50,elevationM:-3000,leg:0},{km:120,elevationM:-3500,leg:1}],[{distanceKm:50},{distanceKm:70}]);
 assert.match(svg,/<svg/);assert.match(svg,/120 km/);assert.equal((svg.match(/stroke-dasharray/g)||[]).length,1);
});

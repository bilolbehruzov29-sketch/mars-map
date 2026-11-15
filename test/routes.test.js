import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeWidth} from '../src/routes.js';
test('route width increases with distance and remains bounded',()=>{
 const widths=[0.00003,0.0008,0.01,0.2,1,4.2,12].map(routeWidth);
 widths.forEach((w,i)=>{assert.ok(Number.isFinite(w));assert.ok(w>=1.5&&w<=9);if(i)assert.ok(w>=widths[i-1]);});
 assert.ok(widths[0]<widths.at(-1));assert.equal(routeWidth(-1),1.5);
});

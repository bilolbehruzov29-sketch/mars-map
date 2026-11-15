import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectQuality} from '../src/device.js';
const env=(o={})=>({navigator:{deviceMemory:8,hardwareConcurrency:8,...o.nav},devicePixelRatio:o.dpr??1,screen:{width:o.w??1920,height:o.h??1080},matchMedia:q=>({matches:(o.coarse&&q.includes('coarse'))||(o.rm&&q.includes('reduced'))})});
test('desktop keeps full quality',()=>{const q=detectQuality(env());assert.equal(q.low,false);assert.equal(q.antialias,true);assert.equal(q.tileZoom,3);});
test('phones get the light profile',()=>{const q=detectQuality(env({coarse:true,w:390,h:844,dpr:3}));assert.equal(q.low,true);assert.equal(q.pixelRatio,1.5);assert.equal(q.antialias,false);assert.equal(q.tileZoom,2);});
test('low memory, few cores or data saver are light',()=>{
 for(const nav of [{deviceMemory:2},{hardwareConcurrency:2},{connection:{saveData:true}}]) assert.equal(detectQuality(env({nav})).low,true);
});
test('large touch tablets in landscape keep full quality',()=>{assert.equal(detectQuality(env({coarse:true,w:1366,h:1024})).low,false);});

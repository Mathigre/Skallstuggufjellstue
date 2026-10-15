import test from 'node:test';import assert from 'node:assert/strict';
import {imageScale,enhancePixels} from '../admin/receipt-image.mjs';
test('small receipts enlarged and large images bounded',()=>{
 assert.equal(imageScale(243,803),6);
 for(const [w,h] of [[4000,12000],[100,40000],[2000,1000]]){const s=imageScale(w,h);assert.ok(w*s<=2600.01);assert.ok(w*h*s*s<=12000001);}
});
test('transparent background becomes white, black ink stays black',()=>{
 const pixels=new Uint8ClampedArray([0,0,0,0,0,0,0,255,255,255,255,255]);enhancePixels(pixels);assert.deepEqual([...pixels],[255,255,255,255,0,0,0,255,255,255,255,255]);
});

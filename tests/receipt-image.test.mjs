import test from 'node:test';import assert from 'node:assert/strict';
import {imageScale,enhancePixels,adaptiveThreshold,skewAngle} from '../admin/receipt-image.mjs';
test('small receipts enlarged and large images bounded',()=>{
 assert.equal(imageScale(243,803),6);
 for(const [w,h] of [[4000,12000],[100,40000],[2000,1000]]){const s=imageScale(w,h);assert.ok(w*s<=2600.01);assert.ok(w*h*s*s<=12000001);}
});
test('local threshold separates ink on a shaded paper background',()=>{
 const w=100,h=60,pixels=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=120+x;pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;}
 for(let y=25;y<30;y++)for(let x=30;x<70;x++){const i=(y*w+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=25;}
 const out=adaptiveThreshold(pixels,w,h,10);assert.equal(out[(27*w+50)*4],0);assert.equal(out[(15*w+50)*4],255);assert.equal(out[(15*w+10)*4],255);
});
test('deskew detects sloped text rows and leaves blank pages alone',()=>{
 const w=400,h=300,p=new Uint8ClampedArray(w*h*4).fill(255),angle=4,slope=Math.tan(angle*Math.PI/180);
 for(let row=40;row<260;row+=30)for(let x=25;x<375;x++){if(x%17<3)continue;const y=Math.round(row+slope*(x-w/2));for(let dy=0;dy<3;dy++){const i=((y+dy)*w+x)*4;p[i]=p[i+1]=p[i+2]=0;}}
 assert.ok(Math.abs(skewAngle(p,w,h)-angle)<=.5);assert.equal(skewAngle(new Uint8ClampedArray(w*h*4).fill(255),w,h),0);
});
test('transparent background becomes white, black ink stays black',()=>{
 const pixels=new Uint8ClampedArray([0,0,0,0,0,0,0,255,255,255,255,255]);enhancePixels(pixels);assert.deepEqual([...pixels],[255,255,255,255,0,0,0,255,255,255,255,255]);
});

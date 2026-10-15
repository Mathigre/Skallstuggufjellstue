// Bounded, local preprocessing. Keep the original file untouched.
export function imageScale(width,height){
 return Math.min(6,Math.max(1,1500/width),2600/width,Math.sqrt(12000000/(width*height)));
}
export function enhancePixels(data){
 const histogram=new Uint32Array(256);
 for(let i=0;i<data.length;i+=4){const a=data[i+3]/255,g=Math.round((.299*data[i]+.587*data[i+1]+.114*data[i+2])*a+255*(1-a));histogram[g]++;}
 const count=data.length/4;let low=0,high=255,n=0;
 while(low<254&&(n+=histogram[low])<count*.015)low++;
 n=0;while(high>low&&(n+=histogram[high])<count*.98)high--;
 // White receipt backgrounds dominate the histogram; preserve dark ink.
 high=Math.max(high,220);low=Math.min(low,100);
 for(let i=0;i<data.length;i+=4){const a=data[i+3]/255,g=(.299*data[i]+.587*data[i+1]+.114*data[i+2])*a+255*(1-a),v=Math.max(0,Math.min(255,Math.round((g-low)*255/(high-low))));data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}
 return data;
}
export function prepareReceipt(image){
 const scale=imageScale(image.width,image.height),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);enhancePixels(pixels.data);ctx.putImageData(pixels,0,0);
 return canvas;
}

// Bounded, local preprocessing. Keep the original file untouched.
export function imageScale(width,height){
 return Math.min(3.5,Math.max(1,1800/width),Math.sqrt(6000000/(width*height)));
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
export function prepareReceipt(image,darkInkOnly=false){
 const scale=imageScale(image.width,image.height),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
 if(darkInkOnly)for(let i=0;i<pixels.data.length;i+=4){const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];if(Math.max(r,g,b)-Math.min(r,g,b)>60&&Math.max(r,g,b)>140)pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;}
 enhancePixels(pixels.data);ctx.putImageData(pixels,0,0);
 return canvas;
}

export function adaptiveThreshold(pixels,width,height,radius=Math.max(8,Math.round(width/28))){
 // Integral image keeps illumination correction linear in the pixel count.
 const stride=width+1,sums=new Uint32Array(stride*(height+1)),out=new Uint8ClampedArray(pixels.length);
 for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){const i=(y*width+x)*4;row+=pixels[i];sums[(y+1)*stride+x+1]=sums[y*stride+x+1]+row;}}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const left=Math.max(0,x-radius),right=Math.min(width,x+radius+1),top=Math.max(0,y-radius),bottom=Math.min(height,y+radius+1);
 const mean=(sums[bottom*stride+right]-sums[top*stride+right]-sums[bottom*stride+left]+sums[top*stride+left])/((right-left)*(bottom-top)),i=(y*width+x)*4,v=pixels[i]<mean-12?0:255;
 out[i]=out[i+1]=out[i+2]=v;out[i+3]=255;
 }return out;
}
export function skewAngle(pixels,width,height){
 const points=[],step=Math.max(1,Math.ceil(Math.max(width,height)/700));
 for(let y=Math.ceil(height*.04);y<height*.96;y+=step)for(let x=Math.ceil(width*.04);x<width*.96;x+=step)if(pixels[(y*width+x)*4]<80)points.push([x/step,y/step]);
 if(points.length<50)return 0;
 const h=Math.ceil(height/step),w=Math.ceil(width/step);let best=0,bestScore=0,straight=0;
 for(let angle=-8;angle<=8;angle+=.5){const rows=new Uint32Array(h+w+4),slope=Math.tan(angle*Math.PI/180);for(const [x,y] of points){const row=Math.round(y-slope*(x-w/2))+Math.ceil(w/2);if(row>=0&&row<rows.length)rows[row]++;}let score=0;for(const n of rows)score+=n*n;if(angle===0)straight=score;if(score>bestScore){bestScore=score;best=angle;}}
 return bestScore>straight*1.08?best:0;
}
export function normalizedReceipt(canvas){
 const result=document.createElement('canvas');result.width=canvas.width;result.height=canvas.height;
 const ctx=result.getContext('2d',{willReadFrequently:true}),source=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
 source.data.set(adaptiveThreshold(source.data,canvas.width,canvas.height));ctx.putImageData(source,0,0);
 const angle=skewAngle(source.data,canvas.width,canvas.height);
 if(Math.abs(angle)>=.5){
 const rotated=document.createElement('canvas'),radians=-angle*Math.PI/180;
 rotated.width=Math.ceil(Math.abs(result.width*Math.cos(radians))+Math.abs(result.height*Math.sin(radians)));rotated.height=Math.ceil(Math.abs(result.width*Math.sin(radians))+Math.abs(result.height*Math.cos(radians)));
 // Rotation can otherwise exceed the memory budget for unusually long receipts.
 if(rotated.width*rotated.height<=14000000){const target=rotated.getContext('2d');target.fillStyle='white';target.fillRect(0,0,rotated.width,rotated.height);target.translate(rotated.width/2,rotated.height/2);target.rotate(radians);target.drawImage(result,-result.width/2,-result.height/2);result.width=result.height=0;return rotated;}
 rotated.width=rotated.height=0;
 }return result;
}

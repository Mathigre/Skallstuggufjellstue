const VERSION='6.0.1';
let loading;
export function loadOCR(){
 if(window.Tesseract)return Promise.resolve(window.Tesseract);
 if(!loading)loading=new Promise((resolve,reject)=>{
 const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@'+VERSION+'/dist/tesseract.min.js';script.crossOrigin='anonymous';
 script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(Error('Tekstleseren kunne ikke starte.'));
 script.onerror=()=>{script.remove();loading=null;reject(Error('Kunne ikke laste tekstleseren. Kontroller nettforbindelsen.'));};document.head.append(script);
 });
 return loading;
}
export async function recognizeReceipt(blob,mime,onProgress=()=>{}){
 const T=await loadOCR();let worker,pdf,timer,expired=false;
 const work=(async()=>{
 worker=await T.createWorker('nor+eng',1,{
 workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
 corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
 langPath:'https://tessdata.projectnaptha.com/4.0.0',
 logger:m=>onProgress(m.status==='recognizing text'?'Leser tekst '+Math.round(m.progress*100)+' %':'Klargjør tekstleser …')
 });
 if(expired){await worker.terminate();throw Error('Tekstlesingen ble avbrutt.');}
 if(mime==='application/pdf'){
 const lib=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
 lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
 pdf=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false}).promise;
 if(pdf.numPages>3)throw Error('PDF kan ha maks 3 sider.');
 let text='';
 for(let i=1;i<=pdf.numPages;i++){
 onProgress('Leser PDF-side '+i+' av '+pdf.numPages);
 const page=await pdf.getPage(i),natural=page.getViewport({scale:1}),scale=Math.min(2,2200/natural.width,Math.sqrt(12000000/(natural.width*natural.height))),view=page.getViewport({scale});
 const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
 await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
 text+=(await worker.recognize(canvas)).data.text+'\n';canvas.width=canvas.height=0;page.cleanup();
 }
 return text;
 }
 if(!['image/png','image/jpeg','image/heic','image/heif'].includes(mime))throw Error('Filtypen støttes ikke av tekstleseren.');
 let image;try{image=await createImageBitmap(blob);}catch{throw Error('Nettleseren kan ikke lese dette bildet. Last opp JPG eller PNG i stedet for HEIC.');}
 try{
 if(image.width*image.height>60000000)throw Error('Bildet er for stort. Bruk lavere oppløsning.');
 const scale=Math.min(1,2200/image.width,Math.sqrt(12000000/(image.width*image.height)));
 const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
 const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
 try{return (await worker.recognize(canvas)).data.text;}finally{canvas.width=canvas.height=0;}
 }finally{image.close();}
 })();
 try{
 return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Tekstlesingen tok for lang tid. Prøv et tydeligere bilde.'));},120000);})]);
 }finally{clearTimeout(timer);await worker?.terminate();await pdf?.destroy();}
}
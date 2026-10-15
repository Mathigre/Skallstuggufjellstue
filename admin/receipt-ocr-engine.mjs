import {receiptLines} from './receipt-layout.mjs?v=20261015c';
import {prepareReceipt,normalizedReceipt} from './receipt-image.mjs?v=20261015c';
import {parseReceiptText} from './receipt-ocr.mjs?v=20261015c';
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
 const check=()=>{if(expired)throw Error('Tekstlesingen ble avbrutt.');};
 async function readImage(image){
 const canvas=prepareReceipt(image);
 const rank=r=>{const d=parseReceiptText(r.text);return (r.confidence||0)+[d.purchase_date,d.gross,d.net,d.vat,d.organization_number,d.vendor].filter(v=>v!==null).length*12+(d.vat_rates.length?24:0);};
 const scan=async(source,options={})=>{const result=(await worker.recognize(source,options,{text:true,blocks:true})).data;const layout={...result,text:receiptLines(result.blocks)};return layout.text&&rank(layout)>rank(result)?layout:result;};
 try{
 check();await worker.setParameters({tessedit_pageseg_mode:'4',preserve_interword_spaces:'1',user_defined_dpi:'300'});
 const first=await scan(canvas);

 if(first.confidence>=85&&['gross','vat','purchase_date'].every(k=>parseReceiptText(first.text)[k]!==null))return first.text;
 check();onProgress('Forbedrer lesingen i mindre deler …');
 await worker.setParameters({tessedit_pageseg_mode:'6'});
 // Split at whitespace so no printed line is cut between two passes.
 const ctx=canvas.getContext('2d',{willReadFrequently:true});let pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 const cuts=[0];const parts=Math.min(4,Math.max(1,Math.ceil(canvas.height/(canvas.width*1.3))));
 for(let p=1;p<parts;p++){
 const center=Math.round(canvas.height*p/parts),radius=Math.round(Math.min(100,canvas.height/parts*.12));let best=center,score=Infinity;
 for(let y=Math.max(1,center-radius);y<Math.min(canvas.height-1,center+radius);y++){
 let ink=0;for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4]<140)ink++;
 const cost=ink+Math.abs(y-center)*.005;if(cost<score){score=cost;best=y;}
 }cuts.push(best);
 }cuts.push(canvas.height);pixels=null;
 let text='',confidence=0;
 for(let i=0;i<cuts.length-1;i++){check();onProgress('Leser del '+(i+1)+' av '+(cuts.length-1));const result=await scan(canvas,{rectangle:{left:0,top:cuts[i],width:canvas.width,height:cuts[i+1]-cuts[i]}});text+=result.text+'\n';confidence+=(result.confidence||0)/(cuts.length-1);}
 const second={text,confidence};let best=rank(second)>rank(first)?second:first;
 if(parseReceiptText(best.text).net===null||parseReceiptText(best.text).vat===null){
 check();onProgress('Forbedrer kontrast og kontrollerer beløp …');
 // Correct uneven lighting and align photographed receipts before retrying.
 const normalized=normalizedReceipt(canvas);
 try{await worker.setParameters({tessedit_pageseg_mode:'6'});const third=await scan(normalized);if(rank(third)>rank(best))best=third;
 if(parseReceiptText(best.text).gross===null){check();await worker.setParameters({tessedit_pageseg_mode:'11'});const sparse=await scan(normalized);if(rank(sparse)>rank(best))best=sparse;}
 }finally{normalized.width=normalized.height=0;}
 if(parseReceiptText(best.text).vat===null&&image.width<700){
 check();onProgress('Leser mørk tekst uten fargede markeringer …');const ink=prepareReceipt(image,true);
 try{await worker.setParameters({tessedit_pageseg_mode:'6'});const clean=await scan(ink);if(rank(clean)>rank(best))best=clean;}finally{ink.width=ink.height=0;}
 }
 }return best.text;
 }finally{canvas.width=canvas.height=0;}
 }
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
 try{text+=await readImage(canvas)+'\n';}finally{canvas.width=canvas.height=0;page.cleanup();}
 }
 return text;
 }
 if(!['image/png','image/jpeg','image/heic','image/heif'].includes(mime))throw Error('Filtypen støttes ikke av tekstleseren.');
 let image;try{image=await createImageBitmap(blob);}catch{throw Error('Nettleseren kan ikke lese dette bildet. Last opp JPG eller PNG i stedet for HEIC.');}
 try{
 if(image.width*image.height>60000000)throw Error('Bildet er for stort. Bruk lavere oppløsning.');
 return await readImage(image);
 }finally{image.close();}
 })();
 try{
 return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Tekstlesingen tok for lang tid. Prøv et tydeligere bilde.'));},120000);})]);
 }finally{clearTimeout(timer);await worker?.terminate();await pdf?.destroy();}
}


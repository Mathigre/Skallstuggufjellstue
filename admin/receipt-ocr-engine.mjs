import {receiptLines} from './receipt-layout.mjs?v=20261018-speed1';
import {prepareReceipt,normalizedReceipt} from './receipt-image.mjs?v=20261018-speed1';
import {parseReceiptText} from './receipt-ocr.mjs?v=20261018-scribeparse1';
const VERSION='6.0.1';
let loading,workerPromise,active=false,progressSink=()=>{};
export function loadOCR(){
 if(window.Tesseract)return Promise.resolve(window.Tesseract);
 if(!loading)loading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@'+VERSION+'/dist/tesseract.min.js';script.crossOrigin='anonymous';
  script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(Error('Tekstleseren kunne ikke starte.'));
  script.onerror=()=>{script.remove();loading=null;reject(Error('Kunne ikke laste tekstleseren. Kontroller nettforbindelsen.'));};document.head.append(script);
 });
 return loading;
}
async function getWorker(){
 if(!workerPromise){
  workerPromise=(async()=>{
   progressSink('Laster tekstmotor og norsk språkdata …');
   const T=await loadOCR();
   return T.createWorker('nor+eng',1,{
    workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@'+VERSION+'/dist/worker.min.js',
    corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
    langPath:'https://tessdata.projectnaptha.com/4.0.0_fast',
    logger:m=>{
     if(m.status==='recognizing text')progressSink('Leser tekst',Math.round((m.progress||0)*100));
     else if(m.status)progressSink('Klargjør tekstmotor: '+m.status);
    }
   });
  })().catch(error=>{workerPromise=null;throw error;});
 }
 return workerPromise;
}
export async function prepareOCR(onProgress=()=>{}){
 const previous=progressSink;progressSink=(message,percent)=>onProgress(message,percent);
 try{await getWorker();}finally{progressSink=previous;}
}
export async function recognizeReceipt(blob,mime,onProgress=()=>{}){
 if(active)throw Error('En tekstlesing pågår allerede.');
 active=true;
 const previous=progressSink;progressSink=(message,percent)=>onProgress(message,percent);
 let worker,pdf,timer,expired=false;
 const check=()=>{if(expired)throw Error('Tekstlesingen ble avbrutt.');};
 const cleanupCanvas=canvas=>{if(canvas){canvas.width=0;canvas.height=0;}};
 async function readImage(image,pageIndex=0,pageCount=1){
  const canvas=prepareReceipt(image);
  const scan=async source=>{
   check();
   const data=(await worker.recognize(source,{rectangle:undefined},{text:true,blocks:true})).data;
   const raw={...data,text:data.text||''},layout={...data,text:receiptLines(data.blocks)};
   const score=result=>{const d=parseReceiptText(result.text);return (result.confidence||0)+[d.purchase_date,d.gross,d.net,d.vat,d.organization_number,d.vendor].filter(v=>v!==null).length*12+(d.vat_rates.length?24:0);};
   return layout.text&&score(layout)>score(raw)?layout:raw;
  };
  try{
   check();
   await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',user_defined_dpi:'300'});
   progressSink('Leser kvitteringen',0);
   const first=await scan(canvas);
   const firstData=parseReceiptText(first.text);
   const essentialMissing=firstData.gross===null||firstData.net===null||firstData.vat===null;
   let best=first;
   if(essentialMissing&&(first.confidence||0)<62){
    check();progressSink('Forbedrer kontrast for beløpene …',null);
    const normalized=normalizedReceipt(canvas);
    try{
     await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
     const second=await scan(normalized);
     const score=result=>{const d=parseReceiptText(result.text);return (result.confidence||0)+[d.purchase_date,d.gross,d.net,d.vat,d.organization_number,d.vendor].filter(v=>v!==null).length*12+(d.vat_rates.length?24:0);};
     if(score(second)>score(best))best=second;
    }finally{cleanupCanvas(normalized);}
   }
   const offset=pageIndex/pageCount*100,span=100/pageCount;
   progressSink('Side '+(pageIndex+1)+' av '+pageCount+' ferdig',Math.round(offset+span));
   return best.text;
  }finally{cleanupCanvas(canvas);}
 }
 const work=(async()=>{
  worker=await getWorker();check();
  if(mime==='application/pdf'){
   progressSink('Åpner PDF …',null);
   const lib=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
   lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
   pdf=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false}).promise;
   if(pdf.numPages>3)throw Error('PDF kan ha maks 3 sider.');
   let text='';
   for(let i=1;i<=pdf.numPages;i++){
    progressSink('Forbereder PDF-side '+i+' av '+pdf.numPages+' …',Math.round((i-1)/pdf.numPages*100));
    const page=await pdf.getPage(i),natural=page.getViewport({scale:1),scale=Math.min(1.8,1800/natural.width,Math.sqrt(6000000/(natural.width*natural.height))),view=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
    try{text+=await readImage(canvas,i-1,pdf.numPages)+'\n';}finally{cleanupCanvas(canvas);page.cleanup();}
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
  return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;progressSink('Skanningen nådde tidsgrensen.',null);reject(Error('Tekstlesingen tok over 45 sekunder. Prøv et mindre bilag eller kjør den med Scribe.'));},45000);})]);
 }catch(error){
  if(workerPromise){const doomed=workerPromise;workerPromise=null;doomed.then(w=>w.terminate()).catch(()=>{});}
  throw error;
 }finally{
  clearTimeout(timer);await pdf?.destroy();progressSink=previous;active=false;
 }
}

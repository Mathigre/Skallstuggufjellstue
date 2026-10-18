import {parseReceiptText} from './receipt-ocr-fast.mjs';
import {loadOCR,prepareOCR,recognizeReceipt} from './receipt-ocr-engine.mjs?v=20261018-speed1';
import {emptyData,normalizeData,validateData,textFields,moneyFields} from './receipt-data.mjs';
const $=id=>document.getElementById(id),endpoint='https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/receipt-analyze';
const fikenEndpoint='https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/fiken-receipt';
let receipts=[],current=null,settings={},dirty=false,busy=false,fikenState=null,fikenLoaded=false;
const retryableFiken=()=>fikenState?.state==='error'&&!fikenState.draft_id&&['FIKEN_REJECTED','CHECKED_NO_DRAFT'].includes(fikenState.error_code);
async function fikenApi(body){
 const response=await fetch(fikenEndpoint,{method:'POST',headers:await window.adminHeaders(),body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Fiken-eksporten feilet.');return result;
}
async function loadFikenStatus(){
 fikenLoaded=false;syncButtons();
 try{const result=await fikenApi({action:'status',id:current.id});fikenState=result.export;fikenLoaded=true;}
 catch{$('fikenStatus').textContent='Kunne ikke hente eksportstatus. Sending deaktivert.';return;}
 syncButtons();
}
const labels={vendor:'Leverandør',organization_number:'Organisasjonsnummer',purchase_date:'Kjøpsdato',currency:'Valuta',payment_method:'Betalingsmetode',category:'Kategori (forslag)',account:'Konto (forslag)',notes:'Notater',net:'Beløp ekskl. MVA',vat:'MVA',gross:'Totalbeløp inkl. MVA',rounding:'Avrunding'};
const say=(message,error=false)=>{$('status').textContent=message;$('status').className=error?'error':'';};
function setProgress(message,percent=null){say(message);const box=$('ocrProgress'),bar=$('ocrProgressBar');if(!box||!bar)return;box.hidden=false;$('ocrProgressLabel').textContent=message;if(Number.isFinite(percent)){bar.value=Math.max(0,Math.min(100,percent));bar.setAttribute('aria-valuetext',Math.round(bar.value)+' %');}else{bar.removeAttribute('value');bar.removeAttribute('aria-valuetext');}}
function parseReceiptTextWithFallback(text){
 const d=parseReceiptText(text),lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const amounts=line=>[...new Set([...line.matchAll(/(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\s*\d{2}/g)].map(m=>{const raw=m[0].replace(/\s/g,'');return Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw);}))];
 const totalLines=lines.filter(line=>/\btotal\b/i.test(line)&&/\b(?:moms|mva)\b/i.test(line));
 const totals=[...new Set(totalLines.flatMap(amounts))];
 const explicitGross=totals.length===1?totals[0]:null;
 if(explicitGross!=null&&(d.gross==null||Math.abs(d.gross-explicitGross)>.03))d.gross=explicitGross;
 if(d.vendor==null&&(/\bELKJ[ØO]P\b/i.test(lines.slice(0,15).join(' '))||String(d.organization_number||'').replace(/\D/g,'')==='947054600'))d.vendor='Elkjøp Norge';
 const header=lines.findIndex(line=>/(?:mva|moms|muin[gs])/i.test(line)&&/grunnlag/i.test(line)&&/(?:total|lotal|jotul)/i.test(line));
 if(d.gross!=null&&header>=0){
  for(const line of lines.slice(header+1,header+9)){
   const match=line.match(/(?:^|\s)(\d{1,2})(?:[,.]0{1,2})?\s*%/);if(!match)continue;
   const tail=line.slice(match.index+match[0].length);let values=amounts(tail);
   if(values.length!==3){
    const tokens=[...tail.matchAll(/\b[\dOQIl|Bb]{5,7}\b/g)].map(m=>Number(m[0].replace(/[OQ]/g,'0').replace(/[Il|]/g,'1').replace(/[Bb]/g,'8'))/100);
    if(tokens.length!==3)continue;values=tokens;
   }
   const [net,vat,gross]=values;if(Math.abs(Math.round((net+vat-gross)*100))>2||Math.abs(Math.round((gross-d.gross)*100))>2)continue;
   const rates=[0,10,12,15,25].filter(rate=>Math.abs(Math.round((net*rate/100-vat)*100))<=3);if(rates.length!==1)continue;
   d.net=net;d.vat=vat;d.vat_rates=[{rate:rates[0],net,vat,gross}];
   d.uncertainties=[...new Set([...d.uncertainties,'Beløpsraden ble kontrollert matematisk mot totalen. Bekreft likevel mot originalbilaget.'])];
   break;
  }
 }
 if(d.gross!=null&&(!d.vat_rates?.length||d.net==null||d.vat==null)){
  const rates=[...new Set([...text.matchAll(/\b(0|10|12|15|25)\s*%/g)].map(m=>Number(m[1])))];
  if(rates.length===1){const rate=rates[0];d.net=Math.round(d.gross/(1+rate/100)*100)/100;d.vat=Math.round((d.gross-d.net)*100)/100;d.vat_rates=[{rate,net:d.net,vat:d.vat,gross:d.gross}];d.uncertainties=[...new Set([...d.uncertainties,'Netto og MVA er beregnet fra én tydelig sats i MVA-tabellen. Kontroller mot originalbilaget.'])];}
 }
 if(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(text)&&d.purchase_date){
  d.purchase_date=null;d.uncertainties=[...new Set([...d.uncertainties,'Kvitteringen inneholder flere mulige datoer. Kontroller kjøpsdatoen manuelt.'])];
 }
 d.notes=null;return d;
}
const scribeFrame=$('scribeFrame');
let scribeReady=false,scribePending=null,scribeLoadPromise=null;
function waitForScribe(){
 if(scribeReady)return Promise.resolve();
 if(scribeLoadPromise)return scribeLoadPromise;
 scribeLoadPromise=new Promise((resolve,reject)=>{
  const onLoad=()=>{clearTimeout(timeout);scribeReady=true;resolve();};
  const timeout=setTimeout(()=>{scribeFrame.removeEventListener('load',onLoad);reject(Error('Scribe-skanneren kunne ikke lastes. Oppdater siden og prøv igjen.'));},20000);
  scribeFrame.addEventListener('load',onLoad,{once:true});
  scribeFrame.src=scribeFrame.dataset.src;
 }).finally(()=>{scribeLoadPromise=null;});
 return scribeLoadPromise;
}
function recognizeWithScribe(file,name){
 return waitForScribe().then(()=>new Promise((resolve,reject)=>{
  if(scribePending)return reject(Error('En Scribe-skanning pågår allerede.'));
  const timeout=setTimeout(()=>{scribePending=null;reject(Error('Scribe brukte for lang tid. Prøv et mindre eller skarpere bilag.'));},180000);
  scribePending={resolve,reject,timeout};
  scribeFrame.contentWindow.postMessage({type:'skallstuggu:scribe:scan',file,name},location.origin);
 }));
}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==scribeFrame.contentWindow)return;
 const message=event.data;if(!message||typeof message.type!=='string')return;
 if(message.type==='skallstuggu:scribe:status'&&typeof message.text==='string'){setProgress(message.text,Number.isFinite(message.progress)?message.progress:null);return;}
 if(!scribePending)return;
 const pending=scribePending;scribePending=null;clearTimeout(pending.timeout);
 if(message.type==='skallstuggu:scribe:result'&&typeof message.text==='string')pending.resolve(message.text);
 else if(message.type==='skallstuggu:scribe:error')pending.reject(Error(typeof message.text==='string'?message.text:'Scribe klarte ikke å lese bilaget.'));
});
async function api(body){
 const headers=await window.adminHeaders();if(body instanceof FormData)delete headers['Content-Type'];
 const response=await fetch(endpoint,{method:'POST',headers,body:body instanceof FormData?body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Forespørselen feilet.');return result;
}
async function run(task){
 if(busy)return;busy=true;document.querySelectorAll('button:not(:disabled)').forEach(b=>{b.dataset.working='1';b.disabled=true;});
 syncButtons();
 try{await task();}catch(e){say(e.message,true);}finally{busy=false;if($('ocrProgress'))$('ocrProgress').hidden=true;document.querySelectorAll('[data-working]').forEach(b=>{b.disabled=false;delete b.dataset.working;});syncButtons();}
}
function fikenBlockReason(){
 if(!current)return 'Velg en kvittering først.';
 if(!fikenLoaded)return 'Henter Fiken-status …';
 if(current.deleted_at)return 'Gjenopprett kvitteringen før du sender et testutkast.';
 if(fikenState?.state==='processing')return 'Fiken-sending pågår. Vent til status er avklart.';
 if(fikenState?.state==='uncertain')return 'Usikkert resultat: kontroller testforetaket apiskallstuggu før du prøver igjen.';
 if(fikenState?.draft_id||fikenState?.state==='ready'||fikenState?.state==='draft_created')return 'Det finnes allerede et Fiken-utkast for denne kvitteringen. Velg en annen kvittering for neste test.';
 if(fikenState&&!retryableFiken())return 'Fiken-statusen må avklares før ny test. Oppdater siden eller kontroller Fiken.';
 if(busy)return 'Vent til gjeldende handling er ferdig.';
 if(dirty)return 'Lagre endringene først. For Fiken-test må bilaget også lagres som kontrollert.';
 if(current.review_status!=='approved'){
  const validation=validateData(readForm());
  const missing=[...validation.errors];
  if(!readForm().account||!/^\d{4}$/.test(readForm().account))missing.push('Fyll inn en firesifret kostnadskonto.');
  return 'Kontroller bilaget, fyll inn manglende opplysninger ('+[...new Set(missing)].join(' ')+'), og velg «Lagre som kontrollert» først.';
 }
 const d=readForm(),validation=validateData(d);
 if(validation.errors.length)return 'Fiken-testen er sperret: '+validation.errors.join(' ');
 if(!d.account||!/^\d{4}$/.test(d.account))return 'Fyll inn en firesifret kostnadskonto før Fiken-testen.';
 if(d.currency!=='NOK')return 'Denne testversjonen støtter bare NOK.';
 if(!d.vat_rates.length||d.vat_rates.some(row=>![0,12,15,25].includes(Number(row.rate))))return 'Fullstendig MVA-fordeling med sats 0, 12, 15 eller 25 % kreves.';
 return null;
}
function syncButtons(){
 if(!current)return;
 const deleted=!!current.deleted_at;
 $('delete').hidden=deleted;$('restore').hidden=!deleted;
 $('analyze').disabled=busy||deleted||current.review_status==='approved';
 $('analyzeScribe').disabled=busy||deleted||current.review_status==='approved';
 $('analyzeBoth').disabled=busy||deleted||current.review_status==='approved';
 $('analyze').textContent='Les tekst gratis';
 $('receiptForm').querySelectorAll('input,textarea,button').forEach(e=>e.disabled=e.hasAttribute('data-permanent-disabled')||busy||deleted);
 $('analysisHint').textContent='Tekstlesingen skjer på enheten. Forslag må kontrolleres og lagres manuelt.';
 const fikenReason=fikenBlockReason();
 $('fikenExport').disabled=!!fikenReason;
 $('fikenExport').title=fikenReason||'Opprett et enkelt testutkast i apiskallstuggu. Det bokføres ikke.';
 $('fikenStatus').textContent=fikenReason||'Testforetak apiskallstuggu · kun utkast, ingen bokføring eller betaling.';
}
function elem(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
function renderList(){
 const q=$('search').value.toLocaleLowerCase('nb'),filter=$('filter').value;
 const visible=receipts.filter(r=>{
 const d=r.reviewed_data||{};
 return (filter==='deleted'?r.deleted_at:!r.deleted_at)&&
 (filter==='approved'?r.review_status==='approved':filter==='new'?!r.reviewed_data:filter==='draft'?r.review_status!=='approved':true)&&
 [r.original_name,d.vendor,d.purchase_date,d.category].join(' ').toLocaleLowerCase('nb').includes(q);
 });
 $('receiptList').replaceChildren();
 for(const r of visible){
 const d=r.reviewed_data||{},row=elem('div',null,'receipt-row'),title=elem('div');
 title.append(elem('strong',d.vendor||r.original_name),elem('small',[d.purchase_date||'Dato mangler',d.gross!=null?d.gross.toLocaleString('nb-NO',{minimumFractionDigits:2})+' '+(d.currency||''):'Beløp mangler',r.synthetic?'Testbilag':''].filter(Boolean).join(' · ')));
 const button=elem('button','Åpne','secondary');button.onclick=()=>{if(canLeave())run(()=>openReceipt(r.id));};
 row.append(title,elem('span',r.deleted_at?'Papirkurv':r.review_status==='approved'?'Kontrollert':r.reviewed_data?'Til kontroll':'Ikke lest lokalt','badge'),button);$('receiptList').append(row);
 }
 if(!visible.length)$('receiptList').append(elem('p','Ingen kvitteringer i denne visningen.'));
}
async function loadList(){
 receipts=[];let page=0,more=true;
 while(more){const r=await api({action:'list',page});receipts.push(...r.receipts);settings=r.settings;more=r.more;page++;}
 $('mode').textContent=settings.real_documents_enabled?'Kvitteringsarkiv':'Testmodus – bruk kun syntetiske bilag';
 $('testConsent').hidden=settings.real_documents_enabled;
 $('quota').textContent='Tesseract · ingen betaling per skanning. Privat lagring bruker fortsatt Supabase.';
 renderList();
}
const rowFields={vat:['rate','net','vat','gross'],item:['description','quantity','unit_price','gross','vat_rate']};
function addRow(kind,data={}){
 const tr=elem('tr');
 for(const key of rowFields[kind]){
 const td=elem('td'),input=elem('input');input.type=key==='description'?'text':'number';input.step='any';input.dataset.key=key;input.value=data[key]??'';input.setAttribute('aria-label',key);td.append(input);tr.append(td);
 }
 const td=elem('td'),remove=elem('button','×','secondary');remove.type='button';remove.setAttribute('aria-label','Fjern linje');remove.onclick=()=>{tr.remove();changed();};td.append(remove);tr.append(td);$(kind==='vat'?'vatRows':'itemRows').append(tr);
}
function renderForm(data){
 const d=normalizeData(data||emptyData());$('fields').replaceChildren();
 for(const key of [...textFields,...moneyFields]){
 const label=elem('label',labels[key]),input=elem(key==='notes'?'textarea':'input');input.id='field-'+key;
 if(key!=='notes')input.type=moneyFields.includes(key)?'number':key==='purchase_date'?'date':'text';
 if(moneyFields.includes(key))input.step='0.01';input.value=d[key]??'';label.append(input);$('fields').append(label);
 }
 $('vatRows').replaceChildren();$('itemRows').replaceChildren();d.vat_rates.forEach(r=>addRow('vat',r));d.items.forEach(r=>addRow('item',r));
 $('uncertainties').value=d.uncertainties.join('\n');$('confirmed').checked=false;dirty=false;showValidation();
}
function readForm(){
 const d=emptyData();for(const k of textFields)d[k]=$('field-'+k).value.trim()||null;for(const k of moneyFields)d[k]=$('field-'+k).value===''?null:Number($('field-'+k).value);
 for(const [kind,target] of [['vat','vat_rates'],['item','items']])d[target]=[...$(kind==='vat'?'vatRows':'itemRows').rows].map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(i=>[i.dataset.key,i.value===''?null:i.type==='number'?Number(i.value):i.value])));
 d.uncertainties=$('uncertainties').value.split('\n').map(s=>s.trim()).filter(Boolean);return d;
}
function showValidation(){
 $('validation').replaceChildren();try{
 const result=validateData(readForm());
 for(const e of result.errors)$('validation').append(elem('p',e,'error'));
 for(const e of result.warnings)$('validation').append(elem('p',e,'warning'));
 if(!result.errors.length)$('validation').append(elem('p','Beløpene summerer. Kontroller opplysningene mot originalen.'));
 }catch(e){$('validation').append(elem('p',e.message,'error'));}
}
function changed(){dirty=true;$('confirmed').checked=false;showValidation();syncButtons();}
function mergeReceiptResults(preferred,fallback){
 const merged={...preferred},conflicts=[];
 for(const key of [...textFields,...moneyFields]){
  const a=merged[key],b=fallback[key];
  if((a==null||a==='')&&b!=null&&b!=='')merged[key]=b;
  else if(a!=null&&b!=null&&a!==''&&b!==''&&(moneyFields.includes(key)?Math.round(Number(a)*100)!==Math.round(Number(b)*100):a!==b))conflicts.push(labels[key]||key);
 }
 if(!merged.vat_rates.length&&fallback.vat_rates.length)merged.vat_rates=fallback.vat_rates;
 else if(merged.vat_rates.length&&fallback.vat_rates.length&&JSON.stringify(merged.vat_rates)!==JSON.stringify(fallback.vat_rates))conflicts.push('MVA-fordeling');
 if(!merged.items.length&&fallback.items.length)merged.items=fallback.items;
 const inferred=preferred.uncertainties.some(x=>x.includes('beregnet fra totalbeløpet'));
 if(inferred&&fallback.net!=null&&fallback.vat!=null&&fallback.vat_rates.length){
  merged.net=fallback.net;merged.vat=fallback.vat;merged.vat_rates=fallback.vat_rates;
  merged.uncertainties=merged.uncertainties.filter(x=>!x.includes('beregnet fra totalbeløpet'));
 }
 merged.uncertainties=[...new Set([...merged.uncertainties,...fallback.uncertainties,...conflicts.map(x=>'Scribe og Tesseract foreslår ulike verdier for '+x+'. Kontroller mot originalen.')])];
 return merged;
}
$('receiptForm').addEventListener('input',e=>{if(e.target.id!=='confirmed')changed();});
function canLeave(){return !dirty||confirm('Du har ulagrede rettelser. Vil du forkaste dem?');}
async function openReceipt(id,keepForm=false){
 const result=await api({action:'get',id});current=result.receipt;fikenState=null;fikenLoaded=false;
 if(!current.deleted_at&&['application/pdf','image/jpeg','image/png'].includes(current.mime_type))void prepareOCR().catch(()=>{});
 $('detail').hidden=false;$('fileTitle').textContent=current.original_name;
 $('original').href=result.url;$('preview').replaceChildren();
 if(['image/jpeg','image/png'].includes(current.mime_type)){const img=elem('img');img.src=result.url;img.alt='Original kvittering';$('preview').append(img);}
 else if(current.mime_type==='application/pdf'){const frame=elem('iframe');frame.src=result.url;frame.title='Original PDF-kvittering';$('preview').append(frame);}
 else $('preview').append(elem('p','HEIC-forhåndsvisning støttes ikke i alle nettlesere. Åpne originalfilen for kontroll.'));
 if(!keepForm){renderForm(current.reviewed_data||emptyData());$('ocrResult').hidden=true;$('ocrText').value='';}
 syncButtons();await loadFikenStatus();$('detail').focus({preventScroll:true});
}
async function upload(fileList){
 if(!settings.real_documents_enabled&&!$('synthetic').checked)throw Error('Bekreft at filene er syntetiske testkvitteringer.');
 const files=Array.from(fileList);if(files.length>20)throw Error('Velg maks 20 filer om gangen.');
 let last=null,failed=0;const failures=[];
 for(const [index,file] of files.entries()){
 say('Lagrer '+(index+1)+' av '+files.length+': '+file.name);
 try{
 if(file.size>10485760)throw Error('Filen er over 10 MB.');
 const form=new FormData();form.append('file',file);form.append('synthetic',String($('synthetic').checked));
 last=(await api(form)).receipt.id;
 }catch(e){failed++;failures.push(file.name+': '+e.message);}
 }
 await loadList();if(last)await openReceipt(last);
 for(const message of failures)$('receiptList').prepend(elem('p',message,'error'));
 say((files.length-failed)+' av '+files.length+' filer lagret. '+(failed?'Noen filer feilet eller finnes allerede. ':'')+'Ingen analyser er startet.',failed>0);
}
$('uploadButton').onclick=()=>{if(canLeave())$('files').click();};
for(const id of ['files'])$(id).onchange=()=>{const files=Array.from($(id).files);$(id).value='';run(()=>upload(files));};
$('search').oninput=renderList;$('filter').onchange=renderList;
$('refresh').onclick=()=>{if(canLeave())run(async()=>{await loadList();if(current)await openReceipt(current.id);say('Oppdatert.');});};
$('closeDetail').onclick=()=>{if(canLeave()){$('detail').hidden=true;current=null;dirty=false;}};
$('renewPreview').onclick=()=>run(()=>openReceipt(current.id,true));
$('addVat').onclick=()=>{addRow('vat');changed();};$('addItem').onclick=()=>{addRow('item');changed();};
$('analyzeScribe').onclick=()=>{
 if(!canLeave())return;
 run(async()=>{
  if(!['application/pdf','image/jpeg','image/png'].includes(current.mime_type))throw Error('Scribe støtter PDF, JPG og PNG her. Bruk Tesseract som reserve for HEIC.');
  setProgress('Starter lokal Scribe-lesing …');
  const fresh=await api({action:'get',id:current.id});
  const response=await fetch(fresh.url);
  if(!response.ok)throw Error('Kunne ikke hente originalen. Åpne kvitteringen på nytt.');
  const blob=await response.blob();
  const name=/\.(pdf|png|jpe?g)$/i.test(current.original_name)?current.original_name:current.original_name+'.'+({ 'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg' }[current.mime_type]);
  const text=await recognizeWithScribe(blob,name);
  if(!text.trim())throw Error('Scribe fant ingen lesbar tekst. Prøv et skarpere bilde eller Tesseract.');
  const parsed=parseReceiptTextWithFallback(text);renderForm(parsed);dirty=true;
  $('ocrText').value=text;$('ocrResult').hidden=false;
  const missing=[['purchase_date','dato'],['gross','totalbeløp'],['net','netto'],['vat','MVA']].filter(([key])=>parsed[key]===null).map(([,label])=>label);
  say(missing.length?'Scribe leste teksten delvis. Mangler '+missing.join(', ')+'. Kontroller originalen eller bruk reserveverktøyet.':'Scribe leste teksten lokalt. Kontroller alle forslag, MVA-fordelingen og leverandørnavnet mot originalbilaget.');
 });
};
$('analyzeBoth').onclick=()=>{
 if(!canLeave())return;
 run(async()=>{
  if(!['application/pdf','image/jpeg','image/png'].includes(current.mime_type))throw Error('Kombinert lesing støtter PDF, JPG og PNG. Bruk Tesseract alene for HEIC.');
  setProgress('Henter originalbilaget …',0);
  const fresh=await api({action:'get',id:current.id}),response=await fetch(fresh.url);
  if(!response.ok)throw Error('Kunne ikke hente originalen. Åpne kvitteringen på nytt.');
  const blob=await response.blob(),name=/\.(pdf|png|jpe?g)$/i.test(current.original_name)?current.original_name:current.original_name+'.'+({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg'}[current.mime_type]);
  let scribeText='',tesseractText='',scribeData=emptyData(),tesseractData=emptyData(),failures=[];
  try{
   setProgress('Leser med Scribe lokalt …');
   scribeText=await recognizeWithScribe(blob,name);
   if(!scribeText.trim())throw Error('Scribe fant ingen lesbar tekst.');
   scribeData=parseReceiptTextWithFallback(scribeText);
  }catch(e){failures.push('Scribe: '+e.message);}
  try{
   setProgress('Kontrollerer feltene med Tesseract …',0);
   tesseractText=await recognizeReceipt(blob,current.mime_type,(message,percent)=>setProgress('Tesseract: '+message,percent));
   if(!tesseractText.trim())throw Error('Tesseract fant ingen lesbar tekst.');
   tesseractData=parseReceiptTextWithFallback(tesseractText);
  }catch(e){failures.push('Tesseract: '+e.message);}
  if(!scribeText&&!tesseractText)throw Error(failures.join(' ')||'Ingen lesbar tekst funnet.');
  const parsed=mergeReceiptResults(scribeData,tesseractData);
  renderForm(parsed);dirty=true;
  $('ocrText').value=[scribeText?'--- Scribe.js ---\n'+scribeText:'',tesseractText?'--- Tesseract ---\n'+tesseractText:''].filter(Boolean).join('\n\n');
  $('ocrResult').hidden=false;
  const missing=[['purchase_date','dato'],['gross','totalbeløp'],['net','netto'],['vat','MVA']].filter(([key])=>parsed[key]===null).map(([,label])=>label);
  say(failures.length?'Lesingen ble delvis fullført. '+failures.join(' ')+' Kontroller alle forslag.':missing.length?'Begge lesingene er ferdige. Mangler '+missing.join(', ')+'. Kontroller råtekst og originalbilag.':'Begge lesingene er ferdige. Kontroller forslagene og eventuelle avvik mot originalbilaget.');
 });
};
$('analyze').onclick=()=>{
 if(!canLeave())return;
 run(async()=>{
 say('Starter lokal tekstlesing …');
 const fresh=await api({action:'get',id:current.id});
 const response=await fetch(fresh.url);
 if(!response.ok)throw Error('Kunne ikke hente originalen. Åpne kvitteringen på nytt.');
 const text=await recognizeReceipt(await response.blob(),current.mime_type,(message,percent)=>setProgress(message,percent));
 if(!text.trim())throw Error('Ingen lesbar tekst funnet. Ta et tydeligere bilde eller fyll inn manuelt.');
 const parsed=parseReceiptTextWithFallback(text);renderForm(parsed);dirty=true;
 $('ocrText').value=text;$('ocrResult').hidden=false;
 const missing=[['purchase_date','dato'],['gross','totalbeløp'],['net','netto'],['vat','MVA']].filter(([key])=>parsed[key]===null).map(([,label])=>label);
 say(missing.length?'Teksten er delvis lest. Mangler '+missing.join(', ')+'. Prøv et skarpere bilde eller fyll inn manuelt.':'Teksten er lest lokalt. Kontroller forslagene, MVA-fordelingen og leverandørnavnet før du lagrer.');
 });
};
async function save(action){
 const data=readForm(),validation=validateData(data);
 if(action==='approve'&&(validation.errors.length||!$('confirmed').checked))throw Error(validation.errors.join(' ')||'Bekreft kontroll mot originalbilaget.');
 const result=await api({action,id:current.id,revision:current.revision,data,confirmed:$('confirmed').checked});
 current=result.receipt;dirty=false;await loadList();await openReceipt(current.id);say(action==='approve'?'Lagret som kontrollert. Ikke sendt til Fiken.':'Utkastet er lagret.');
}
$('fikenExport').onclick=()=>{
 if(!current||!fikenLoaded||dirty||current.review_status!=='approved'||(fikenState&&!retryableFiken()))return;
 if(!confirm('Opprette kjøpsutkast med originalbilaget i apiskallstuggu (test)? Ingen bokføring eller betaling utføres.'))return;
 run(async()=>{try{const result=await fikenApi({action:'create_draft',id:current.id,revision:current.revision});say('Kjøpsutkast #'+result.draftId+' med vedlegg er bekreftet i apiskallstuggu.');}finally{await loadFikenStatus();}});
};
$('receiptForm').onsubmit=e=>{e.preventDefault();run(()=>save('save'));};$('approve').onclick=()=>run(()=>save('approve'));
for(const action of ['delete','restore'])$(action).onclick=()=>{if(canLeave()&&confirm(action==='delete'?'Flytt kvitteringen til papirkurven? Originalfilen beholdes.':'Gjenopprette kvitteringen?'))run(async()=>{await api({action,id:current.id,revision:current.revision});dirty=false;await openReceipt(current.id);await loadList();say(action==='delete'?'Flyttet til papirkurven.':'Gjenopprettet.');});};
$('checkModel').onclick=()=>run(async()=>{await loadOCR();$('modelStatus').textContent=' Tekstleseren er lastet. Ingen API-nøkkel nødvendig.';});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
if(await window.adminReady)run(async()=>{await loadList();say('Klar. Last opp en kvittering for å begynne.');});

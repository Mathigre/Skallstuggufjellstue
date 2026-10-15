import {parseReceiptText} from './receipt-ocr.mjs?v=20261015c';
import {loadOCR,recognizeReceipt} from './receipt-ocr-engine.mjs?v=20261015c';
import {emptyData,normalizeData,validateData,textFields,moneyFields} from './receipt-data.mjs';
const $=id=>document.getElementById(id),endpoint='https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/receipt-analyze';
let receipts=[],current=null,runs=[],settings={},dirty=false,busy=false;
const labels={vendor:'Leverandør',organization_number:'Organisasjonsnummer',purchase_date:'Kjøpsdato',currency:'Valuta',payment_method:'Betalingsmetode',category:'Kategori (forslag)',account:'Konto (forslag)',notes:'Notater',net:'Beløp ekskl. MVA',vat:'MVA',gross:'Totalbeløp inkl. MVA',rounding:'Avrunding'};
const statusLabels={new:'Ikke analysert',processing:'Analyserer',ready:'Til kontroll',error:'Analyse feilet'};
const say=(message,error=false)=>{$('status').textContent=message;$('status').className=error?'error':'';};
async function api(body){
 const headers=await window.adminHeaders();if(body instanceof FormData)delete headers['Content-Type'];
 const response=await fetch(endpoint,{method:'POST',headers,body:body instanceof FormData?body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Forespørselen feilet.');return result;
}
async function run(task){
 if(busy)return;busy=true;document.querySelectorAll('button:not(:disabled)').forEach(b=>{b.dataset.working='1';b.disabled=true;});
 syncButtons();
 try{await task();}catch(e){say(e.message,true);}finally{busy=false;document.querySelectorAll('[data-working]').forEach(b=>{b.disabled=false;delete b.dataset.working;});syncButtons();}
}
function syncButtons(){
 if(!current)return;
 const deleted=!!current.deleted_at,processing=current.ai_status==='processing';
 $('recover').hidden=!processing;
 $('delete').hidden=deleted;$('restore').hidden=!deleted;
 $('analyze').disabled=busy||deleted||processing||current.review_status==='approved';
 $('analyze').textContent='Les tekst gratis';
 $('receiptForm').querySelectorAll('input,textarea,button').forEach(e=>e.disabled=e.hasAttribute('data-permanent-disabled')||busy||deleted||processing);
 $('applyAI').hidden=!current.ai_data||!current.reviewed_data;
 $('analysisHint').textContent='Tekstlesingen skjer på enheten. Forslag må kontrolleres og lagres manuelt.';
}
function elem(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
function renderList(){
 const q=$('search').value.toLocaleLowerCase('nb'),filter=$('filter').value;
 const visible=receipts.filter(r=>{
 const d=r.reviewed_data||r.ai_data||{};
 return (filter==='deleted'?r.deleted_at:!r.deleted_at)&&
 (filter==='approved'?r.review_status==='approved':filter==='new'?r.ai_status==='new'&&!r.reviewed_data:filter==='draft'?r.review_status!=='approved':true)&&
 [r.original_name,d.vendor,d.purchase_date,d.category].join(' ').toLocaleLowerCase('nb').includes(q);
 });
 $('receiptList').replaceChildren();
 for(const r of visible){
 const d=r.reviewed_data||r.ai_data||{},row=elem('div',null,'receipt-row'),title=elem('div');
 title.append(elem('strong',d.vendor||r.original_name),elem('small',[d.purchase_date||'Dato mangler',d.gross!=null?d.gross.toLocaleString('nb-NO',{minimumFractionDigits:2})+' '+(d.currency||''):'Beløp mangler',r.synthetic?'Testbilag':''].filter(Boolean).join(' · ')));
 const button=elem('button','Åpne','secondary');button.onclick=()=>{if(canLeave())run(()=>openReceipt(r.id));};
 row.append(title,elem('span',r.deleted_at?'Papirkurv':r.review_status==='approved'?'Kontrollert':r.reviewed_data?'Til kontroll':statusLabels[r.ai_status],'badge'),button);$('receiptList').append(row);
 }
 if(!visible.length)$('receiptList').append(elem('p','Ingen kvitteringer i denne visningen.'));
}
async function loadList(){
 receipts=[];let page=0,more=true;
 let usage;
 while(more){const r=await api({action:'list',page});receipts.push(...r.receipts);settings=r.settings;usage=r.usage;more=r.more;page++;}
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
function changed(){dirty=true;$('confirmed').checked=false;showValidation();}
$('receiptForm').addEventListener('input',e=>{if(e.target.id!=='confirmed')changed();});
function canLeave(){return !dirty||confirm('Du har ulagrede rettelser. Vil du forkaste dem?');}
async function openReceipt(id,keepForm=false){
 const result=await api({action:'get',id});current=result.receipt;runs=result.runs;
 $('detail').hidden=false;$('fileTitle').textContent=current.original_name;
 $('original').href=result.url;$('preview').replaceChildren();
 if(['image/jpeg','image/png'].includes(current.mime_type)){const img=elem('img');img.src=result.url;img.alt='Original kvittering';$('preview').append(img);}
 else if(current.mime_type==='application/pdf'){const frame=elem('iframe');frame.src=result.url;frame.title='Original PDF-kvittering';$('preview').append(frame);}
 else $('preview').append(elem('p','HEIC-forhåndsvisning støttes ikke i alle nettlesere. Åpne originalfilen for kontroll.'));
 $('analysisHistory').replaceChildren(elem('h3','Analysehistorikk'));
 for(const r of runs)$('analysisHistory').append(elem('p',new Date(r.started_at).toLocaleString('nb-NO')+' · '+r.model+' · '+r.status+' · '+(r.input_tokens??'?')+' inn / '+(r.output_tokens??'?')+' ut · '+(r.estimated_usd==null?'kostnad ukjent':'est. $'+Number(r.estimated_usd).toFixed(6))));
 if(!keepForm){renderForm(current.reviewed_data||current.ai_data||emptyData());$('ocrResult').hidden=true;$('ocrText').value='';}
 syncButtons();$('detail').focus({preventScroll:true});
}
async function analysisCopy(file){
 if(!/\.(jpe?g|png|heic|heif)$/i.test(file.name))return null;
 let bitmap;
 try{bitmap=await createImageBitmap(file);}catch{return null;}
 try{
 if(bitmap.width*bitmap.height>60000000)throw Error('Bildet har for mange piksler. Ta et nytt bilde med lavere oppløsning.');
 const scale=Math.min(1,2000/bitmap.width);
 if(scale===1&&file.size<2000000)return null;
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
 return blob&&blob.size<file.size&&blob.size<=5242880?blob:null;
 }finally{bitmap.close();}
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
 const copy=await analysisCopy(file);if(copy)form.append('analysis',copy,'analysis.jpg');
 last=(await api(form)).receipt.id;
 }catch(e){failed++;failures.push(file.name+': '+e.message);}
 }
 await loadList();if(last)await openReceipt(last);
 for(const message of failures)$('receiptList').prepend(elem('p',message,'error'));
 say((files.length-failed)+' av '+files.length+' filer lagret. '+(failed?'Noen filer feilet eller finnes allerede. ':'')+'Ingen AI-analyser er startet.',failed>0);
}
$('uploadButton').onclick=()=>{if(canLeave())$('files').click();};
for(const id of ['files'])$(id).onchange=()=>{const files=Array.from($(id).files);$(id).value='';run(()=>upload(files));};
$('search').oninput=renderList;$('filter').onchange=renderList;
$('refresh').onclick=()=>{if(canLeave())run(async()=>{await loadList();if(current)await openReceipt(current.id);say('Oppdatert.');});};
$('closeDetail').onclick=()=>{if(canLeave()){$('detail').hidden=true;current=null;dirty=false;}};
$('renewPreview').onclick=()=>run(()=>openReceipt(current.id,true));
$('addVat').onclick=()=>{addRow('vat');changed();};$('addItem').onclick=()=>{addRow('item');changed();};
$('applyAI').onclick=()=>{if(confirm('Bytt skjemaet til det nyeste AI-forslaget? Lagrede rettelser erstattes først når du lagrer.')){renderForm(current.ai_data);dirty=true;}};
$('analyze').onclick=()=>{
 if(!canLeave())return;
 run(async()=>{
 say('Starter lokal tekstlesing …');
 const fresh=await api({action:'get',id:current.id});
 const response=await fetch(fresh.url);
 if(!response.ok)throw Error('Kunne ikke hente originalen. Åpne kvitteringen på nytt.');
 const text=await recognizeReceipt(await response.blob(),current.mime_type,say);
 if(!text.trim())throw Error('Ingen lesbar tekst funnet. Ta et tydeligere bilde eller fyll inn manuelt.');
 const parsed=parseReceiptText(text);renderForm(parsed);dirty=true;
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
$('receiptForm').onsubmit=e=>{e.preventDefault();run(()=>save('save'));};$('approve').onclick=()=>run(()=>save('approve'));
for(const action of ['delete','restore'])$(action).onclick=()=>{if(canLeave()&&confirm(action==='delete'?'Flytt kvitteringen til papirkurven? Originalfilen beholdes.':'Gjenopprette kvitteringen?'))run(async()=>{await api({action,id:current.id,revision:current.revision});dirty=false;await openReceipt(current.id);await loadList();say(action==='delete'?'Flyttet til papirkurven.':'Gjenopprettet.');});};
$('checkModel').onclick=()=>run(async()=>{await loadOCR();$('modelStatus').textContent=' Tekstleseren er lastet. Ingen API-nøkkel nødvendig.';});
$('recover').onclick=()=>run(async()=>{await api({action:'recover',id:current.id,revision:current.revision});await openReceipt(current.id);await loadList();say('Avbrutt analyse frigjort. Ingen nytt AI-kall er startet.');});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
if(await window.adminReady)run(async()=>{await loadList();say('Klar. Last opp en kvittering for å begynne.');});

// Review-only Fiken purchase drafts. Test company + reviewed receipts only; never books a purchase.
import { requireAdmin } from '../shared/auth.ts';
import { validateData } from '../../../admin/receipt-data.mjs';
const cors={'Access-Control-Allow-Origin':'https://skallstuggu-test.no','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const companySlug='apiskallstuggu', fikenBase='https://api.fiken.no/api/v2';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ore=n=>Math.round(n*100);
const rateType:Record<number,string>={0:'NONE',12:'LOW',15:'MEDIUM',25:'HIGH'};
const fail=(message,status=422)=>Object.assign(new Error(message),{status});
export function makeDraft(receipt){
 if(receipt.deleted_at||receipt.review_status!=='approved'||!receipt.reviewed_data)throw fail('Bare kontrollerte bilag kan sendes til testforetaket.');
 const {data:d,errors}=validateData(receipt.reviewed_data);
 if(errors.length)throw fail('Kontrollfeil: '+errors.join(' '));
 if(d.currency!=='NOK')throw fail('Denne testversjonen støtter bare NOK.');
 if(!/^\d{4}$/.test(d.account||''))throw fail('Kontroller og fyll inn én firesifret kostnadskonto før sending.');
 if(!d.vat_rates.length||d.vat_rates.length>20||d.vat_rates.some(r=>r.rate==null||r.net==null||r.gross==null||r.vat==null))throw fail('Full MVA-fordeling kreves.');
 if(d.vat_rates.some(r=>!Object.hasOwn(rateType,String(r.rate))))throw fail('Støtter bare MVA-satsene 0, 12, 15 og 25 %. Kontroller andre satser i Fiken.');
 if(d.vat_rates.some(r=>ore(r.net)+ore(r.vat)!==ore(r.gross)))throw fail('Hver MVA-linje må stemme på øret før sending.');
 if(d.vat_rates.reduce((s,r)=>s+ore(r.gross),0)!==ore(d.gross))throw fail('Totalbeløp og MVA-fordeling må stemme nøyaktig. Håndter eventuell avrunding før eksport.');
 const lines=d.vat_rates.map(r=>({text:('Kvittering '+d.vendor+' ('+r.rate+' % MVA)').slice(0,200),net:ore(r.net!),gross:ore(r.gross!),vatType:rateType[Number(r.rate)],incomeAccount:d.account!}));
 // No bank/payment account is collected here. Leave payment unregistered in the
 // review-only draft; cash purchases require an explicit payment in Fiken.
 return {invoiceIssueDate:d.purchase_date,cash:false,paid:false,currency:'NOK',lines};
}
export function makeHandler({env,request=fetch}){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{...cors,'Cache-Control':'no-store'}});
 const db=async(path,method='GET',data)=>{
  const key=env('SUPABASE_SERVICE_ROLE_KEY'),url=env('SUPABASE_URL');
  const response=await request(url+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw fail('Kunne ikke oppdatere eksportstatus.',502);
  return response.status===204?[]:response.json();
 };
 const rpc=async(name,data)=>{
  const key=env('SUPABASE_SERVICE_ROLE_KEY');
  const response=await request(env('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw fail(body.message==='ALREADY_EXPORTED_OR_UNCERTAIN'?'Sending er allerede forsøkt. Kontroller Fiken og eksportstatus før nytt forsøk.':'Kunne ikke reservere sending. Kontroller status og kvitteringsversjon.',409);}
 };
 const fiken=async(token,path,method='GET',body)=>{
  if(!path.startsWith('/companies/'+companySlug+'/')&&path!=='/companies/'+companySlug)throw fail('Ugyldig Fiken-ressurs.',400);
  const headers:Record<string,string>={Authorization:'Bearer '+token,'X-Request-ID':crypto.randomUUID()};
  if(body && !(body instanceof FormData))headers['Content-Type']='application/json';
  const response=await request(fikenBase+path,{method,headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok){
   const detail=(await response.text()).slice(0,1600);
   throw Object.assign(fail('Fiken svarte HTTP '+response.status+': '+detail,502),{rejected:[400,401,403,404,422,429].includes(response.status)});
  }
  return response;
 };
 const save=async(id,requestId,values)=>db('receipt_fiken_exports?receipt_id=eq.'+id+'&request_id=eq.'+requestId,'PATCH',{...values,updated_at:new Date().toISOString()});
 const sourceFile=async(receipt)=>{
  let path=receipt.original_path,mime=receipt.mime_type,name=receipt.original_name;
  if(mime==='image/heic'||mime==='image/heif'){
   if(receipt.analysis_mime!=='image/jpeg'||!receipt.analysis_path)throw fail('HEIC må konverteres til JPG før Fiken-eksport.');
   path=receipt.analysis_path;mime='image/jpeg';name=name.replace(/\.[^.]+$/,'.jpg');
  }
  if(!['image/jpeg','image/png','application/pdf'].includes(mime))throw fail('Bruk JPG, PNG eller PDF.');
  if(!/\.(jpe?g|png|pdf)$/i.test(name))name+='.'+(mime==='application/pdf'?'pdf':mime==='image/png'?'png':'jpg');
  const key=env('SUPABASE_SERVICE_ROLE_KEY');
  const result=await request(env('SUPABASE_URL')+'/storage/v1/object/kvitteringer/'+path.split('/').map(encodeURIComponent).join('/'),{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(30000)});
  if(!result.ok)throw fail('Originalfilen kunne ikke hentes fra privat lagring.',502);
  const bytes=await result.arrayBuffer();
  if(!bytes.byteLength||bytes.byteLength>10485760)throw fail('Vedlegget er tomt eller for stort.');
  return {mime,name,bytes};
 };
 return async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply({error:'Bare POST er tillatt.'},405);
  let user;
  try{user=await requireAdmin(req,env,request);}catch{return reply({error:'Admintilgang kreves.'},403);}
  let body;
  try{body=await req.json();}catch{return reply({error:'Ugyldig JSON.'},400);}
  const id=body?.id;
  if(typeof id!=='string'||!uuid.test(id)||!['status','create_draft'].includes(body.action))return reply({error:'Ugyldig handling eller kvittering.'},400);
  if(body.action==='status'){
   try{const rows=await db('receipt_fiken_exports?receipt_id=eq.'+id+'&select=state,draft_id,error_code,updated_at');return reply({export:rows[0]||null,testOnly:true});}
   catch{return reply({error:'Kunne ikke hente Fiken-status.'},502);}
  }
  const token=env('FIKEN_TOKEN');
  if(!token||!env('SUPABASE_URL')||!env('SUPABASE_SERVICE_ROLE_KEY'))return reply({error:'Fiken-integrasjonen mangler serveroppsett.'},503);
  if(!Number.isSafeInteger(body.revision)||body.revision<1)return reply({error:'Ugyldig versjon.'},400);
  const requestId=crypto.randomUUID();let claimed=false,locked=false,externalWrite=false,draftId=null;
  try{
   const rows=await db('receipts?id=eq.'+id+'&select=*');
   if(rows.length!==1)throw fail('Kvitteringen finnes ikke.',404);
   const receipt=rows[0];if(receipt.revision!==body.revision)throw fail('Kvitteringen er endret. Oppdater siden.',409);
   const draft=makeDraft(receipt); const attachment=await sourceFile(receipt);
   // Share the existing global test-Fiken lock with invoice exports to comply with single concurrent Fiken request.
   const lock=await db('fiken_test_lock?id=eq.1&request_id=is.null','PATCH',{request_id:requestId,locked_at:new Date().toISOString()});
   if(!lock.length)throw fail('En annen Fiken-operasjon pågår. Prøv igjen senere.',409);
   locked=true;
   await rpc('receipt_fiken_claim',{p_receipt:id,p_admin:user.id,p_revision:body.revision,p_request:requestId});claimed=true;
   const prefix='/companies/'+companySlug;
   const company=await(await fiken(token,prefix)).json();
   if(company.slug!==companySlug||company.testCompany!==true)throw fail('Sperret: Fiken-forbindelsen peker ikke på testforetaket.',409);
   externalWrite=true;
   const created=await fiken(token,prefix+'/purchases/drafts','POST',draft);
   const location=created.headers.get('location')||'';
   const match=location.match(/\/purchases\/drafts\/(\d+)(?:\/?(?:\?.*)?)?$/);
   if(!match)throw fail('Fiken opprettet kanskje et utkast, men returnerte ikke et entydig utkastnummer.',502);
   draftId=Number(match[1]);
   await save(id,requestId,{state:'draft_created',draft_id:draftId});
   const form=new FormData();
   form.append('filename',attachment.name);
   form.append('file',new Blob([attachment.bytes],{type:attachment.mime}),attachment.name);
   await fiken(token,prefix+'/purchases/drafts/'+draftId+'/attachments','POST',form);
   const verified=await(await fiken(token,prefix+'/purchases/drafts/'+draftId)).json();
   const files=await(await fiken(token,prefix+'/purchases/drafts/'+draftId+'/attachments')).json();
   if(!Array.isArray(verified.lines)||verified.lines.reduce((s,l)=>s+Number(l.gross),0)!==draft.lines.reduce((s,l)=>s+l.gross,0)||!Array.isArray(files)||files.length<1)throw fail('Utkast eller vedlegg kunne ikke bekreftes.',502);
   await save(id,requestId,{state:'ready',draft_id:draftId,error_code:null});
   return reply({success:true,draftId,company:company.name,state:'ready',posted:false,testOnly:true});
  }catch(e:any){
   if(claimed){try{await save(id,requestId,{state:externalWrite&&!(e.rejected&&!draftId)?'uncertain':'error',...(draftId?{draft_id:draftId}:{}),error_code:e.rejected&&!draftId?'FIKEN_REJECTED':externalWrite?'CHECK_FIKEN':'PREFLIGHT_FAILED'});}catch{}}
   const msg=e?.message||'Ukjent feil';
   const uncertain=externalWrite&&!(e.rejected&&!draftId);
   return reply({error:uncertain?'Sendingen kan ha nådd Fiken. Kontroller testforetaket manuelt før ny handling. '+msg:msg,state:claimed?(uncertain?'uncertain':'error'):null},e?.status||502);
  }finally{
   if(locked){try{await db('fiken_test_lock?id=eq.1&request_id=eq.'+requestId,'PATCH',{request_id:null,locked_at:null});}catch{}}
  }
 };
}
if(typeof Deno!=='undefined')Deno.serve(makeHandler({env:name=>Deno.env.get(name)}));


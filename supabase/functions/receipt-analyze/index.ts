import {serveWithCloudflareOrigin} from '../shared/cloudflare-origin.ts';
// Admin-only receipt upload and management.
import { requireAdmin } from '../shared/auth.ts';
import { validateData } from '../../../admin/receipt-data.mjs';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
const env=(name:string)=>Deno.env.get(name)||'';
const origin=env('RECEIPT_ALLOWED_ORIGIN')||'https://skallstuggu-test.no';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
class Fault extends Error { constructor(public status:number,public code:string,message:string){super(message);} }
const messages:Record<string,string>={SYNTHETIC_ONLY:'Testmodus: bare syntetiske testkvitteringer kan lastes opp.'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function database(path:string,method='GET',body?:unknown){
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const res=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 if(!res.ok){
 const payload=await res.json().catch(()=>({})),code=Object.keys(messages).find(k=>payload.message===k);
 if(code)throw new Fault(['ADMIN_QUOTA','TOTAL_QUOTA'].includes(code)?429:409,code,messages[code]);
 if(payload.code==='23505')throw new Fault(409,'DUPLICATE','Denne originalfilen finnes allerede, eventuelt i papirkurven.');
 throw new Fault(500,'DATABASE','Kunne ikke lagre/hente kvitteringen. Ingen automatisk gjentakelse.');
 }
 return res.status===204?null:res.json();
}
async function storage(path:string,method='GET',body?:BodyInit,mime?:string){
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const r=await fetch(env('SUPABASE_URL')+'/storage/v1/'+path,{method,headers:{Authorization:'Bearer '+key,apikey:key,...(mime?{'Content-Type':mime}:{})},body,signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Fault(502,'STORAGE','Kunne ikke åpne eller lagre originalfilen.');
 return r;
}
async function limitedBody(req:Request,max:number){
 const reader=req.body?.getReader();if(!reader)throw new Fault(400,'EMPTY','Filen eller forespørselen er tom.');
 const chunks:Uint8Array[]=[];let total=0;
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Fault(413,'SIZE','Filen er for stor. Maks 10 MB per original.');}chunks.push(value);}
 const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
const uuid=(id:unknown)=>{if(typeof id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id))throw new Fault(400,'ID','Ugyldig kvitteringsnummer.');return id;};
async function getReceipt(id:unknown){const rows=await database('receipts?id=eq.'+uuid(id)+'&limit=1');if(!rows.length)throw new Fault(404,'NOT_FOUND','Kvitteringen finnes ikke.');return rows[0];}
async function inspectFile(bytes:Uint8Array){
 const ascii=(a:number,b:number)=>new TextDecoder().decode(bytes.slice(a,b));
 let mime='';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')mime='image/png';
 else if(ascii(0,5)==='%PDF-'){
 try{const pdf=await PDFDocument.load(bytes);if(pdf.getPageCount()<1||pdf.getPageCount()>3)throw Error();}catch{throw new Fault(400,'PDF','PDF må være ukryptert og ha 1–3 sider.');}
 mime='application/pdf';
 }else if(ascii(4,8)==='ftyp'&&/(heic|heix|hevc|hevx|mif1)/.test(ascii(8,40)))mime='image/heic';
 if(!mime)throw new Fault(400,'TYPE','Bruk en gyldig JPG-, PNG-, HEIC- eller PDF-fil.');
 return mime;
}
export async function handle(req:Request){
 if(req.method==='OPTIONS')return new Response(null,{headers:cors,status:204});
 if(req.method!=='POST')return reply({error:'Bruk POST.'},405);
 try{
 await requireAdmin(req,env);
 const settings=(await database('receipt_settings?id=eq.true'))[0];
 if(req.headers.get('content-type')?.startsWith('multipart/form-data')){
 const buffer=await limitedBody(req,15728640+65536);
 const form=await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')!},body:buffer}).formData();
 const file=form.get('file'),synthetic=form.get('synthetic')==='true';
 if(!(file instanceof File)||!file.size||file.size>10485760)throw new Fault(400,'FILE','Velg én fil på maks 10 MB.');
 if(!settings.real_documents_enabled&&!synthetic)throw new Fault(409,'SYNTHETIC_ONLY',messages.SYNTHETIC_ONLY);
 const bytes=new Uint8Array(await file.arrayBuffer()),mime=await inspectFile(bytes);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const duplicate=await database('receipts?file_hash=eq.'+hash+'&select=id');
 if(duplicate.length)throw new Fault(409,'DUPLICATE','Denne filen er allerede lagret, eventuelt i papirkurven.');
 const id=crypto.randomUUID(),path=id+'/original';
 await storage('object/kvitteringer/'+path,'POST',bytes,mime);
 // On DB failure leave the unique uploaded object for maintenance, not unsafe automatic removal.
 const [receipt]=await database('receipts','POST',{id,created_by:user.id,original_path:path,original_name:file.name.slice(0,250),mime_type:mime,file_size:file.size,file_hash:hash,synthetic});
 return reply({receipt});
 }
 const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,200000)));
 if(body.action==='list'){
 const page=Number.isInteger(body.page)&&body.page>=0?body.page:0;
 const receipts=await database('receipts?order=created_at.desc&limit=100&offset='+page*100);
 return reply({receipts,settings:{real_documents_enabled:settings.real_documents_enabled},page,more:receipts.length===100});
 }
 const receipt=await getReceipt(body.id);
 if(body.action==='get'){
 const sign=await (await storage('object/sign/kvitteringer/'+receipt.original_path,'POST',JSON.stringify({expiresIn:300}),'application/json')).json();
 return reply({receipt,url:env('SUPABASE_URL')+'/storage/v1'+sign.signedURL});
 }
 if(['save','approve','delete','restore'].includes(body.action)){
 let data=null;
 if(['save','approve'].includes(body.action)){
 const result=validateData(body.data);data=result.data;
 if(body.action==='approve'&&(body.confirmed!==true||result.errors.length))throw new Fault(400,'VALIDATION',result.errors.join(' ')||'Bekreft at du har kontrollert originalbilaget.');
 }
 const updated=await database('rpc/receipt_edit','POST',{p_id:receipt.id,p_admin:user.id,p_revision:body.revision,p_action:body.action,p_data:data});
 return reply({receipt:updated});
 }
 throw new Fault(400,'ACTION','Ukjent handling.');
 }catch(e){
 const status=e instanceof Fault?e.status:(e as any)?.status===403?403:500;
 return reply({error:e instanceof Fault||status===403?(e as Error).message:'Forespørselen kunne ikke fullføres. Åpne kvitteringen på nytt før du prøver igjen.',code:e instanceof Fault?e.code:'REQUEST_FAILED'},status);
 }
}
serveWithCloudflareOrigin(handle);


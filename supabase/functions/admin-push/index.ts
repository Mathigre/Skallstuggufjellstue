import {serveWithCloudflareOrigin} from '../shared/cloudflare-origin.ts';
import * as pushModule from 'npm:web-push@3.6.7';
import {requireAdmin,hashToken} from './auth.ts';
const webpush=pushModule.default||pushModule;
const env=name=>Deno.env.get(name);
const headers={'Access-Control-Allow-Origin':'https://skallstuggu-test.no','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validEndpoint(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&value.length<=4096&&
 (u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.web.push.apple.com')||u.hostname.endsWith('.notify.windows.com'));
 }catch{return false;}
}
export function validSubscription(s){return s&&validEndpoint(s.endpoint)&&/^[A-Za-z0-9_-]{87}=?$/.test(s.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys?.auth||'');}
async function rest(path,method='GET',body,prefer='return=representation'){
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const r=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('Kunne ikke oppdatere varslingstjenesten.');
 return r.status===204?null:r.json();
}
async function keys(){
 let [k]=await rest('admin_push_settings?select=public_key,private_key&id=eq.true');
 if(!k){const pair=webpush.generateVAPIDKeys();await rest('admin_push_settings?on_conflict=id','POST',{id:true,public_key:pair.publicKey,private_key:pair.privateKey},'resolution=ignore-duplicates,return=representation');[k]=await rest('admin_push_settings?select=public_key,private_key&id=eq.true');}
 return k;
}
async function send(rows,payload){
 if(!rows.length)return {sent:0,failed:0};
 const k=await keys();let sent=0,failed=0;
 await Promise.all(rows.map(async row=>{
  try{
   const d=webpush.generateRequestDetails({endpoint:row.endpoint,keys:{auth:row.auth,p256dh:row.p256dh}},JSON.stringify(payload),{vapidDetails:{subject:'mailto:post@skallstuggu.no',publicKey:k.public_key,privateKey:k.private_key},TTL:86400,urgency:'normal'});
   const r=await fetch(d.endpoint,{method:d.method,headers:d.headers,body:d.body,redirect:'error',signal:AbortSignal.timeout(12000)});
   if(r.status===404||r.status===410){await rest('admin_push_subscriptions?endpoint=eq.'+encodeURIComponent(row.endpoint),'DELETE');failed++;}
   else if(r.ok)sent++;else failed++;
  }catch{failed++;}
 }));
 return {sent,failed};
}
export async function handler(req){
 const json=(data,status=200)=>Response.json(data,{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({error:'Kun POST er tillatt.'},405);
 try{
  const raw=await req.text();if(raw.length>12000)return json({error:'For stor forespørsel.'},413);
  const body=JSON.parse(raw);
  if(body.action==='dispatch'){
   const expected='Bearer '+env('SUPABASE_SERVICE_ROLE_KEY');
   if(!env('SUPABASE_SERVICE_ROLE_KEY')||req.headers.get('authorization')!==expected)return json({error:'Ingen tilgang.'},403);
   const isMail=body.kind==='mail',eventId=isMail?body.threadId:body.bookingId;
   if(!['booking','message','mail'].includes(body.kind)||!uuid.test(eventId||''))return json({error:'Ugyldig hendelse.'},400);
   const records=await rest((isMail?'mail_threads':'bookings')+'?id=eq.'+eventId+'&select=id&limit=1');if(!records.length)return json({error:'Hendelsen finnes ikke.'},404);
   const members=await rest('admin_users?select=user_id');const ids=new Set(members.map(m=>m.user_id));
   const rows=(await rest('admin_push_subscriptions?expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=*')).filter(r=>ids.has(r.user_id));
   const result=await send(rows,{title:isMail?'Ny mail til Skallstuggu':body.kind==='booking'?'Ny bookingforespørsel':'Ny melding fra en gjest',body:isMail?'Åpne Mail i Skallstuggu Admin for å lese henvendelsen.':'Åpne Skallstuggu Admin for å se bestillingen.',...(isMail?{threadId:eventId}:{bookingId:eventId}),tag:body.kind+'-'+eventId});
   if(result.failed)console.warn('Push delivery failures: '+result.failed);
   return json(result);
  }
  const user=await requireAdmin(req,env);
  const allowed=await rest('rpc/consume_booking_limit','POST',{limit_key:await hashToken('admin-push:'+user.id),max_hits:30,seconds:60});
  if(!allowed)return json({error:'For mange forespørsler. Vent et minutt.'},429);
  if(body.action==='config')return json({publicKey:(await keys()).public_key});
  const endpoint=body.subscription?.endpoint||body.endpoint;
  if(!validEndpoint(endpoint))return json({error:'Telefonens varslingstjeneste støttes ikke.'},400);
  const filter='endpoint=eq.'+encodeURIComponent(endpoint)+'&user_id=eq.'+user.id;
  if(body.action==='subscribe'){
   if(!validSubscription(body.subscription))return json({error:'Ugyldig varslingsabonnement.'},400);
   const existing=await rest('admin_push_subscriptions?endpoint=eq.'+encodeURIComponent(endpoint)+'&select=user_id');
   if(existing.length&&existing[0].user_id!==user.id)return json({error:'Deaktiver varsler fra den tidligere adminkontoen på denne enheten først.'},409);
   const values={p256dh:body.subscription.keys.p256dh,auth:body.subscription.keys.auth,updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+90*86400000).toISOString()};
   await rest('admin_push_subscriptions?on_conflict=endpoint','POST',{endpoint,user_id:user.id,...values},'resolution=ignore-duplicates,return=representation');
   const updated=await rest('admin_push_subscriptions?'+filter,'PATCH',values);if(!updated.length)return json({error:'Enheten tilhører en annen adminkonto.'},409);
   return json({success:true});
  }
  if(body.action==='unsubscribe'){await rest('admin_push_subscriptions?'+filter,'DELETE');return json({success:true});}
  if(body.action==='test'){
   const rows=await rest('admin_push_subscriptions?'+filter+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=*');
   if(!rows.length)return json({error:'Aktiver varsler på denne enheten først.'},400);
   const result=await send(rows,{title:'Skallstuggu Admin',body:'Testvarsel – varslingen er koblet til denne enheten.',tag:'skallstuggu-test'});
   return result.sent?json(result):json({error:'Varslet kunne ikke leveres. Deaktiver og aktiver varsler på nytt.'},502);
  }
  return json({error:'Ukjent handling.'},400);
 }catch(error){return json({error:error.status===403?'Logg inn som administrator.':'Varslingstjenesten svarte ikke. Prøv igjen.'},error.status===403?403:500);}
}
serveWithCloudflareOrigin(handler);

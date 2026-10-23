import {requireAdmin,db as rest,hashToken,newToken} from '../shared/auth.ts';
import {MAILBOX,SITE,UUID,MailError,validateContact,base64url,syncGmail} from './core.ts';
const env=name=>Deno.env.get(name);
const db=(path,method='GET',body)=>rest(path,env,method,body);
const callback=()=>env('SUPABASE_URL')+'/functions/v1/mail-center/oauth/callback';
const headers={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const background=promise=>{if(typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(promise.catch(()=>console.warn('mail_background_failed')));else promise.catch(()=>{});};
async function googleToken(){
 const refresh=await db('rpc/mail_read_refresh','POST',{});
 if(!refresh||!env('GOOGLE_MAIL_CLIENT_ID')||!env('GOOGLE_MAIL_CLIENT_SECRET'))throw new MailError('Gmail er ikke koblet til.',503);
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env('GOOGLE_MAIL_CLIENT_ID'),client_secret:env('GOOGLE_MAIL_CLIENT_SECRET'),refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok||!data.access_token)throw new MailError('Gmail må kobles til på nytt.',401);
 return data.access_token;
}
async function doSync(){
 const rows=await db('mail_connection?id=eq.true&select=enabled');if(!rows[0]?.enabled)return {connected:false};
 let token;
 const gmail=async path=>{token||=await googleToken();const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new MailError('gmail_api_failed',r.status);return r.json();};
 const verifyEcho=async parsed=>{
  const id=parsed.contact_echo||parsed.echo_job;
  return UUID.test(id||'')&&parsed.echo_signature===await hashToken(env('SUPABASE_SERVICE_ROLE_KEY')+'|'+id);
 };
 return syncGmail({db,gmail,verifyEcho});
}
export async function processJobs(){
 const jobs=await db('rpc/mail_claim_jobs','POST',{});
 async function one(job){
  const [message]=await db('mail_messages?id=eq.'+job.message_id+'&select=*');
  const [thread]=await db('mail_threads?id=eq.'+message.thread_id+'&select=*');
  try{
   if(job.kind==='push'){
    const r=await fetch(env('SUPABASE_URL')+'/functions/v1/admin-push',{method:'POST',headers:{Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json'},body:JSON.stringify({action:'dispatch',kind:'mail',threadId:thread.id}),signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new MailError('push_failed',r.status);
    const result=await r.json();if(result.failed)throw new MailError('push_delivery_failed',503);
   }else{
    if(!env('RESEND_API_KEY'))throw new MailError('resend_not_configured',503);
    if(Date.now()-Date.parse(job.created_at)>23*3600000)throw new MailError('retry_window_expired',409);
    const subject=(job.kind==='reply'?'Re: ':'')+thread.subject.replace(/\[Skallstuggu [0-9a-f-]+\]/ig,'').trim()+' [Skallstuggu '+thread.id+']';
    // Test mode is deliberately fixed server-side: no customer deliveries yet.
    const recipient=MAILBOX;
    const emailHeaders=job.kind==='owner_email'?{'X-Skallstuggu-Contact':thread.id}:{'X-Skallstuggu-Outbox':job.id};
    emailHeaders['X-Skallstuggu-Signature']=await hashToken(env('SUPABASE_SERVICE_ROLE_KEY')+'|'+(job.kind==='owner_email'?thread.id:job.id));
    const text=job.kind==='owner_email'?`Ny henvendelse via kontaktskjemaet.\n\nNavn: ${thread.contact_name}\nE-post: ${thread.contact_email}\nTelefon: ${thread.contact_phone}\n\n${message.body}\n\nSvar fra admin: ${SITE}/admin/mail.html?thread=${thread.id}`:`[TEST – tiltenkt mottaker: ${thread.contact_email}]\n\n${message.body}\n\nSkallstuggu\nTelefon 906 88 873`;
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'skall-mail-'+job.id},body:JSON.stringify({from:'Skallstuggu <booking@skallstuggu-test.no>',to:[recipient],reply_to:job.kind==='owner_email'?thread.contact_email:MAILBOX,subject,text,headers:emailHeaders}),signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok||!data.id)throw new MailError('resend_http_'+r.status,r.status);
    await db('rpc/mail_complete_job','POST',{p_id:job.id,p_provider:data.id});
    return;
   }
   await db('rpc/mail_complete_job','POST',{p_id:job.id});
  }catch(e){
   const permanent=job.attempts>=8||e.status===400||e.status===422||e.message==='retry_window_expired';
   await db('mail_jobs?id=eq.'+job.id,'PATCH',{state:permanent?'failed':'pending',locked_until:null,error_code:/^[a-z0-9_]+$/.test(e.message)?e.message:'delivery_failed',next_at:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString()});
   const uncertain=permanent&&(e.message==='retry_window_expired'||e.status===undefined);
   if(job.kind==='reply')await db('mail_messages?id=eq.'+message.id,'PATCH',{delivery_state:permanent?(uncertain?'uncertain':'failed'):'queued'});
  }
 }
 for(let i=0;i<jobs.length;i+=3)await Promise.all(jobs.slice(i,i+3).map(one));
 return {processed:jobs.length};
}

async function oauthCallback(req){
 const url=new URL(req.url);let success=false;
 try{
  const state=url.searchParams.get('state')||'';
  if(!/^[a-f0-9]{64}$/.test(state))throw new MailError('invalid_state');
  const [saved]=await db('rpc/mail_take_oauth','POST',{p_hash:await hashToken(state)});
  if(!saved)throw new MailError('expired_state');
  const member=await db('admin_users?user_id=eq.'+saved.admin_id+'&select=user_id');if(!member.length)throw new MailError('not_admin');
  const code=url.searchParams.get('code');if(!code)throw new MailError('authorization_denied');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:env('GOOGLE_MAIL_CLIENT_ID')||'',client_secret:env('GOOGLE_MAIL_CLIENT_SECRET')||'',redirect_uri:callback(),grant_type:'authorization_code',code_verifier:saved.verifier}),signal:AbortSignal.timeout(15000)});
  const token=await r.json();if(!r.ok||!token.refresh_token)throw new MailError('no_refresh_token');
  const profile=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
  const data=await profile.json();if(!profile.ok||data.emailAddress?.toLowerCase()!==MAILBOX)throw new MailError('wrong_mailbox');
  await db('rpc/mail_store_refresh','POST',{p_token:token.refresh_token});success=true;
  background(doSync().then(()=>processJobs()));
 }catch{console.warn('gmail_connection_not_completed');}
 return new Response(null,{status:303,headers:{Location:SITE+'/admin/mail.html?gmail='+(success?'connected':'failed'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}

export async function handler(req){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method==='GET'&&new URL(req.url).pathname.endsWith('/oauth/callback'))return oauthCallback(req);
 if(req.method!=='POST')return reply({error:'Bruk POST.'},405);
 try{
  const raw=await req.text();if(raw.length>40000)throw new MailError('Forespørselen er for stor.',413);
  let body;try{body=JSON.parse(raw);}catch{throw new MailError('Ugyldig forespørsel.');}
  if(body.action==='scheduled'){
   const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
   if(token.length<60||token.length>200||!await db('rpc/mail_check_cron','POST',{p_token:token}))throw new MailError('Ingen tilgang.',403);
   // Delivery and synchronization are independent; a Gmail outage cannot block form messages.
   const result=await Promise.allSettled([processJobs(),doSync()]);
   return reply({success:result.every(r=>r.status==='fulfilled')});
  }
  if(![SITE,'https://skallstuggufjellstue.pages.dev'].includes(req.headers.get('origin')||''))throw new MailError('Ugyldig opprinnelse.',403);
  if(body.action==='contact'){
   const p=validateContact(body);
   const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
   const allowed=await db('rpc/consume_booking_limit','POST',{limit_key:await hashToken('contact:'+ip),max_hits:6,seconds:600});
   if(!allowed)throw new MailError('For mange meldinger. Vent litt, eller ring 906 88 873.',429);
   const result=await db('rpc/mail_ingest','POST',{p:{provider_key:'contact:'+p.request_id,new_thread_id:p.request_id,source:'contact',direction:'incoming',sender_name:p.name,sender_email:p.email,contact_email:p.email,phone:p.phone,subject:'Spørsmål fra '+p.name,body:p.question,received_at:new Date().toISOString(),notify:true}});
   background(processJobs());return reply({success:true,reference:p.request_id},result.duplicate?200:201);
  }
  const user=await requireAdmin(req,env);
  if(body.action==='list'){
   const filter=['new','unanswered','answered','all'].includes(body.filter)?body.filter:'unanswered';
   return reply(await db('rpc/mail_list','POST',{p_filter:filter,p_search:String(body.search||'').slice(0,200),p_offset:Number.isInteger(body.offset)?body.offset:0}));
  }
  if(body.action==='status'){
   const [connection]=await db('mail_connection?id=eq.true&select=mailbox,enabled,backfill_complete,last_sync_at,last_error');
   const failed=await db('mail_jobs?state=eq.failed&select=id&limit=100');
   const pending=await db('mail_jobs?state=in.(pending,processing)&select=created_at,error_code&order=created_at.asc&limit=100');
   return reply({connection,failed_jobs:failed.length,pending_jobs:pending.length,oldest_pending_at:pending[0]?.created_at||null,test_mode:true,test_recipient:MAILBOX,oauth_configured:!!env('GOOGLE_MAIL_CLIENT_ID')&&!!env('GOOGLE_MAIL_CLIENT_SECRET'),redirect_uri:callback()});
  }
  if(body.action==='connect'){
   if(!env('GOOGLE_MAIL_CLIENT_ID')||!env('GOOGLE_MAIL_CLIENT_SECRET'))throw new MailError('Førstegangsoppsett av Google mangler. Se veiledningen i Mail.',503);
   const state=newToken(),verifier=newToken();
   await db('mail_oauth_states','POST',{state_hash:await hashToken(state),verifier,admin_id:user.id});
   const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   url.search=new URLSearchParams({client_id:env('GOOGLE_MAIL_CLIENT_ID'),redirect_uri:callback(),response_type:'code',scope:'https://www.googleapis.com/auth/gmail.readonly',access_type:'offline',prompt:'consent',state,login_hint:MAILBOX,code_challenge:challenge,code_challenge_method:'S256'}).toString();
   return reply({url:url.href});
  }
  if(body.action==='sync'){background(doSync().then(()=>processJobs()));return reply({queued:true},202);}
  if(body.action==='disconnect'){
   await db('mail_connection?id=eq.true','PATCH',{enabled:false,last_error:null});return reply({success:true});
  }
  if(!UUID.test(body.thread_id||''))throw new MailError('Ugyldig samtale.');
  const [thread]=await db('mail_threads?id=eq.'+body.thread_id+'&select=*');if(!thread)throw new MailError('Samtalen finnes ikke.',404);
  if(body.action==='thread'){
   const offset=Number.isInteger(body.offset)?Math.max(0,Math.min(body.offset,100000)):0;
   const messages=await db('mail_messages?thread_id=eq.'+thread.id+'&select=*&order=received_at.desc,id&limit=100&offset='+offset);
   const at=thread.last_incoming_at||new Date().toISOString();await db('mail_threads?id=eq.'+thread.id,'PATCH',{read_at:at});
   return reply({thread,messages:messages.reverse(),has_more:messages.length===100});
  }
  if(body.action==='unread'){await db('mail_threads?id=eq.'+thread.id,'PATCH',{read_at:null});return reply({success:true});}
  if(body.action==='retry'){
   if(!UUID.test(body.message_id||''))throw new MailError('Ugyldig melding.');
   const [message]=await db('mail_messages?id=eq.'+body.message_id+'&thread_id=eq.'+thread.id+'&select=id,created_at');
   if(!message)throw new MailError('Meldingen finnes ikke.',404);
   if(Date.now()-Date.parse(message.created_at)>23*3600000)throw new MailError('Sendingen er for gammel for trygg automatisk gjentakelse. Kontroller Resend-historikken før et nytt svar sendes.');
   const changed=await db('mail_jobs?message_id=eq.'+message.id+'&kind=eq.reply&state=eq.failed','PATCH',{state:'pending',attempts:0,next_at:new Date().toISOString(),error_code:null});
   if(changed.length)await db('mail_messages?id=eq.'+message.id,'PATCH',{delivery_state:'queued'});
   background(processJobs());return reply({queued:changed.length>0});
  }
  if(body.action==='reply'){
   const text=typeof body.message==='string'?body.message.trim():'';
   if(!UUID.test(body.request_id||'')||text.length<2||text.length>20000)throw new MailError('Skriv et svar på mellom 2 og 20 000 tegn.');
   const result=await db('rpc/mail_ingest','POST',{p:{thread_id:thread.id,provider_key:'reply:'+body.request_id,source:thread.source,direction:'outgoing',sender_name:'Skallstuggu',sender_email:MAILBOX,contact_email:thread.contact_email,subject:thread.subject,body:text,received_at:new Date().toISOString(),delivery_state:'queued',reply_through_at:thread.last_incoming_at}});
   background(processJobs());return reply({queued:true,message_id:result.message_id,test_recipient:MAILBOX},202);
  }
  throw new MailError('Ukjent handling.');
 }catch(e){const status=e.status===403?403:e instanceof MailError?e.status:500;return reply({error:status===500?'Tjenesten svarte ikke. Meldingen er ikke bekreftet lagret; prøv igjen eller ring 906 88 873.':e.message},status);}
}
if(typeof Deno!=='undefined')Deno.serve(handler);

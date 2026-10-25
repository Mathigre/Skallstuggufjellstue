import test from 'node:test';
import assert from 'node:assert/strict';
import {processJobs,handler} from '../supabase/functions/mail-center/index.ts';
const jobId='d7097c57-3be8-4c36-b478-a7caf2baf41d',threadId='a71e91b0-b91b-4bbc-b0cd-aad8bd2e4a4b',messageId='a030230b-5951-4ff6-a541-55ea03e1c99c';
async function withFixture(run,{resendStatus=200,kind='reply',authenticated=false}={}){
 const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno,calls=[];
 globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-test-key',RESEND_API_KEY:'resend-test-key'}[name]||'')}};
 globalThis.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url:String(url),options,body});
  if((String(url).endsWith('/rpc/mail_claim_jobs')||String(url).endsWith('/rpc/mail_claim_reply')))return Response.json([{id:jobId,message_id:messageId,kind,attempts:1,created_at:new Date().toISOString()}]);
  if(String(url).includes('/mail_messages?'))return Response.json([{id:messageId,thread_id:threadId,body:'Et svar',delivery_state:'sent',reply_through_at:'2026-10-23T10:00:00Z'}]);
  if(String(url).includes('/mail_threads?'))return Response.json([{id:threadId,contact_email:'real-customer@example.test',subject:'Spørsmål'}]);
  if(String(url)==='https://skallstuggu-test.no/images/Logo.png')return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png'}});
  if(String(url)==='https://api.resend.com/emails')return Response.json(resendStatus===200?{id:'provider-123'}:{error:'temporary'}, {status:resendStatus});
  if(String(url).includes('/rpc/mail_ingest'))return Response.json({message_id:messageId});
  if(String(url).includes('/admin_users?'))return Response.json(authenticated?[{user_id:threadId}]:[]);
  if(String(url).includes('/auth/v1/user'))return Response.json(authenticated?{id:threadId}:{error:'unauthorized'},{status:authenticated?200:401});
  if(String(url).includes('/rest/v1/'))return Response.json([]);
  throw Error('Unexpected network request');
 };
 try{await run(calls);}finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
}
test('reply uses saved customer address with stable provider idempotency key',async()=>{
 await withFixture(async calls=>{await processJobs();const sent=calls.find(c=>c.url==='https://api.resend.com/emails');assert.deepEqual(sent.body.to,['real-customer@example.test']);assert.doesNotMatch(sent.body.text,/TEST/);assert.equal(sent.options.headers['Idempotency-Key'],'skall-mail-'+jobId);assert.ok(sent.body.headers['X-Skallstuggu-Signature']);assert.ok(calls.some(c=>c.url.endsWith('/rpc/mail_complete_job')));});
});
test('failed provider call does not mark reply complete and is queued for retry',async()=>{
 await withFixture(async calls=>{await processJobs();assert.ok(!calls.some(c=>c.url.endsWith('/rpc/mail_complete_job')));assert.ok(calls.some(c=>c.body?.state==='pending'));assert.ok(calls.some(c=>c.body?.delivery_state==='queued'));},{resendStatus:503});
});
test('private mail APIs reject an unauthenticated request',async()=>{
 await withFixture(async()=>{const r=await handler(new Request('https://project.supabase.co/functions/v1/mail-center',{method:'POST',headers:{Origin:'https://skallstuggu-test.no','Content-Type':'application/json'},body:JSON.stringify({action:'list'})}));assert.equal(r.status,403);});
});
test('contact validation fails before any persistent write',async()=>{
 await withFixture(async calls=>{const r=await handler(new Request('https://project.supabase.co/functions/v1/mail-center',{method:'POST',headers:{Origin:'https://skallstuggu-test.no','Content-Type':'application/json'},body:JSON.stringify({action:'contact',request_id:jobId,name:'Only'})}));assert.equal(r.status,400);assert.equal(calls.length,0);});
});

test('contact acknowledgement uses customer address and does not complete an owner reply',async()=>{
 await withFixture(async calls=>{await processJobs();const sent=calls.find(c=>c.url==='https://api.resend.com/emails');assert.deepEqual(sent.body.to,['real-customer@example.test']);assert.match(sent.body.subject,/Takk for henvendelsen/);assert.match(sent.body.text,/Vi har mottatt meldingen din og svarer så snart vi kan/);assert.ok(!calls.some(c=>c.body?.delivery_state));assert.ok(sent.body.headers['X-Skallstuggu-Outbox']);},{kind:'acknowledgement'});
});

test('owner notification still goes to test owner inbox',async()=>{await withFixture(async calls=>{await processJobs();assert.deepEqual(calls.find(c=>c.url==='https://api.resend.com/emails').body.to,['minsten.mg@gmail.com']);},{kind:'owner_email'});});

test('acknowledgement includes booking branding and escaped customer content',async()=>{
 const {acknowledgementHtml}=await import('../supabase/functions/mail-center/email-template.ts');
 const html=acknowledgementHtml({name:'<img src=x onerror=alert(1)>',message:'<script>alert(1)</script>\nHei & takk',replyEmail:'owner@example.test'});
 assert.ok(html.includes('/leiebetingelser/logo.png'));assert.ok(html.includes('#8B4A2B'));assert.ok(html.includes('Din melding til oss:'));assert.ok(html.includes('mailto:post@skallstuggu.no'));assert.ok(!html.includes('Se din booking'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
 await withFixture(async calls=>{await processJobs();const sent=calls.find(c=>c.url==='https://api.resend.com/emails');assert.ok(sent.body.html.includes('Takk for din henvendelse'));assert.ok(sent.body.text);assert.ok(sent.body.html.includes('cid:skallstuggu-logo'));assert.equal(sent.body.attachments[0].content_id,'skallstuggu-logo');},{kind:'acknowledgement'});
});

test('owner reply uses branded HTML, inline logo and working document URLs',async()=>{
 const {replyHtml}=await import('../supabase/functions/mail-center/email-template.ts');
 const html=replyHtml({name:'Anne <Test>',message:'Det koster 30 000 kr.\n<script>unsafe</script>'});
 assert.ok(html.includes('Anne &lt;Test&gt;'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('automatisk bekreftelse'));assert.ok(html.includes('/dokumenter/Personvern_Skallstuggu.pdf'));assert.ok(html.includes('/dokumenter/Leiebetingelser_Skallstuggu.pdf'));
 await withFixture(async calls=>{await processJobs();const sent=calls.find(c=>c.url==='https://api.resend.com/emails');assert.ok(sent.body.html.includes('cid:skallstuggu-logo'));assert.equal(sent.body.attachments[0].content_id,'skallstuggu-logo');assert.deepEqual(sent.body.to,['real-customer@example.test']);assert.ok(sent.body.text.includes('Et svar'));});
});

test('Send svar waits for its own job and returns confirmed send status without refresh',async()=>{
 await withFixture(async calls=>{const response=await handler(new Request('https://project.supabase.co/functions/v1/mail-center',{method:'POST',headers:{Origin:'https://skallstuggu-test.no',Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({action:'reply',thread_id:threadId,request_id:jobId,message:'Et nytt svar'})}));const result=await response.json();assert.equal(response.status,200);assert.equal(result.delivery_state,'sent');assert.ok(calls.some(c=>c.url.endsWith('/rpc/mail_claim_reply')&&c.body.p_message_id===messageId));assert.ok(calls.some(c=>c.url.endsWith('/rpc/mail_complete_job')));},{authenticated:true});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {processJobs,handler} from '../supabase/functions/mail-center/index.ts';
const jobId='d7097c57-3be8-4c36-b478-a7caf2baf41d',threadId='a71e91b0-b91b-4bbc-b0cd-aad8bd2e4a4b',messageId='a030230b-5951-4ff6-a541-55ea03e1c99c';
async function withFixture(run,{resendStatus=200}={}){
 const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno,calls=[];
 globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-test-key',RESEND_API_KEY:'resend-test-key'}[name]||'')}};
 globalThis.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url:String(url),options,body});
  if(String(url).endsWith('/rpc/mail_claim_jobs'))return Response.json([{id:jobId,message_id:messageId,kind:'reply',attempts:1,created_at:new Date().toISOString()}]);
  if(String(url).includes('/mail_messages?'))return Response.json([{id:messageId,thread_id:threadId,body:'Et svar',reply_through_at:'2026-10-23T10:00:00Z'}]);
  if(String(url).includes('/mail_threads?'))return Response.json([{id:threadId,contact_email:'real-customer@example.test',subject:'Spørsmål'}]);
  if(String(url)==='https://api.resend.com/emails')return Response.json(resendStatus===200?{id:'provider-123'}:{error:'temporary'}, {status:resendStatus});
  if(String(url).includes('/auth/v1/user'))return Response.json({error:'unauthorized'},{status:401});
  if(String(url).includes('/rest/v1/'))return Response.json([]);
  throw Error('Unexpected network request');
 };
 try{await run(calls);}finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
}
test('outbound email is forced to test inbox with stable provider idempotency key',async()=>{
 await withFixture(async calls=>{await processJobs();const sent=calls.find(c=>c.url==='https://api.resend.com/emails');assert.deepEqual(sent.body.to,['minsten.mg@gmail.com']);assert.match(sent.body.text,/real-customer@example.test/);assert.equal(sent.options.headers['Idempotency-Key'],'skall-mail-'+jobId);assert.ok(sent.body.headers['X-Skallstuggu-Signature']);assert.ok(calls.some(c=>c.url.endsWith('/rpc/mail_complete_job')));});
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

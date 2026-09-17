import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeHandler} from '../supabase/functions/fiken-booking/index.ts';
const code='test-access-code-with-at-least-32-characters';
const hash=createHash('sha256').update(code).digest('hex');
const id='81e4d927-8344-4bc6-8546-a1871529253a';
function setup(options={}){
 const booking={id,name:'Test Kunde',email:'test@example.com',phone:'',start_date:'2026-10-01',end_date:'2026-10-03',status:'approved',cancelled_at:null,linen_count:2,towel_count:2,full_cleaning:true,price_version:'2026-09-17',booking_total_ore:3190000,...options.booking};
 let state=null,lock=null,customer=null,draft=null;
 const calls=[];
 const request=async(url,init={})=>{
  const u=new URL(url),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({url,method,body});
  if(u.hostname==='db.test'){
   if(u.pathname.endsWith('fiken_test_lock')){
    if(body.request_id){if(lock)return Response.json([]);lock=body.request_id;}else lock=null;
    return Response.json([{id:1,request_id:lock}]);
   }
   if(u.pathname.endsWith('bookings'))return Response.json([booking]);
   if(u.pathname.endsWith('fiken_booking_exports')){
    if(method==='POST')state={...body};
    if(method==='PATCH')Object.assign(state,body);
    return Response.json(state?[state]:[]);
   }
  }
  const p=u.pathname;
  if(p.endsWith('/companies/apiskallstuggu'))return Response.json({name:'ApiSkallstuggu',slug:'apiskallstuggu',testCompany:options.production?false:true});
  if(p.endsWith('/invoices'))return Response.json(options.issued?[{invoiceId:99}]:[]);
  if(p.endsWith('/contacts')){
   if(method==='POST'){customer={contactId:7,...body};return new Response(null,{status:201});}
   return Response.json(customer?[customer]:[]);
  }
  if(p.includes('/invoices/drafts')){
   if(method==='POST'||method==='PUT'){
    if(options.timeout)throw new Error('network');
    draft={...body,draftId:9,gross:body.lines.reduce((s,l)=>s+l.quantity*l.unitPrice*1.25,0),customers:[customer]};
    return new Response(null,{status:201});
   }
   if(method==='DELETE'){draft=null;return new Response(null,{status:204});}
   return Response.json(draft?[draft]:[]);
  }
  throw new Error('Unexpected call '+url);
 };
 const handler=makeHandler({env:k=>({FIKEN_TOKEN:'fake',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'}[k]),request,accessHash:hash,pause:async()=>{}});
 const run=(action='sync',credential=code)=>handler(new Request('https://function.test',{method:'POST',headers:{'content-type':'application/json','x-test-access':credential},body:JSON.stringify({bookingId:id,action})}));
 return {run,booking,calls,state:()=>state,draft:()=>draft};
}
test('private test code required before database/API access',async()=>{const x=setup();assert.equal((await x.run('sync','bad')).status,403);assert.equal(x.calls.length,0);});
test('production companies and pending bookings cannot produce drafts',async()=>{for(const options of [{production:true},{booking:{status:'pending'}}]){const x=setup(options);assert.notEqual((await x.run()).status,200);assert.equal(x.calls.filter(c=>c.url.includes('api.fiken.no')&&c.method!=='GET').length,0);}});
test('customer name/email and 25% VAT match the gross booking price',async()=>{const x=setup();assert.equal((await x.run()).status,200);const c=x.calls.find(c=>c.url.endsWith('/contacts')&&c.method==='POST');assert.equal(c.body.name,'Test Kunde');assert.equal(c.body.email,'test@example.com');assert.deepEqual(x.draft().lines.map(l=>l.unitPrice),[1120000,24000,12000,240000]);assert.equal(x.draft().gross,3190000);assert.ok(x.draft().lines.every(l=>l.vatType==='HIGH'));assert.equal(x.state().state,'ready');});
test('repeat uses same customer and updates same draft; changed quantities recalculate',async()=>{const x=setup();await x.run();x.booking.linen_count=3;x.booking.booking_total_ore=3220000;assert.equal((await x.run()).status,200);assert.equal(x.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/contacts')).length,1);assert.equal(x.calls.filter(c=>c.method==='POST'&&c.url.includes('/drafts')).length,1);assert.equal(x.draft().gross,3220000);});
test('cancellation removes draft, never sends or finalizes an invoice',async()=>{const x=setup();await x.run();x.booking.cancelled_at='2026-09-17T19:00:00Z';x.booking.status='rejected';assert.equal((await x.run('cancel')).status,200);assert.equal(x.draft(),null);assert.equal(x.state().state,'cancelled');assert.equal(x.calls.filter(c=>/\/send|createInvoice/.test(c.url)).length,0);});
test('issued invoice is never overwritten',async()=>{const x=setup({issued:true});assert.equal((await x.run()).status,502);assert.equal(x.calls.filter(c=>c.method!=='GET'&&c.url.includes('api.fiken.no')).length,0);});
test('uncertain write is not blindly retried',async()=>{const x=setup({timeout:true});await x.run();await x.run();await x.run();assert.equal(x.state().state,'uncertain');assert.equal(x.calls.filter(c=>c.method==='POST'&&c.url.includes('/drafts')).length,1);});
test('tampered total and legacy reservation are rejected',async()=>{for(const booking of [{booking_total_ore:1},{price_version:null}]){const x=setup({booking});assert.equal((await x.run()).status,409);assert.equal(x.calls.filter(c=>c.url.includes('api.fiken.no')).length,0);}});

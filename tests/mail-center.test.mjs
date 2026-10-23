import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContact,parseGmail,base64url,syncGmail,MAILBOX} from '../supabase/functions/mail-center/core.ts';
const id='d7097c57-3be8-4c36-b478-a7caf2baf41d';
const form={request_id:id,name:'Kari Hansen',email:'kari@example.test',phone:'+47 999 88 777',question:'Kan vi leie hytta til et selskap?'};
test('contact requires full name, email, phone and question; rejects honeypot',()=>{
 assert.equal(validateContact(form).email,form.email);
 for(const patch of [{name:'Kari'},{email:'bad\r\nBcc:bad@test.no'},{phone:'123'},{question:'?'},{website:'spam'},{request_id:'bad'}])assert.throws(()=>validateContact({...form,...patch}));
});
function gmailMessage(overrides={}){return {id:'gmail123',threadId:'thread123',internalDate:'1792785600000',labelIds:['INBOX'],payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'Kari Hansen <kari@example.test>'},{name:'To',value:MAILBOX},{name:'Subject',value:'Et spørsmål'}],parts:[{mimeType:'text/plain',body:{data:base64url('Hei! Ærlig spørsmål om hytta.') }},{filename:'vilkår.pdf',mimeType:'application/pdf',body:{attachmentId:'private-attachment-id',size:1200}}]},...overrides};}
test('Gmail imports Unicode plain text and attachment metadata without unsafe HTML',()=>{
 const item=parseGmail(gmailMessage());assert.match(item.body,/Ærlig/);assert.equal(item.contact_email,'kari@example.test');assert.equal(item.attachments[0].filename,'vilkår.pdf');assert.equal(item.attachments[0].attachmentId,undefined);
 const html=parseGmail(gmailMessage({payload:{mimeType:'text/html',headers:[],body:{data:base64url('<script>alert(1)</script><p>Hei &amp; takk</p>')}}}));assert.equal(html.body,'Hei & takk');
});
test('sent messages are outgoing; draft exclusion is handled by synchronizer',()=>{assert.equal(parseGmail(gmailMessage({labelIds:['SENT']})).direction,'outgoing');});

function harness({connection,failId,history404=false,hasNext=false}={}){
 const saved=[],ingested=[],calls=[];let claimed=false;
 const c={id:true,enabled:true,history_id:'100',backfill_complete:true,...connection};
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/mail_claim_sync'){if(claimed)return [];claimed=true;return [{...c}];}
  if(path==='rpc/mail_ingest'){ingested.push(body.p);return {duplicate:false};}
  if(path==='mail_connection?id=eq.true'){saved.push(body);return [];}
  if(path.startsWith('mail_threads?'))return [];
  throw Error('Unexpected DB access '+path);
 };
 const gmail=async path=>{
  if(path==='/profile')return {historyId:'500'};
  if(path.startsWith('/history')){if(history404){const e=Error('expired');e.status=404;throw e;}return {history:[{messagesAdded:[{message:{id:'one'}},{message:{id:'two'}}]}],historyId:'200',...(hasNext?{nextPageToken:'next'}:{})};}
  if(path.startsWith('/messages?'))return {messages:[{id:'old'}],nextPageToken:hasNext?'older':undefined};
  if(path.startsWith('/messages/')){const msgId=path.split('/')[2].split('?')[0];if(msgId===failId)throw Error('temporary provider failure');return gmailMessage({id:msgId});}
  throw Error('Unexpected Gmail access '+path);
 };
 return {db,gmail,saved,ingested,calls};
}
test('history cursor advances only after every imported message succeeded',async()=>{
 const h=harness({failId:'two'});await assert.rejects(syncGmail(h));assert.ok(!h.saved.some(x=>x.history_id==='200'));assert.equal(h.ingested.length,1);assert.ok(h.saved.at(-1).last_error);
});
test('normal incremental sync imports incoming messages and advances cursor',async()=>{
 const h=harness();const r=await syncGmail(h);assert.equal(r.imported,2);assert.ok(h.saved.some(x=>x.history_id==='200'));assert.ok(h.ingested.every(x=>x.notify));
});
test('expired Gmail history causes complete rescan rather than silently skipping mail',async()=>{
 const h=harness({history404:true});await syncGmail(h);assert.ok(h.saved.some(x=>x.history_id==='500'&&x.backfill_complete===false));assert.equal(h.ingested[0].notify,false);
});
test('initial backfill captures history boundary and retains pagination',async()=>{
 const h=harness({connection:{history_id:null,backfill_complete:false},hasNext:true});await syncGmail(h);assert.ok(h.saved.some(x=>x.history_id==='500'));assert.ok(h.saved.some(x=>x.backfill_page==='older'&&!x.backfill_complete));
});
test('history backlog records a resumable page instead of repeating the first page forever',async()=>{
 const h=harness({hasNext:true});const r=await syncGmail(h);assert.equal(r.backlog,true);assert.ok(h.saved.some(x=>x.history_page==='next'));assert.ok(!h.saved.some(x=>x.history_id==='200'));
});
test('sync locking avoids concurrent mailbox runs',async()=>{const h=harness();await syncGmail(h);assert.deepEqual(await syncGmail(h),{busy:true});});
test('long emails retain a visible link-to-original marker',()=>{const m=gmailMessage({payload:{mimeType:'text/plain',headers:[],body:{data:base64url('x'.repeat(70000))}}});const p=parseGmail(m);assert.ok(p.body.length<60000);assert.match(p.body,/åpne Gmail/);});
test('an unverified echo header cannot silently discard an incoming message',async()=>{
 const h=harness();const original=h.gmail;h.gmail=async path=>path.startsWith('/messages/')?gmailMessage({payload:{...gmailMessage().payload,headers:[...gmailMessage().payload.headers,{name:'X-Skallstuggu-Outbox',value:id}]}}):original(path);
 await syncGmail(h);assert.equal(h.ingested.length,2);assert.ok(h.ingested.every(x=>x.direction==='incoming'));
});

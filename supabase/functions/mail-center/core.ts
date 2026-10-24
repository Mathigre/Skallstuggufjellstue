export const MAILBOX='minsten.mg@gmail.com';
export const SITE='https://skallstuggu-test.no';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class MailError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function validateContact(input){
 const clean=(v,max)=>typeof v==='string'&&v.trim().length<=max?v.trim():'';
 const name=clean(input.name,160),email=clean(input.email,254).toLowerCase(),phone=clean(input.phone,50),question=clean(input.question,10000);
 if(!UUID.test(input.request_id||''))throw new MailError('Last siden på nytt og prøv igjen.');
 if(!/\S+\s+\S+/u.test(name)||/[\r\n<>]/.test(name))throw new MailError('Skriv fullt navn, med fornavn og etternavn.');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw new MailError('Skriv en gyldig e-postadresse.');
 if(!/^[+()\d\s.-]+$/.test(phone)||phone.replace(/\D/g,'').length<7||phone.replace(/\D/g,'').length>15)throw new MailError('Skriv et gyldig telefonnummer.');
 if(question.length<5)throw new MailError('Skriv spørsmålet ditt, med minst fem tegn.');
 if(input.website)throw new MailError('Forespørselen kunne ikke sendes.');
 return {name,email,phone,question,request_id:input.request_id};
}
export function base64url(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeBody(value){try{return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));}catch{return '';}}
export function address(header=''){
 const match=header.match(/<?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
 const email=match?match[1].toLowerCase():'';
 return {email,name:header.replace(/<[^>]*>/g,'').replace(email,'').replace(/^"|"$/g,'').trim().slice(0,160)};
}
export function parseGmail(message){
 const headers=new Map((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
 const from=address(headers.get('from')),to=address(headers.get('to'));
 const labels=message.labelIds||[];const direction=labels.includes('SENT')||from.email===MAILBOX?'outgoing':'incoming';
 const text=[],html=[],attachments=[];
 function walk(part){
  if(part.filename){attachments.push({filename:String(part.filename).slice(0,255),mimeType:part.mimeType,size:part.body?.size||0});return;}
  if(part.mimeType==='text/plain'&&part.body?.data)text.push(decodeBody(part.body.data));
  if(part.mimeType==='text/html'&&part.body?.data)html.push(decodeBody(part.body.data));
  for(const child of part.parts||[])walk(child);
 }
 walk(message.payload||{});
 let body=text.join('\n').trim()||html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?\s*>|<\/(p|div)>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim()||message.snippet||'(Ingen tekst i e-posten. Se eventuelle vedlegg i Gmail.)';
 if(body.length>60000)body=body.slice(0,59800)+'\n[Lang e-post: åpne Gmail for å lese hele innholdet.]';
 const subject=String(headers.get('subject')||'(Uten emne)').replace(/[\r\n]/g,' ').slice(0,400);
 const tag=subject.match(/\[Skallstuggu ([0-9a-f-]{36})\]/i)?.[1];
 const stamp=new Date(Number(message.internalDate));
 return {provider_key:'gmail:'+message.id,gmail_thread_id:message.threadId,source:'gmail',direction,
  sender_name:from.name,sender_email:from.email||MAILBOX,contact_email:(direction==='incoming'?from.email:to.email)||MAILBOX,
  subject,body,attachments,source_labels:labels,message_id:headers.get('message-id')||null,
  received_at:Number.isFinite(stamp.getTime())?stamp.toISOString():new Date().toISOString(),delivery_state:direction==='outgoing'?'sent':'received',
  thread_id:UUID.test(tag||'')?tag:undefined,echo_job:headers.get('x-skallstuggu-outbox'),contact_echo:headers.get('x-skallstuggu-contact'),echo_signature:headers.get('x-skallstuggu-signature')};
}

export async function syncGmail({db,gmail,verifyEcho=async()=>false}){
 const [connection]=await db('rpc/mail_claim_sync','POST',{});
 if(!connection)return {busy:true};
 let imported=0;
 const save=values=>db('mail_connection?id=eq.true','PATCH',values);
 async function ingest(id,notify){
  let item;try{item=await gmail('/messages/'+encodeURIComponent(id)+'?format=full');}catch(e){if(e.status===404)return;throw e;}
  if(item.labelIds?.includes('DRAFT'))return;
  const parsed=parseGmail(item);
  const verifiedEcho=await verifyEcho(parsed);
  if(verifiedEcho&&parsed.echo_job&&UUID.test(parsed.echo_job)){
   const [job]=await db('mail_jobs?id=eq.'+parsed.echo_job+'&select=message_id');
   if(job){const [original]=await db('mail_messages?id=eq.'+job.message_id+'&select=thread_id');if(original){parsed.thread_id=original.thread_id;parsed.direction='notification';}}
  }
  if(verifiedEcho&&parsed.contact_echo&&UUID.test(parsed.contact_echo)){
   const [thread]=await db('mail_threads?id=eq.'+parsed.contact_echo+'&select=id,gmail_thread_id');
   if(thread&&!thread.gmail_thread_id)await db('mail_threads?id=eq.'+thread.id,'PATCH',{gmail_thread_id:item.threadId});
   if(thread){parsed.thread_id=thread.id;parsed.direction='notification';}
  }
  if(parsed.thread_id){const existing=await db('mail_threads?id=eq.'+parsed.thread_id+'&select=id');if(!existing.length)delete parsed.thread_id;}
  delete parsed.echo_job;delete parsed.contact_echo;delete parsed.echo_signature;
  const result=await db('rpc/mail_ingest','POST',{p:{...parsed,notify:notify&&parsed.direction==='incoming'}});
  if(!result.duplicate)imported++;
 }
 try{
  let history=connection.history_id;
  if(!history||!connection.backfill_complete){const profile=await gmail('/profile');history=profile.historyId;await save({history_id:history,history_page:null,backfill_page:null,backfill_complete:true});}
  else {
   // Advance the durable history cursor only after every page and message succeeds.
   let page=connection.history_page,latest=history;let pages=0;
   try{
    do{
     const result=await gmail('/history?startHistoryId='+encodeURIComponent(history)+'&maxResults=50'+(page?'&pageToken='+encodeURIComponent(page):''));
     const ids=new Set((result.history||[]).flatMap(h=>[...(h.messagesAdded||[]),...(h.labelsAdded||[]).filter(x=>x.labelIds?.includes('SENT'))].map(x=>x.message.id)));
     for(const id of ids)await ingest(id,true);
     page=result.nextPageToken;latest=result.historyId||latest;
     await save(page?{history_page:page}:{history_id:latest,history_page:null});
     if(++pages>=5&&page){await save({last_sync_at:new Date().toISOString(),last_error:'history_backlog',lock_until:null});return {imported,backlog:true};}
    }while(page);
   }catch(e){
    if(e.status!==404)throw e;
    const profile=await gmail('/profile');
    await save({history_id:profile.historyId,history_page:null,backfill_page:null,backfill_complete:true});
    connection.backfill_page=null;connection.backfill_complete=true;
   }
  }
  await save({last_sync_at:new Date().toISOString(),last_error:null,lock_until:null});
  return {imported};
 }catch(e){await save({last_error:e.status===401?'gmail_authorization_expired':e.message==='history_backlog'?'history_backlog':'gmail_sync_failed',lock_until:null});throw e;}
}

import { calculateQuote } from './pricing.mjs';
import { ACCESS_HASH } from './test-config.ts';
const COMPANY = 'apiskallstuggu';
const API = 'https://api.fiken.no/api/v2';
const cors = { 'Access-Control-Allow-Origin':'https://skallstuggu-test.no', 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-test-access', 'Access-Control-Allow-Methods':'POST,OPTIONS' };

export function invoiceLines(quote) {
  return quote.lines.map(line => ({ description:line.label, quantity:line.quantity, unitPrice:line.unitPrice * 4 / 5, vatType:'HIGH', incomeAccount:'3000' }));
}

export function makeHandler({ env, request=fetch, accessHash=ACCESS_HASH, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)) }) {
  return async req => {
    const json = (body,status=200) => Response.json(body,{status,headers:cors});
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
    if(req.method!=='POST')return json({error:'Kun POST er tillatt.'},405);
    const access=req.headers.get('x-test-access')||'';
    if(access.length<32||access.length>128)return json({error:'Fiken-testkoden mangler eller er feil.'},403);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access))),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==accessHash)return json({error:'Fiken-testkoden er feil.'},403);
    const token=env('FIKEN_TOKEN'), dbUrl=env('SUPABASE_URL'), key=env('SUPABASE_SERVICE_ROLE_KEY');
    if(!token||!dbUrl||!key)return json({error:'Fiken-integrasjonen mangler serveroppsett.'},503);
    const dbHeaders={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'};
    let locked=false, bookingId, state, previousState, uncertain=false;
    const requestId=crypto.randomUUID();
    const db=async(path,method='GET',body)=>{
      const response=await request(`${dbUrl}/rest/v1/${path}`,{method,headers:dbHeaders,signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok)throw new Error('Kunne ikke lese eller lagre Fiken-status i databasen.');
      return response.status===204?[]:response.json();
    };
    const saveState=async values=>db(`fiken_booking_exports?booking_id=eq.${bookingId}`,'PATCH',{...values,updated_at:new Date().toISOString()});
    try {
      const body=await req.json(); bookingId=body.bookingId;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId||'')||!['sync','cancel'].includes(body.action))return json({error:'Ugyldig booking eller handling.'},400);
      const claim=await db('fiken_test_lock?id=eq.1&request_id=is.null','PATCH',{request_id:requestId,locked_at:new Date().toISOString()});
      if(!claim.length)return json({error:'En Fiken-operasjon pågår. Vent og prøv igjen. Hvis dette vedvarer, må testlåsen kontrolleres.'},409);
      locked=true;
      const [booking]=await db(`bookings?id=eq.${bookingId}&select=id,name,email,phone,start_date,end_date,status,cancelled_at,linen_count,towel_count,full_cleaning,price_version,booking_total_ore`);
      if(!booking)return json({error:'Bookingen finnes ikke.'},404);
      if(body.action==='sync'&&(booking.status!=='approved'||booking.cancelled_at))return json({error:'Bare godkjente bookinger kan få fakturautkast.'},409);
      if(body.action==='cancel'&&!booking.cancelled_at)return json({error:'Bookingen må avbestilles først.'},409);
      if(booking.price_version!=='2026-09-17')return json({error:'Dette er en eldre booking uten den nye prisavtalen. Lag faktura manuelt.'},409);
      const quote=calculateQuote({start:booking.start_date,end:booking.end_date,linen:booking.linen_count,towels:booking.towel_count,cleaning:booking.full_cleaning});
      if(quote.total!==Number(booking.booking_total_ore))return json({error:'Prisgrunnlaget stemmer ikke. Kontroller bookingen.'},409);
      if(body.action==='sync'&&(!booking.name?.trim()||!booking.email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)))return json({error:'Kunden må ha navn og gyldig faktura-e-post.'},422);
      [state]=await db(`fiken_booking_exports?booking_id=eq.${bookingId}`);
      if(!state){ [state]=await db('fiken_booking_exports','POST',{booking_id:bookingId,company_slug:COMPANY,state:'idle'}); }
      const previous=state.state; previousState=previous;
      await saveState({state:'processing',request_id:requestId});
      const prefix=`/companies/${COMPANY}`;
      const api=async(path,method='GET',data)=>{
        if(!path.startsWith(prefix)||/\/send|createInvoice/.test(path))throw new Error('Operasjonen er ikke tillatt i testintegrasjonen.');
        await pause(300);
        let response;
        try { response=await request(API+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Request-ID':crypto.randomUUID()},...(data?{body:JSON.stringify(data)}:{})}); }
        catch { uncertain=uncertain||method!=='GET'; throw new Error('Forbindelsen til Fiken ble brutt. Kontroller resultatet i Fiken før nytt forsøk.'); }
        if(!response.ok){uncertain=uncertain||(method!=='GET'&&response.status>=500);throw new Error(`Fiken avviste operasjonen (${response.status}). Kontroller kundedata og Fiken-oppsettet.`);}
        return response;
      };
      const company=await (await api(prefix)).json();
      if(company.testCompany!==true||company.slug!==COMPANY)throw new Error('Sperret: Fiken-foretaket er ikke det bekreftede testforetaket.');
      const invoices=await (await api(`${prefix}/invoices?invoiceDraftUuid=${bookingId}&pageSize=100`)).json();
      if(invoices.length)throw new Error('Utkastet er allerede gjort om til faktura i Fiken. Endring eller kreditering må håndteres der.');
      let drafts=await (await api(`${prefix}/invoices/drafts?uuid=${bookingId}&pageSize=100`)).json();
      let draft=drafts.find(item=>item.uuid===bookingId);
      if(['uncertain','processing'].includes(previous)&&!draft)throw new Error('Forrige sending har usikkert resultat. Kontroller Fiken før eksporten nullstilles.');
      if(body.action==='cancel'){
        if(draft){await api(`${prefix}/invoices/drafts/${draft.draftId}`,'DELETE');uncertain=true;}
        await saveState({state:'cancelled',draft_id:null});uncertain=false;
        return json({success:true,cancelled:true,company:company.name});
      }
      // Match exact name and email; never overwrite another contact's details.
      const contacts=await (await api(`${prefix}/contacts?email=${encodeURIComponent(booking.email)}&customer=true&pageSize=100`)).json();
      const matches=contacts.filter(c=>c.customer&&!c.inactive&&c.name?.trim()===booking.name.trim()&&c.email?.toLowerCase()===booking.email.toLowerCase());
      if(matches.length>1)throw new Error('Flere like kunder finnes i Fiken. Kontroller dem før eksport.');
      let customer=matches[0];
      if(!customer){
        await api(`${prefix}/contacts`,'POST',{name:booking.name.trim(),email:booking.email,customer:true,memberNumberString:`booking-${bookingId}`});uncertain=true;
        const created=await (await api(`${prefix}/contacts?email=${encodeURIComponent(booking.email)}&customer=true&pageSize=100`)).json();
        customer=created.find(c=>c.name===booking.name.trim()&&c.email?.toLowerCase()===booking.email.toLowerCase());
        if(!customer)throw new Error('Kunden kan være opprettet, men kunne ikke bekreftes. Kontroller Fiken.');
        uncertain=false;
      }
      const invoice={type:'invoice',uuid:bookingId,customerId:customer.contactId,daysUntilDueDate:14,currency:'NOK',ourReference:`booking-${bookingId}`,invoiceText:`TESTFORETAK – Opphold ${booking.start_date} til ${booking.end_date}. Prisene inkluderer 25 % mva.`,lines:invoiceLines(quote)};
      await api(draft?`${prefix}/invoices/drafts/${draft.draftId}`:`${prefix}/invoices/drafts`,draft?'PUT':'POST',invoice);uncertain=true;
      drafts=await (await api(`${prefix}/invoices/drafts?uuid=${bookingId}&pageSize=100`)).json();
      draft=drafts.find(item=>item.uuid===bookingId);
      if(!draft||Number(draft.gross)!==quote.total)throw new Error('Utkastet må kontrolleres i Fiken; totalbeløpet ble ikke bekreftet.');
      await saveState({state:'ready',customer_id:customer.contactId,draft_id:draft.draftId});uncertain=false;
      return json({success:true,company:company.name,draftId:draft.draftId,customerId:customer.contactId,totalOre:quote.total,email:booking.email,sent:false});
    } catch(error){
      if(state){try{await saveState({state:uncertain||['uncertain','processing'].includes(previousState)?'uncertain':'error'});}catch{}}
      return json({error:error.message||'Fiken-utkastet kunne ikke oppdateres.'},502);
    } finally {
      if(locked){try{await db(`fiken_test_lock?id=eq.1&request_id=eq.${requestId}`,'PATCH',{request_id:null,locked_at:null});}catch{}}
    }
  };
}
if(typeof Deno!=='undefined')Deno.serve(makeHandler({env:name=>Deno.env.get(name)}));

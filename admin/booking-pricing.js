import { calculateQuote, formatMoney } from '../pricing.mjs';
import { ACCESS_HASH } from './fiken-access-hash.mjs';
let accessCode = '';
const busy = new Set();

window.ensureFikenAccess = async function() {
  if (accessCode) return true;
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'booking-editor';
    dialog.innerHTML = `<form><h2>Fiken-testtilgang</h2><p>Utkastet opprettes i ApiSkallstuggu. Bruk den egne Fiken-testkoden.</p><label>Testkode<input type="password" name="code" required autocomplete="off" style="width:100%;box-sizing:border-box;padding:12px"></label><p role="alert"></p><div class="booking-actions"><button class="btn-success">Fortsett</button><button type="button" class="btn-neutral">Avbryt</button></div></form>`;
    dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.remove(); resolve(Boolean(accessCode)); });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const value = dialog.querySelector('input').value.trim();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
      if (hash !== ACCESS_HASH) { dialog.querySelector('[role="alert"]').textContent = 'Feil testkode.'; return; }
      accessCode = value; dialog.close();
    };
    document.body.appendChild(dialog); dialog.showModal();
  });
};

async function exportBooking(id, action='sync') {
  if (!await window.ensureFikenAccess()) throw new Error('Fiken-utkastet er ikke oppdatert: testtilgangen ble avbrutt.');
  const response = await fetch(`${supabaseUrl}/functions/v1/fiken-booking`, {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${supabaseAnonKey}`, apikey:supabaseAnonKey,'x-test-access':accessCode},
    body:JSON.stringify({bookingId:String(id),action})
  });
  const result = await response.json().catch(()=>({}));
  if (!response.ok || !result.success) {
    if(response.status===403)accessCode='';
    throw new Error(result.error||'Fiken-utkastet kunne ikke oppdateres.');
  }
  return result;
}

window.appendBookingPricing = function(card, booking) {
  if (!booking.price_version) return;
  const details=card.querySelector('.booking-details');
  const section=document.createElement('div'); section.className='payment-box';
  try {
    const quote=calculateQuote({start:booking.start_date,end:booking.end_date,linen:booking.linen_count,towels:booking.towel_count,cleaning:booking.full_cleaning});
    const title=document.createElement('strong'); title.textContent=`Avtalt totalpris: ${formatMoney(quote.total)} inkl. 25 % mva`; section.appendChild(title);
    for(const line of quote.lines){const p=document.createElement('p');p.textContent=`${line.label}: ${line.quantity} × ${formatMoney(line.unitPrice)}`;section.appendChild(p);}
    const note=document.createElement('p');note.textContent=`Faktura-e-post: ${booking.email||'Mangler'}. Utkast i ApiSkallstuggu sendes ikke automatisk.`;section.appendChild(note);
    if(booking.status==='approved'||booking.cancelled_at){
      const button=document.createElement('button');button.className='btn-neutral';button.type='button';
      button.textContent=booking.cancelled_at?'Fjern avbestilt utkast i Fiken':'Opprett / oppdater Fiken-utkast';
      button.onclick=async()=>{button.disabled=true;try{const r=await exportBooking(booking.id,booking.cancelled_at?'cancel':'sync');alert(r.cancelled?'Fiken-utkastet er fjernet.':`Utkast ${r.draftId} er klart i ${r.company}. Ingen faktura er sendt.`);}catch(e){alert(e.message);}finally{button.disabled=false;}};
      section.appendChild(button);
    }
  } catch(error){section.textContent=error.message;}
  details.prepend(section);
};

const originalApprove=window.approve;
window.approve=async function(id){
  const booking=allBookings.find(b=>String(b.id)===String(id));
  if(!booking?.price_version)return originalApprove(id);
  if(busy.has(String(id)))return;
  busy.add(String(id));
  try{
    if(!await window.ensureFikenAccess())return;
    await originalApprove(id);
    const {data,error}=await supabaseClient.from('bookings').select('status,cancelled_at').eq('id',id).maybeSingle();
    if(error)throw new Error('Kunne ikke kontrollere bookingstatus. Prøv Fiken-knappen på bookingen.');
    if(data?.status!=='approved'||data.cancelled_at)return;
    const result=await exportBooking(id);
    alert(`Fakturautkast ${result.draftId} er klart i ApiSkallstuggu: ${formatMoney(result.totalOre)}. Ingen faktura er sendt.`);
  }catch(error){alert(`Kontroller Fiken-utkastet. Bookingen kan være godkjent selv om eksporten feilet.\n${error.message}`);}
  finally{busy.delete(String(id));}
};

const originalSave=window.saveBookingChanges;
window.saveBookingChanges=async function(booking,values){
  if(booking.price_version){calculateQuote({start:values.start_date,end:values.end_date,linen:values.linen_count??booking.linen_count,towels:values.towel_count??booking.towel_count,cleaning:values.full_cleaning??booking.full_cleaning});}
  if(booking.price_version&&booking.status==='approved'&&!await window.ensureFikenAccess())throw new Error('Lagring avbrutt. Fiken-tilgang kreves for å oppdatere fakturautkastet samtidig.');
  const result=await originalSave(booking,values);
  if(booking.price_version&&booking.status==='approved'){
    try{await exportBooking(booking.id);}catch(error){alert(`Bookingen er lagret, men Fiken-utkastet må oppdateres via knappen på bookingen.\n${error.message}`);}
  }
  return result;
};

const originalCancel=window.cancelBooking;
window.cancelBooking=async function(booking){
  await originalCancel(booking);
  if(!booking.price_version)return;
  const {data,error}=await supabaseClient.from('bookings').select('cancelled_at').eq('id',booking.id).maybeSingle();
  if(error||!data?.cancelled_at)return;
  try{await exportBooking(booking.id,'cancel');}catch(error){alert(`Bookingen er avbestilt. Kontroller at utkastet også blir fjernet i Fiken.\n${error.message}`);}
};

// The initial dashboard request can finish before this module is loaded.
await renderDashboard();

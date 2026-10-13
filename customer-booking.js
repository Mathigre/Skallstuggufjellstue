const apiUrl='https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/booking-public';
const anonKey="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";
const el=id=>document.getElementById(id);
let token=null, busy=false;
const initialToken=new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null,'',location.pathname);
async function api(body){const r=await fetch(apiUrl,{method:'POST',headers:{apikey:anonKey,Authorization:'Bearer '+anonKey,'Content-Type':'application/json'},body:JSON.stringify({...body,token}),signal:AbortSignal.timeout(25000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Kunne ikke hente bestillingen.');return data;}
function parseCode(value){value=value.trim();if(/^[a-f0-9]{64}$/i.test(value))return value.toLowerCase();try{const u=new URL(value);if(u.origin!==location.origin||u.pathname!='/reply.html')return null;const t=new URLSearchParams(u.hash.slice(1)).get('token');return /^[a-f0-9]{64}$/.test(t||'')?t:null;}catch{return null;}}
function date(value){return value?new Intl.DateTimeFormat('nb-NO',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Oslo'}).format(new Date(value.length===10?value+'T12:00:00Z':value)):'Ikke registrert';}
function render({booking:b,messages}){
 el('loginPanel').hidden=true;el('bookingPanel').hidden=false;el('guestName').textContent='Hei, '+b.name;
 const state=b.cancelled_at?'cancelled':b.status;
 el('bookingStatus').textContent=({approved:'Bekreftet',rejected:'Avslått',cancelled:'Avbestilt'})[state]||'Under behandling';
 el('statusExplanation').textContent=({approved:'Vi gleder oss til å ønske deg velkommen!',rejected:'Forespørselen ble ikke godkjent. Kontakt oss gjerne om andre datoer.',cancelled:'Denne bestillingen er avbestilt.'})[state]||'Vi har mottatt forespørselen. Oppholdet er først bekreftet når vi har godkjent bestillingen.';
 el('bookingInfo').replaceChildren();
 for(const [label,value] of [['Ankomst',date(b.start_date)],['Avreise',date(b.end_date)],['Bestilt',date(b.created_at)],['Totalpris inkl. mva',b.booking_total_ore==null?'Ikke fastsatt':new Intl.NumberFormat('nb-NO',{style:'currency',currency:'NOK',maximumFractionDigits:0}).format(b.booking_total_ore/100)]]){
 const box=document.createElement('div');box.className='detail';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;box.append(l,v);el('bookingInfo').append(box);}
 el('extras').textContent=[Number(b.linen_count||0)+' sett sengetøy',Number(b.towel_count||0)+' håndklær',b.full_cleaning?'Sluttrengjøring bestilt':'Sluttrengjøring ikke bestilt'].join(' · ');
 el('bookingMessage').textContent=b.message?'Din forespørsel: '+b.message:'';
 el('messages').replaceChildren();
 for(const m of messages||[]){const box=document.createElement('div');box.className='message '+(m.sender==='admin'?'admin':'customer');const meta=document.createElement('div');meta.className='meta';meta.textContent=(m.sender==='admin'?'Skallstuggu':'Deg')+' · '+new Date(m.created_at).toLocaleString('nb-NO',{timeZone:'Europe/Oslo'});const text=document.createElement('div');text.textContent=m.message;box.append(meta,text);el('messages').append(box);}
 if(!messages?.length)el('messages').textContent='Ingen meldinger ennå.';
}
el('loginForm').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;el('loginButton').disabled=true;el('loginStatus').textContent='Åpner bestillingen …';try{token=parseCode(el('bookingCode').value);if(!token)throw new Error('Lim inn den private bookinglenken eller hele bestillingskoden fra e-posten.');render(await api({action:'login',email:el('loginEmail').value.trim()}));el('loginForm').reset();el('loginStatus').textContent='';el('overviewTitle').focus();}catch(error){token=null;el('loginStatus').textContent=error.name==='TimeoutError'?'Det tok for lang tid. Prøv igjen.':error.message;}finally{busy=false;el('loginButton').disabled=false;}});
el('logout').addEventListener('click',()=>{token=null;el('bookingPanel').hidden=true;el('loginPanel').hidden=false;['guestName','bookingInfo','bookingMessage','messages','extras','status'].forEach(id=>el(id).replaceChildren());el('messageForm').reset();el('loginStatus').textContent='';el('loginEmail').focus();});
el('messageForm').addEventListener('submit',async event=>{event.preventDefault();el('sendBtn').disabled=true;try{await api({action:'message',message:el('replyMessage').value.trim()});el('replyMessage').value='';el('status').textContent='Meldingen er sendt.';render(await api({action:'get'}));}catch(error){el('status').textContent=error.message;}finally{el('sendBtn').disabled=false;}});
if(initialToken){token=parseCode(initialToken);if(token){el('loginStatus').textContent='Åpner bestillingen …';busy=true;el('loginButton').disabled=true;api({action:'get'}).then(render).catch(error=>{token=null;el('loginStatus').textContent=error.message;}).finally(()=>{busy=false;el('loginButton').disabled=false;});}}

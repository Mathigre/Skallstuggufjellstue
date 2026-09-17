import {validateSettings,calculateQuote,formatMoney} from '../pricing.mjs?v=season1';
import {ensureFikenAccess,getAccessCode,clearAccessCode} from './test-access.mjs';
import {supabaseUrl,supabaseAnonKey} from './public-connection.mjs';
const form=document.getElementById('pricesForm'),status=document.getElementById('status'),save=document.getElementById('save'),seasons=document.getElementById('seasons');
let revision,dirty=false,saving=false;
const headers={apikey:supabaseAnonKey,Authorization:`Bearer ${supabaseAnonKey}`};
function message(text,error=false){status.textContent=text;status.className=error?'error':'';}
function addSeason(s={name:'Ny sesong',start:'',end:'',weekday:900000,weekend:1400000}) {
 const row=document.createElement('fieldset');row.className='season';
 row.innerHTML='<legend>Sesong</legend><label>Navn<input name="name" maxlength="80" required></label><div class="price-grid"><label>Første natt<input name="start" type="date" required></label><label>Siste natt<input name="end" type="date" required></label><label>Søndag–torsdag (kr)<input name="weekday" type="number" min="1" max="1000000" step="1" required></label><label>Fredag–lørdag (kr)<input name="weekend" type="number" min="1" max="1000000" step="1" required></label></div><button type="button" class="remove">Fjern sesong</button>';
 for(const name of ['name','start','end','weekday','weekend'])row.querySelector(`[name="${name}"]`).value=['weekday','weekend'].includes(name)?s[name]/100:s[name];
 row.querySelector('button').onclick=()=>{row.remove();changed();};seasons.appendChild(row);
}
function settings(){return validateSettings({weekday:Number(document.getElementById('weekday').value)*100,weekend:Number(document.getElementById('weekend').value)*100,seasons:[...seasons.children].map(row=>Object.fromEntries(['name','start','end','weekday','weekend'].map(key=>[key,['weekday','weekend'].includes(key)?Number(row.querySelector(`[name="${key}"]`).value)*100:row.querySelector(`[name="${key}"]`).value])))});}
function preview(){const target=document.getElementById('preview');target.replaceChildren();try{const quote=calculateQuote({start:document.getElementById('previewStart').value,end:document.getElementById('previewEnd').value,settings:settings()});for(const line of quote.lines){const p=document.createElement('p');p.textContent=`${line.label}: ${line.quantity} × ${formatMoney(line.unitPrice)}`;target.append(p);}const strong=document.createElement('strong');strong.textContent=`Total: ${formatMoney(quote.total)} inkl. mva`;target.append(strong);}catch(error){target.textContent=error.message;}}
function changed(){dirty=true;message('Du har ulagrede prisendringer.');preview();}
form.addEventListener('input',changed);document.getElementById('addSeason').onclick=()=>{addSeason();changed();};
for(const id of ['previewStart','previewEnd'])document.getElementById(id).addEventListener('input',preview);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
form.onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;save.disabled=true;
 try{const next=settings();if(!await ensureFikenAccess())return;
  const response=await fetch(`${supabaseUrl}/functions/v1/pricing-admin`,{method:'POST',headers:{...headers,'Content-Type':'application/json','x-test-access':getAccessCode()},body:JSON.stringify({revision,settings:next})});
  const result=await response.json();if(!response.ok){if(response.status===403)clearAccessCode();throw new Error(result.error||'Lagring feilet.');}
  revision=result.revision;dirty=false;message('Prisene er lagret og gjelder nå for nye bookinger.');
 }catch(error){message(error.message,true);}finally{saving=false;save.disabled=!revision;}
};
try{const response=await fetch(`${supabaseUrl}/rest/v1/booking_price_settings?id=eq.1&select=revision,settings`,{headers,cache:'no-store'});if(!response.ok)throw new Error('Kunne ikke hente priser.');const [row]=await response.json();const valid=validateSettings(row.settings);revision=row.revision;document.getElementById('weekday').value=valid.weekday/100;document.getElementById('weekend').value=valid.weekend/100;valid.seasons.forEach(addSeason);save.disabled=false;message('Gjeldende priser er lastet.');}catch(error){message(error.message,true);}

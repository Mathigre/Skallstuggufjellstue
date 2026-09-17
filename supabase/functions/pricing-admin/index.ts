import {validateSettings} from './pricing.mjs';
import {ACCESS_HASH} from './test-config.ts';
const cors={'Access-Control-Allow-Origin':'https://skallstuggu-test.no','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-test-access','Access-Control-Allow-Methods':'POST,OPTIONS'};
export function makeHandler({env,request=fetch,accessHash=ACCESS_HASH}) {return async req=>{
 const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Kun POST er tillatt.'},405);
 const code=req.headers.get('x-test-access')||'';
 if(code.length<32||code.length>128)return reply({error:'Privat testkode kreves.'},403);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==accessHash)return reply({error:'Feil testkode.'},403);
 try {
  const body=await req.json();
  if(!Number.isSafeInteger(body.revision)||body.revision<1) return reply({error:'Ugyldig prisversjon. Last siden på nytt.'},400);
  const settings=validateSettings(body.settings),key=env('SUPABASE_SERVICE_ROLE_KEY'),url=env('SUPABASE_URL');
  if(!key||!url)return reply({error:'Serveroppsettet mangler.'},503);
  const res=await request(`${url}/rest/v1/booking_price_settings?id=eq.1&revision=eq.${body.revision}`,{method:'PATCH',signal:AbortSignal.timeout(20000),headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({settings,revision:body.revision+1,updated_at:new Date().toISOString()})});
  if(!res.ok)return reply({error:'Prisene kunne ikke lagres.'},502);
  const rows=await res.json();if(!rows.length)return reply({error:'Prisene er endret i en annen fane. Last siden på nytt før du redigerer videre.'},409);
  return reply({success:true,...rows[0]});
 }catch(error){return reply({error:error instanceof TypeError?'Nettverksfeil. Last siden på nytt for å kontrollere om prisene ble lagret.':error.message},400);}
};}
if(typeof Deno!=='undefined')Deno.serve(makeHandler({env:name=>Deno.env.get(name)}));

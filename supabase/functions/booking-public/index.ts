import {db,hashToken,newToken} from './auth.ts';
const cors={'Access-Control-Allow-Origin':'https://skallstuggu-test.no','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const env=name=>Deno.env.get(name);
const fields='id,name,start_date,end_date,status,message,cancelled_at,booking_total_ore,linen_count,towel_count,full_cleaning';
export async function handler(req) {
 const json=(body,status=200)=>Response.json(body,{status,headers:cors});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Kun POST er tillatt.'},405);
 try {
  const raw=await req.text();if(raw.length>12000)return json({error:'Forespørselen er for stor.'},413);
  const body=JSON.parse(raw),ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const limit=async(key,max,seconds)=>db('rpc/consume_booking_limit',env,'POST',{limit_key:await hashToken(key),max_hits:max,seconds});
  if(!await limit('ip:'+ip,120,60))return json({error:'For mange forespørsler. Prøv igjen senere.'},429);
  if(body.action==='calendar'){
   const today=new Date().toISOString().slice(0,10);
   const dates=await db('bookings?select=start_date,end_date&status=eq.approved&cancelled_at=is.null&end_date=gte.'+today+'&order=start_date',env);
   return json({dates:dates.map(({start_date,end_date})=>({start_date,end_date}))});
  }
  if(body.action==='create'){
   const p=body.booking||{};
   const text=(v,max)=>typeof v==='string'&&v.trim().length<=max?v.trim():'';
   const name=text(p.name,160),email=text(p.email,254).toLowerCase(),phone=text(p.phone,50),message=text(p.message,2000);
   if(!name||!phone||!/^\S+@\S+\.\S+$/.test(email)||!/^\d{4}-\d{2}-\d{2}$/.test(p.start_date||'')||!/^\d{4}-\d{2}-\d{2}$/.test(p.end_date||''))return json({error:'Fyll inn gyldig navn, e-post, telefon og datoer.'},400);
   const nights=(Date.parse(p.end_date)-Date.parse(p.start_date))/86400000;
   if(!Number.isInteger(nights)||nights<1||nights>366||p.start_date<new Date().toISOString().slice(0,10)||![p.linen_count,p.towel_count].every(n=>Number.isInteger(n)&&n>=0&&n<=1000)||typeof p.full_cleaning!=='boolean'||!Number.isInteger(p.pricing_revision))return json({error:'Kontroller datoer og tillegg.'},400);
   if(!await limit('create:'+ip,6,3600)||!await limit('email:'+email,3,3600))return json({error:'For mange bookingforsøk. Prøv igjen senere eller kontakt oss.'},429);
   const [prices]=await db('booking_price_settings?id=eq.1&select=revision',env);
   if(prices.revision!==p.pricing_revision)return json({error:'Prisene er endret. Last siden på nytt og kontroller totalen.'},409);
   const overlaps=await db('bookings?select=start_date&status=eq.approved&cancelled_at=is.null&start_date=lt.'+p.end_date+'&end_date=gt.'+p.start_date+'&limit=1',env);
   if(overlaps.length)return json({error:'Perioden er allerede booket.'},409);
   const token=newToken();
   const booking=await db('rpc/create_secure_booking',env,'POST',{access_hash:await hashToken(token),payload:{name,email,phone,message,start_date:p.start_date,end_date:p.end_date,linen_count:p.linen_count,towel_count:p.towel_count,full_cleaning:p.full_cleaning,pricing_revision:p.pricing_revision}});
   const replyUrl='https://skallstuggu-test.no/reply.html#token='+token;
   let emailsSent=true;
   for(const type of ['request_customer','request_owner']){
    try{const key=env('SUPABASE_SERVICE_ROLE_KEY');const res=await fetch(env('SUPABASE_URL')+'/functions/v1/resend-email',{method:'POST',headers:{Authorization:'Bearer '+key,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({type,bookingId:booking.id,replyUrl}),signal:AbortSignal.timeout(20000)});if(!res.ok)emailsSent=false;}catch{emailsSent=false;}
   }
   return json({success:true,replyUrl,emailsSent,totalOre:booking.total});
  }
  if(!['get','message'].includes(body.action)||!/^[a-f0-9]{64}$/.test(body.token||''))return json({error:'Ugyldig bookinglenke. Bruk den private lenken fra e-posten.'},403);
  const [access]=await db('booking_access_tokens?token_hash=eq.'+await hashToken(body.token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=booking_id,email',env);
  if(!access)return json({error:'Lenken er ugyldig eller utløpt. Kontakt Skallstuggu for en ny lenke.'},403);
  const [booking]=await db('bookings?id=eq.'+access.booking_id+'&select='+fields+',email',env);
  if(!booking||booking.email!==access.email)return json({error:'Lenken er ugyldig eller utløpt.'},403);
  if(body.action==='message'){
   if(typeof body.message!=='string'||!body.message.trim()||body.message.length>2000)return json({error:'Meldingen må ha mellom 1 og 2 000 tegn.'},400);
   if(!await limit('message:'+access.booking_id,10,600))return json({error:'For mange meldinger. Prøv igjen senere.'},429);
   await db('booking_messages',env,'POST',{booking_id:access.booking_id,sender:'customer',message:body.message.trim()});
   return json({success:true});
  }
  delete booking.email;
  const messages=await db('booking_messages?booking_id=eq.'+access.booking_id+'&select=sender,message,created_at&order=created_at',env);
  return json({booking,messages});
 }catch{return json({error:'Forespørselen kunne ikke behandles. Prøv igjen eller kontakt Skallstuggu.'},400);}
}
Deno.serve(handler);

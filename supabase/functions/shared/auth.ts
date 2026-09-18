export class AccessError extends Error { status=403; }
export async function requireAdmin(req, env, request=fetch) {
 const authorization=req.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))throw new AccessError('Admininnlogging kreves.');
 const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
 const response=await request(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new AccessError('Logg inn på nytt.');
 const user=await response.json();
 if(!user.id||user.is_anonymous)throw new AccessError('Ingen admintilgang.');
 const members=await request(base+'/rest/v1/admin_users?user_id=eq.'+encodeURIComponent(user.id)+'&select=user_id',{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
 if(!members.ok||!(await members.json()).length)throw new AccessError('Ingen admintilgang.');
 return user;
}
export async function db(path,env,method='GET',body,request=fetch) {
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const res=await request(env('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},signal:AbortSignal.timeout(20000),...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!res.ok)throw new Error('Databasen avviste forespørselen. Kontroller dataene og prøv igjen.');
 return res.status===204?null:res.json();
}
export const hashToken=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');


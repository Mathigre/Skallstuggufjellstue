const cloudflareOrigin='https://skallstuggufjellstue.pages.dev';
export function withCloudflareOrigin(handler){
 return async req=>{
  const response=await handler(req);
  if(req.headers.get('Origin')!==cloudflareOrigin)return response;
  const headers=new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin',cloudflareOrigin);
  const vary=headers.get('Vary')||'';
  if(!vary.split(',').some(v=>v.trim().toLowerCase()==='origin'))headers.set('Vary',vary?vary+', Origin':'Origin');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 };
}
export function serveWithCloudflareOrigin(handler){Deno.serve(withCloudflareOrigin(handler));}

import test from 'node:test';
import assert from 'node:assert/strict';
import {withCloudflareOrigin} from '../supabase/functions/shared/cloudflare-origin.ts';
test('exact Cloudflare origin works for preflight and authenticated responses',async()=>{
 for(const method of ['OPTIONS','POST']){
 const wrapped=withCloudflareOrigin(()=>new Response('admin required',{status:403,headers:{'Access-Control-Allow-Origin':'https://skallstuggu-test.no','Vary':'Accept-Encoding'}}));
 const r=await wrapped(new Request('https://example.test',{method,headers:{Origin:'https://skallstuggufjellstue.pages.dev'}}));
 assert.equal(r.status,403);assert.equal(await r.text(),'admin required');assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://skallstuggufjellstue.pages.dev');assert.match(r.headers.get('Vary'),/Origin/);
 }
});
test('other domains do not receive the Cloudflare CORS allowance',async()=>{
 const wrapped=withCloudflareOrigin(()=>new Response('ok',{headers:{'Access-Control-Allow-Origin':'https://skallstuggu-test.no'}}));
 for(const origin of ['https://skallstuggu-test.no','https://evil.example','https://fake.skallstuggufjellstue.pages.dev']){
 const r=await wrapped(new Request('https://example.test',{headers:{Origin:origin}}));assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://skallstuggu-test.no');
 }
});
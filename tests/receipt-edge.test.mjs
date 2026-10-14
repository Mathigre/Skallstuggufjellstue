// Node 24 transport tests. Real Deno source is transformed, not reimplemented.
// Set RECEIPT_TEST_MODULES to a node_modules directory containing pdf-lib 1.17.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {stripTypeScriptTypes,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const pdfPath=require.resolve('pdf-lib',{paths:[process.env.RECEIPT_TEST_MODULES||process.cwd()]});
const source=new URL('../supabase/functions/receipt-analyze/index.ts',import.meta.url);
const generated=new URL('../supabase/functions/receipt-analyze/.test-index.mjs',import.meta.url);
let code=await readFile(source,'utf8');
code=code.replace("'npm:pdf-lib@1.17.1'",JSON.stringify(pathToFileURL(pdfPath).href)).replace('Deno.serve(handle);','');
await writeFile(generated,stripTypeScriptTypes(code,{mode:'transform'}));
const values={SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',GEMINI_API_KEY:'synthetic-test-key'};
globalThis.Deno={env:{get:key=>values[key]}};
const {handle}=await import(generated.href);
await unlink(generated);
const id='11111111-1111-4111-8111-111111111111';
const data={vendor:'Synthetic',purchase_date:'2026-10-13',currency:'NOK',net:100,vat:25,gross:125,vat_rates:[{rate:25,net:100,vat:25,gross:125}]};
const receipt={id,original_path:id+'/original',mime_type:'image/jpeg',revision:1,review_status:'draft',synthetic:true};
let calls=[],mode='ok';
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(url,init={})=>{
 calls.push({url:String(url),init});const u=String(url);
 if(u.endsWith('/auth/v1/user'))return mode==='unauthorized'?json({},401):json({id,is_anonymous:false});
 if(u.includes('/admin_users?'))return json(mode==='nonadmin'?[]:[{user_id:id}]);
 if(u.includes('/receipt_settings?'))return json([{real_documents_enabled:false,model:'gemini-2.5-flash-lite',enabled:true}]);
 if(u.includes('/receipts?'))return json([receipt]);
 if(u.includes('/storage/v1/object/'))return new Response(new Uint8Array([255,216,255,224,0]));
 if(u.endsWith('/rpc/receipt_reserve'))return mode==='quota'?json({message:'ADMIN_QUOTA'},400):json({run_id:id,model:'gemini-2.5-flash-lite',input_rate:.1,output_rate:.4});
 if(u.endsWith('/rpc/receipt_finish'))return json(null);
 if(u.endsWith('/rpc/receipt_edit'))return json(receipt);
 if(u.includes('generativelanguage')){
 assert.equal(init.headers['x-goog-api-key'],'synthetic-test-key');assert.ok(!u.includes('key='));
 const payload=JSON.parse(init.body);assert.equal(payload.generationConfig.maxOutputTokens,4096);
 assert.equal(payload.contents[0].parts[0].inlineData.data,Buffer.from([255,216,255,224,0]).toString('base64'));
 if(mode==='google429')return json({error:{message:'quota'}},429);
 if(mode==='google402')return json({error:{message:'payment required'}},402);
 if(mode==='timeout')throw Error('timeout');
 return json({candidates:[{finishReason:mode==='truncated'?'MAX_TOKENS':'STOP',content:{parts:[{text:mode==='badjson'?'garbage':JSON.stringify(data)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:200}});
 }
 throw Error('Unexpected transport '+u);
};
const request=(body,authorization=true)=>new Request('https://example.test/functions/v1/receipt-analyze',{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:'Bearer test-admin'}:{})},body:JSON.stringify(body)});
async function call(body={action:'analyze',id,revision:1},m='ok',auth=true){mode=m;calls=[];const r=await handle(request(body,auth));return {status:r.status,result:await r.json()};}
test('no token and non-admin are rejected before receipt access',async()=>{
 assert.equal((await call({},'ok',false)).status,403);assert.equal(calls.length,0);
 assert.equal((await call({},'nonadmin')).status,403);assert.ok(calls.every(c=>!c.url.includes('/receipts')));
});
test('one generation request, actual file bytes and usage passed to finish',async()=>{
 assert.equal((await call()).status,200);assert.equal(calls.filter(c=>c.url.includes('generativelanguage')).length,1);
 const finish=JSON.parse(calls.find(c=>c.url.endsWith('receipt_finish')).init.body);assert.equal(finish.p_input,1000);assert.equal(finish.p_data.gross,125);
});
test('quota blocks generation',async()=>{assert.equal((await call(undefined,'quota')).status,429);assert.ok(!calls.some(c=>c.url.includes('generativelanguage')));});
for(const mode of ['google402','google429','timeout','truncated','badjson'])test(mode+' returns error without retry or fabricated data',async()=>{
 const r=await call(undefined,mode);assert.equal(r.status,502);assert.equal(calls.filter(c=>c.url.includes('generativelanguage')).length,1);
 if(mode==='google402')assert.match(r.result.error,/betaling/);
 const f=JSON.parse(calls.find(c=>c.url.endsWith('receipt_finish')).init.body);assert.equal(f.p_data,null);assert.ok(f.p_error);if(mode==='timeout')assert.equal(f.p_input,null);
});
test('approval needs explicit review and matching money',async()=>{
 assert.equal((await call({action:'approve',id,revision:1,data,confirmed:false})).status,400);
 assert.equal((await call({action:'approve',id,revision:1,data:{...data,gross:999},confirmed:true})).status,400);
 assert.ok(!calls.some(c=>c.url.endsWith('receipt_edit')));
 assert.equal((await call({action:'approve',id,revision:1,data,confirmed:true})).status,200);
});
test('list and edit never call Gemini',async()=>{await call({action:'save',id,revision:1,data});assert.ok(!calls.some(c=>c.url.includes('generativelanguage')));});

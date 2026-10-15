import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDraft,makeHandler} from '../supabase/functions/fiken-receipt/index.ts';
const receipt=()=>({synthetic:false,review_status:'approved',reviewed_data:{vendor:'Testbutikk AS',purchase_date:'2026-10-15',currency:'NOK',account:'6600',net:100,vat:25,gross:125,vat_rates:[{rate:25,net:100,vat:25,gross:125}]}});
test('reviewed real receipt maps to an unposted draft in ore',()=>{
 const d=makeDraft(receipt());assert.equal(d.lines[0].net,10000);assert.equal(d.lines[0].gross,12500);assert.equal(d.lines[0].incomeAccount,'6600');assert.equal(d.paid,false);
});
test('unapproved, deleted or unreconciled receipts are rejected',()=>{
 const r=receipt();r.review_status='draft';assert.throws(()=>makeDraft(r));r.review_status='approved';r.deleted_at='2026-10-15';assert.throws(()=>makeDraft(r));delete r.deleted_at;r.reviewed_data.gross=126;assert.throws(()=>makeDraft(r));
});
test('unauthenticated calls cannot access Fiken',async()=>{
 let calls=0;const handle=makeHandler({env:()=>'',request:()=>{calls++;throw Error();}});
 const result=await handle(new Request('https://example.test',{method:'POST',body:'{}'}));assert.equal(result.status,403);assert.equal(calls,0);
});

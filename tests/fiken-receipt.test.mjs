import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {validateData} from '../admin/receipt-data.mjs';

// Evaluate the production payload builder unchanged, without making network calls.
const source=await readFile(new URL('../supabase/functions/fiken-receipt/index.ts',import.meta.url),'utf8');
const start=source.indexOf('const ore='),end=source.indexOf('export function makeHandler');
assert.ok(start>=0&&end>start,'Cannot find production payload builder');
const snippet=source.slice(start,end).replace('export function makeDraft','function makeDraft');
const makeDraft=vm.runInNewContext(stripTypeScriptTypes(snippet,{mode:'transform'})+'\nmakeDraft;', {validateData});
const data=()=>({
 vendor:'Fiktiv byggbutikk',organization_number:'999999999',purchase_date:'2026-09-14',
 category:'Vedlikehold',account:'6600',currency:'NOK',payment_method:'Kort',
 net:3877.44,vat:969.36,gross:4846.80,rounding:null,
 items:[],notes:null,uncertainties:[],
 vat_rates:[{rate:25,net:3877.44,vat:969.36,gross:4846.80}]
});
const receipt=()=>({id:'205c9da6-a550-4cee-8115-db6dd0ef3555',deleted_at:null,synthetic:true,review_status:'approved',reviewed_data:data()});
test('OBS-sized test receipt builds Fiken purchase draft in øre',()=>{
 const p=makeDraft(receipt());
 assert.equal(p.invoiceIssueDate,'2026-09-14');
 assert.equal(p.cash,true);
 assert.equal(p.paid,false); // drafts are not booked or marked paid automatically
 assert.equal(p.currency,'NOK');
 assert.equal(p.lines.length,1);
 assert.equal(p.lines[0].net,387744);
 assert.equal(p.lines[0].gross,484680);
 assert.equal(p.lines[0].vatType,'HIGH');
 assert.equal(p.lines[0].incomeAccount,'6600');
});
test('real receipts are rejected in test-only route',()=>assert.throws(()=>makeDraft({...receipt(),synthetic:false})));
test('unapproved receipts are rejected',()=>assert.throws(()=>makeDraft({...receipt(),review_status:'draft'})));
test('deleted receipts are rejected',()=>assert.throws(()=>makeDraft({...receipt(),deleted_at:'2026-10-15'})));
test('unknown account is rejected',()=>assert.throws(()=>makeDraft({...receipt(),reviewed_data:{...data(),account:null}})));
test('tampered VAT data is rejected',()=>assert.throws(()=>makeDraft({...receipt(),reviewed_data:{...data(),vat_rates:[{rate:25,net:3877.44,vat:969.36,gross:4846.81}]}})));
test('non-NOK currency is rejected',()=>assert.throws(()=>makeDraft({...receipt(),reviewed_data:{...data(),currency:'USD'}})));

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const start=source.indexOf('async function approve(id)');
const approve=source.slice(start,source.indexOf('async function reject(id)',start));
function setup(changed){
 const calls={sent:0,reloaded:0,compared:false};
 const query={eq(key){if(key==='status')calls.compared=true;return this;},is(){return this;},select:async()=>({data:changed,error:null})};
 const context={allBookings:[{id:'test',name:'Test',status:'pending'}],checkOverlap:()=>null,confirm:()=>true,alert:()=>{},uploadInvoiceFile:async()=>null,supabaseClient:{from:()=>({update:()=>query})},fetch:async()=>{calls.sent++;},supabaseUrl:'https://example.test',window:{adminHeaders:async()=>({})},location:{origin:'https://example.test'},loadData:async()=>{calls.reloaded++;},console};
 vm.createContext(context);vm.runInContext(approve,context);return {context,calls};
}
test('stale approval does not send another approval email',async()=>{
 const {context,calls}=setup([]);await context.approve('test');assert.equal(calls.sent,0);assert.equal(calls.reloaded,1);assert.equal(calls.compared,true);
});
test('successful status transition sends one approval email',async()=>{
 const {context,calls}=setup([{id:'test'}]);await context.approve('test');assert.equal(calls.sent,1);assert.equal(calls.compared,true);
});
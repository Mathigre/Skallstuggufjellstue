import test from 'node:test';
import assert from 'node:assert/strict';
import {extraRentalReply} from '../functions/api/chat.js';
test('extra area and bedroom rental explicitly costs extra',async()=>{
 const reply=await extraRentalReply('Kan vi leie ekstra areal og soverom?');
 assert.match(reply,/koster ekstra/);assert.match(reply,/bookingskjemaet/);
});
test('room prices come from current admin settings, not hardcoded defaults',async()=>{
 const fetchBefore=globalThis.fetch;
 try{globalThis.fetch=async()=>Response.json([{settings:{extraRooms:{basement:450000,garage:320000}}}]);
 const reply=await extraRentalReply('Hva koster kjellerrom og garasjerom?');
 assert.match(reply.replace(/\s/g,''),/4500/);assert.match(reply.replace(/\s/g,''),/3200/);assert.match(reply,/per opphold/);
 }finally{globalThis.fetch=fetchBefore;}
});
test('bedroom price is not passed off as price for cellar lounge',async()=>{
 const fetchBefore=globalThis.fetch;let requests=0;
 try{globalThis.fetch=async()=>{requests++;throw Error('Unexpected request');};
 const reply=await extraRentalReply('Hva koster kjellerstua?');assert.match(reply,/avklares særskilt/);assert.equal(requests,0);
 }finally{globalThis.fetch=fetchBefore;}
});
test('non-rental questions about cellar art are left to normal answers',async()=>{
 assert.equal(await extraRentalReply('Hvor er kunsten i kjelleren?'),null);
});
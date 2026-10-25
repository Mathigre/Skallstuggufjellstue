import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote,validateSettings} from '../pricing.mjs';
import {calculateQuote as invoiceQuote,netUnitPriceFromGross} from '../supabase/functions/fiken-booking/pricing.mjs';
const settings={weekday:900000,weekend:1400000,seasons:[],extraRooms:{basement:400000,garage:300000}};
const stay={start:'2027-01-11',end:'2027-01-14',settings};
test('room additions are charged once per stay, not once per night',()=>{
 const base=calculateQuote(stay);
 assert.equal(calculateQuote({...stay,basementRooms:true}).total-base.total,400000);
 assert.equal(calculateQuote({...stay,garageRooms:true}).total-base.total,300000);
 const both=calculateQuote({...stay,basementRooms:true,garageRooms:true});
 assert.equal(both.total-base.total,700000);
 assert.equal(both.lines.filter(l=>['basement','garage'].includes(l.key)).every(l=>l.quantity===1),true);
});
test('admin prices affect new quotes without mutating a saved price snapshot',()=>{
 const saved=structuredClone(settings);
 const next=validateSettings({...settings,extraRooms:{basement:510000,garage:280000}});
 assert.equal(calculateQuote({...stay,settings:next,basementRooms:true,garageRooms:true}).total,3490000);
 assert.equal(calculateQuote({...stay,settings:saved,basementRooms:true,garageRooms:true}).total,3400000);
});
test('older bookings without selected rooms keep their totals',()=>{
 const old={weekday:900000,weekend:1400000,seasons:[]};
 assert.equal(calculateQuote({...stay,settings:old}).total,2700000);
 assert.equal(calculateQuote({start:stay.start,end:stay.end}).total,4200000);
});
test('invalid room selections and fractional or negative admin prices are rejected',()=>{
 assert.throws(()=>calculateQuote({...stay,garageRooms:'yes'}));
 assert.throws(()=>validateSettings({...settings,extraRooms:{basement:-100,garage:300000}}));
 assert.throws(()=>validateSettings({...settings,extraRooms:{basement:400001,garage:300000}}));
});
test('invoice calculation matches booking gross including both accommodation extras',()=>{
 const args={...stay,linen:2,towels:1,cleaning:true,basementRooms:true,garageRooms:true};
 assert.equal(invoiceQuote(args).total,calculateQuote(args).total);
 assert.equal(netUnitPriceFromGross(400000,'basement'),Math.round(400000/1.12));
 assert.equal(netUnitPriceFromGross(300000,'garage'),Math.round(300000/1.12));
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from '../pricing.mjs';
const stay = { start:'2026-10-01', end:'2026-10-03' };
test('two nights plus all extras total 31900 NOK', () => {
  const q = calculateQuote({ ...stay, linen:2, towels:2, cleaning:true });
  assert.equal(q.total,3190000);
  assert.equal(q.lines.find(line=>line.key==='cleaning').quantity,1);
});
test('zero extras charge nights only',()=>assert.equal(calculateQuote(stay).total,2800000));
test('DST and leap days count calendar nights',()=>{
  assert.equal(calculateQuote({start:'2026-10-24',end:'2026-10-26'}).nights,2);
  assert.equal(calculateQuote({start:'2028-02-28',end:'2028-03-01'}).nights,2);
});
test('invalid dates, negative/fractional quantities and date order rejected',()=>{
  for(const patch of [{start:'2026-02-30'},{end:stay.start},{linen:-1},{towels:1.5},{linen:'abc'},{cleaning:'false'}])assert.throws(()=>calculateQuote({...stay,...patch}));
});

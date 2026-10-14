import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceiptText} from '../admin/receipt-ocr.mjs';
test('extract explicit amounts and date without inventing merchant or VAT split',()=>{
 const d=parseReceiptText('Fiktiv butikk\nDato: 2026-10-13\nNetto 200,00\nMVA 40,00\nTOTAL NOK 240,00');
 assert.equal(d.gross,240);assert.equal(d.net,200);assert.equal(d.vat,40);assert.equal(d.purchase_date,'2026-10-13');assert.equal(d.currency,'NOK');assert.equal(d.vendor,null);assert.deepEqual(d.vat_rates,[]);
});
test('ambiguous totals and dates remain blank',()=>{
 const d=parseReceiptText('TOTAL 100,00\nTOTAL 200,00\n01.01.2026\n02.01.2026');assert.equal(d.gross,null);assert.equal(d.purchase_date,null);
});
test('VAT percentage lines never become total VAT',()=>assert.equal(parseReceiptText('MVA 25% netto 100,00 MVA 25,00').vat,null));
test('thousands separators and missing data',()=>{assert.equal(parseReceiptText('TOTAL NOK 1 240,50').gross,1240.5);assert.equal(parseReceiptText('uklar tekst').gross,null);});
test('notes are bounded and unusable dates ignored',()=>{assert.ok(parseReceiptText('a'.repeat(10000)).notes.length<2000);assert.equal(parseReceiptText('31.02.2026').purchase_date,null);});

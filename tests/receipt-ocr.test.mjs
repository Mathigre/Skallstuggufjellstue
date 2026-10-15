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
test('receipt summary columns are separate amounts, never concatenated',()=>{
 const d=parseReceiptText('21.07.25 13:37\nSUM 845,53 194,67 1040,20\nTotalbeløp: NOK 1040,20');
 assert.equal(d.purchase_date,'2025-07-21');assert.equal(d.net,845.53);assert.equal(d.vat,194.67);assert.equal(d.gross,1040.2);
});
test('OCR spaces in decimals and repeated same totals are accepted',()=>{
 const d=parseReceiptText('TOTAL 1 040, 20\nTOTAL 1040.20\n21 07.25 13:37\n21°07 2025 13:37');assert.equal(d.gross,1040.2);assert.equal(d.purchase_date,'2025-07-21');
});
test('incorrect summary arithmetic never populates net and VAT',()=>{
 const d=parseReceiptText('SUM 846,53 194,67 1040,20\nTotalbelep: NOK 1040.20');assert.equal(d.net,null);assert.equal(d.vat,null);assert.equal(d.gross,1040.2);
});
test('mixed VAT table must reconcile rates, rows and receipt total',()=>{
 const d=parseReceiptText('Mva% Grunnlag Mva Totalt\n0,00 28,00 0,00 28,00\n15,00 97,13 14,57 111,70\n25,00 720,40 180,10 900,50\nSUM 845,53 194,67 1040,20');
 assert.equal(d.vat_rates.length,3);assert.equal(d.gross,1040.2);
 const bad=parseReceiptText('Mva% Grunnlag Mva Totalt\n25,00 720,40 180,10 300,50\nTOTAL 1040,20');assert.deepEqual(bad.vat_rates,[]);
});
test('header supplier and checksum, invalid phone dates ignored',()=>{
 const d=parseReceiptText('NG Butikk AS\nDRG.NR. 879 447 232 MVA\nTLF: 35 02 90 70\n21 07.25 13:37\nBANK 1040,20');assert.equal(d.vendor,'NG Butikk AS');assert.equal(d.organization_number,'879447232');assert.equal(d.purchase_date,'2025-07-21');
 assert.equal(parseReceiptText('ORG.NR 879 447 233').organization_number,null);
});
test('summary does not override conflicting explicit totals',()=>{
 assert.equal(parseReceiptText('TOTAL 100,00\nTOTAL 200,00\nSUM 80,00 20,00 100,00').gross,null);
});
test('terminal receipt has day-first hyphen date and VAT before net',()=>{
 const d=parseReceiptText('Tiger AS Raglamyr Veiservice\nDato 11-06-2017 18:25\nTOTAL NOK 424,47\nMVA% MVA + Netto = Totalt\nMVA 2 25,0% 84,89 339,58 424,47\nORG:916759541');
 assert.equal(d.purchase_date,'2017-06-11');assert.equal(d.vendor,'Tiger AS Raglamyr Veiservice');assert.equal(d.net,339.58);assert.equal(d.vat,84.89);assert.deepEqual(d.vat_rates,[{rate:25,net:339.58,vat:84.89,gross:424.47}]);
});
test('included VAT is verified, clipped decimals are never completed by guessing',()=>{
 const d=parseReceiptText('Dato: 07.07.2013\nTotal 524,00\nHerav 25% (524,00) 104,80\nMidlertidig kvittering');assert.equal(d.net,419.2);assert.equal(d.vat,104.8);assert.equal(d.vat_rates.length,1);assert.ok(d.uncertainties.some(s=>s.includes('midlertidig')));
 assert.equal(parseReceiptText('Total 524,00\nHerav 25% (524,00) 104,8').vat,null);
 assert.equal(parseReceiptText('Total 524,00\nHerav 25% (524,00) 114,80').vat,null);
});
test('sparse total label can precede amount, but incomplete amounts stay blank',()=>{
 assert.equal(parseReceiptText('Total\nNOK 524,00').gross,524);assert.equal(parseReceiptText('Total\n524,0').gross,null);assert.equal(parseReceiptText('Contactless\nPIN OK').payment_method,'Kort');
});


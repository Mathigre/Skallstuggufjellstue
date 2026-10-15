import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptLines} from '../admin/receipt-layout.mjs';
test('sparse words are ordered in rows without merging adjacent rows',()=>{
 const word=(text,x,y)=>({text,bbox:{x0:x,x1:x+30,y0:y,y1:y+12}});
 const blocks=[{paragraphs:[{lines:[{words:[word('25%',100,20),word('MVA',100,0),word('100,00',0,20),word('Netto',0,0),word('Total',0,45)]}]}]}];
 assert.equal(receiptLines(blocks),'Netto MVA\n100,00 25%\nTotal');
 assert.equal(receiptLines(null),'');
});

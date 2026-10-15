import {emptyData} from './receipt-data.mjs';
export function parseReceiptText(text){
 const d=emptyData(),lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);let conflictingTotals=false;
 const numbers=s=>[...s.replace(/([,.])\s+(?=\d{2}\b)/g,'$1').matchAll(/-?(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2}(?!\d)/g)].map(m=>Number(m[0].slice(0,-3).replace(/[ .]/g,'')+'.'+m[0].slice(-2)));
 const amount=s=>{const values=numbers(s);return values.length===1?values[0]:null;};
 for(const [key,re] of [['gross',/^(?:total(?:t|beløp|belep)?(?:\s+nok)?|sum|å betale|a betale)\s*[: ]/i],['net',/^(?:netto|sum eks(?:kl)?\.?\s*mva)\s*[: ]/i],['vat',/^(?:mva|mva-beløp|sum mva)\s*[: ]/i]]){
 const values=lines.filter(l=>re.test(l)&&!/%/.test(l)).map(amount).filter(v=>v!==null);
 const unique=[...new Set(values)];if(unique.length===1)d[key]=unique[0];if(key==='gross'&&unique.length>1)conflictingTotals=true;
 }
 const agrees=(a,b)=>Math.abs(Math.round(a*100)-Math.round(b*100))<=2;
 const sums=lines.filter(l=>/^sum\s/i.test(l)).map(numbers).filter(v=>v.length===3&&agrees(v[0]+v[1],v[2]));
 if(sums.length===1&&!conflictingTotals){const [net,vat,gross]=sums[0];if(d.gross===null||agrees(d.gross,gross)){d.net=net;d.vat=vat;d.gross=gross;}}
 // Only parse rate rows beneath an explicit VAT table heading.
 const header=lines.findIndex(l=>/mva/i.test(l)&&/grunnlag/i.test(l)&&/totalt?/i.test(l));
 if(header>=0){
 const rows=[];
 for(const line of lines.slice(header+1,header+9)){
 if(/^sum\b/i.test(line))break;
 const v=numbers(line);if(v.length!==4||![0,10,12,15,25].includes(v[0]))continue;
 const [rate,net,vat,gross]=v;if(agrees(net+vat,gross)&&agrees(net*rate/100,vat))rows.push({rate,net,vat,gross});
 }
 if(rows.length&&d.gross!==null&&agrees(rows.reduce((s,r)=>s+r.gross,0),d.gross)){
 d.vat_rates=rows;d.net=Math.round(rows.reduce((s,r)=>s+r.net,0)*100)/100;d.vat=Math.round(rows.reduce((s,r)=>s+r.vat,0)*100)/100;
 }
 }
 const dates=[...text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b|\b(\d{2})[./ °](\d{2})[./ °](20\d{2}|\d{2})\b/g)].map(m=>m[1]?m[1]+'-'+m[2]+'-'+m[3]:(m[6].length===2?'20'+m[6]:m[6])+'-'+m[5]+'-'+m[4]);
 const unique=[...new Set(dates.filter(date=>!isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date))];if(unique.length===1)d.purchase_date=unique[0];
 const org=text.match(/[od]rg(?:anisasjons)?\.?\s*(?:nr|nummer)\.?\s*:?\s*(\d{3})\s?(\d{3})\s?(\d{3})\b/i);if(org){
 const value=org.slice(1).join(''),weights=[3,2,7,6,5,4,3,2],remainder=value.slice(0,8).split('').reduce((s,n,i)=>s+Number(n)*weights[i],0)%11,control=remainder===0?0:11-remainder;
 if(control===Number(value[8]))d.organization_number=value;
 }
 const companies=lines.slice(0,10).filter(l=>/\b(?:AS|ASA|ENK)\s*$/.test(l)&&!/[\d%]/.test(l));if(companies.length===1)d.vendor=companies[0];
 if(/\bNOK\b/.test(text))d.currency='NOK';
 if(/\b(?:BANK|bankkort|Visa|Mastercard)\b/i.test(text))d.payment_method='Kort';
 d.notes='Tesseract OCR – ukontrollert tekst:\n'+text.slice(0,1750)+(text.length>1750?'\n[Avkortet; se originalfil]':'');
 d.uncertainties=['Tekstlest lokalt. Kontroller alle foreslåtte verdier mot originalen.',d.vendor?'Kontroller leverandørnavnet. Varelinjer og regnskapskonto må fylles ut manuelt.':'Leverandør, varelinjer og regnskapskonto må fylles ut manuelt.'];
 if(!d.vat_rates.length)d.uncertainties.push('MVA-fordeling må fylles ut manuelt.');
 if([d.net,d.vat,d.gross].every(v=>v!==null)&&!agrees(d.net+d.vat,d.gross))d.uncertainties.push('Beløpene stemmer ikke: kontroller total og MVA mot originalen.');
 return d;
}


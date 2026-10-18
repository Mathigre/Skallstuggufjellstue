import {emptyData} from './receipt-data.mjs';
export function parseReceiptText(text){
 const d=emptyData(),lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);let conflictingTotals=false;let totalCandidates=[];let derivedVat=false;
 // Sparse OCR sometimes puts a label and its value on separate lines.
 for(let i=0;i<lines.length-1;i++)if(/^(?:total(?:t|beløp)?|netto|mva)\s*:?$/i.test(lines[i])&&/^(?:NOK\s*)?-?\d[\d .]*[,.]\s*\d{2}\s*(?:NOK|kr)?$/i.test(lines[i+1]))lines[i]+=' '+lines[i+1];
 const numbers=s=>[...s.replace(/([,.])\s+(?=\d{2}\b)/g,'$1').matchAll(/-?(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2}(?!\d)/g)].map(m=>Number(m[0].slice(0,-3).replace(/[ .]/g,'')+'.'+m[0].slice(-2)));
 const amount=s=>{const values=[...new Set(numbers(s))];return values.length===1?values[0]:null;};
 for(const [key,re] of [['gross',/^(?:total(?:t|beløp|belep)?(?:\s+ink(?:l(?:usiv(?:e)?)?)?\.?\s*(?:moms|mva))?(?:\s+nok)?|sum|å betale|a betale)\s*[: ]/i],['net',/^(?:netto|sum eks(?:kl)?\.?\s*mva)\s*[: ]/i],['vat',/^(?:mva|mva-beløp|sum mva)\s*[: ]/i]]){
 const values=lines.filter(l=>re.test(l)&&!/%/.test(l)).map(amount).filter(v=>v!==null);
 const unique=[...new Set(values)];if(unique.length===1)d[key]=unique[0];if(key==='gross'){totalCandidates=unique;if(unique.length>1)conflictingTotals=true;}
 }
 const agrees=(a,b)=>Math.abs(Math.round(a*100)-Math.round(b*100))<=2;
 const taxRates=[0,10,12,15,25];
 const parseVatRow=line=>{
  const match=line.match(/(?:^|\s)(\d{1,2})(?:[,.]0{1,2})?\s*%/);if(!match)return null;
  const explicitRate=Number(match[1]),tail=line.slice(match.index+match[0].length);
  let values=numbers(tail),corrected=false;
  if(values.length!==3){
   const tokens=[...tail.matchAll(/\b[\dOQIl|Bb]{5,7}\b/g)].map(m=>Number(m[0].replace(/[OQ]/g,'0').replace(/[Il|]/g,'1').replace(/[Bb]/g,'8'))/100);
   if(tokens.length!==3)return null;values=tokens;corrected=true;
  }
  const [net,vat,gross]=values;if(!agrees(net+vat,gross))return null;
  const matching=taxRates.filter(rate=>agrees(net*rate/100,vat));
  if(matching.length!==1)return null;
  const rate=matching[0];
  return {row:{rate,net,vat,gross},rateCorrected:corrected||explicitRate!==rate};
 };
 // A validated purchase VAT table can corroborate one of conflicting OCR totals.
 // Stop at savings/loyalty sections: those contain a separate, unrelated VAT table.
 const purchaseTables=[];
 for(let h=0;h<lines.length;h++){
 if(/spart|medlemsfordel|utbytte|andre rabatter/i.test(lines[h]))break;
 if(!/(?:mva|moms|muin[gs])/i.test(lines[h])||!/grunnlag/i.test(lines[h])||!/(?:sum|total|lotal|jotul)/i.test(lines[h]))continue;
 const rows=[];
 for(const line of lines.slice(h+1,h+7)){
 if(/spart|medlems|utbytte|rabatt|^sum\b/i.test(line))break;
 const parsed=parseVatRow(line);if(parsed&&!rows.some(r=>r.rate===parsed.row.rate&&agrees(r.gross,parsed.row.gross)))rows.push(parsed.row);if(parsed?.rateCorrected)derivedVat=true;
 }
 const gross=Math.round(rows.reduce((s,r)=>s+r.gross,0)*100)/100;
 if(rows.length&&totalCandidates.some(v=>agrees(v,gross)))purchaseTables.push({rows,gross});
 }
 if(purchaseTables.length===1){
 const {rows,gross}=purchaseTables[0];d.gross=gross;d.vat_rates=rows;
 d.net=Math.round(rows.reduce((s,r)=>s+r.net,0)*100)/100;d.vat=Math.round(rows.reduce((s,r)=>s+r.vat,0)*100)/100;
 }
 const sums=lines.filter(l=>/^sum\s/i.test(l)).map(numbers).filter(v=>v.length===3&&agrees(v[0]+v[1],v[2]));
 if(sums.length===1&&!conflictingTotals){const [net,vat,gross]=sums[0];if(d.gross===null||agrees(d.gross,gross)){d.net=net;d.vat=vat;d.gross=gross;}}
 // Only parse rate rows beneath an explicit VAT table heading.
 const header=lines.findIndex(l=>/(?:mva|moms|muin[gs])/i.test(l)&&/grunnlag/i.test(l)&&/(?:total|lotal|jotul)/i.test(l));
 if(header>=0){
 const rows=[];
 for(const line of lines.slice(header+1,header+9)){
 if(/^sum\b/i.test(line))break;
 const parsed=parseVatRow(line);if(parsed&&!rows.some(r=>r.rate===parsed.row.rate&&agrees(r.gross,parsed.row.gross)))rows.push(parsed.row);if(parsed?.rateCorrected)derivedVat=true;
 }
 if(rows.length&&d.gross!==null&&agrees(rows.reduce((s,r)=>s+r.gross,0),d.gross)){
 d.vat_rates=rows;d.net=Math.round(rows.reduce((s,r)=>s+r.net,0)*100)/100;d.vat=Math.round(rows.reduce((s,r)=>s+r.vat,0)*100)/100;
 }
 }
 // Derive tax only when the receipt clearly shows one VAT rate and OCR loses row digits.
 if(d.gross!==null&&!d.vat_rates.length){
 const h=lines.findIndex(l=>/(?:mva|moms)/i.test(l)&&/grunnlag/i.test(l)&&/(?:total|lotal)/i.test(l));
 if(h>=0){
 const section=[];
 for(const line of lines.slice(h,h+8)){if(section.length&&/^(?:sum|kortdetaljer|dato)\b/i.test(line))break;section.push(line);}
 const rates=[...section.join(' ').matchAll(/\b(0|10|12|15|25)(?:[,.]0{1,2})?\s*%/g)].map(m=>Number(m[1]));
 const uniqueRates=[...new Set(rates)];
 if(uniqueRates.length===1){const rate=uniqueRates[0];d.net=Math.round(d.gross/(1+rate/100)*100)/100;d.vat=Math.round((d.gross-d.net)*100)/100;d.vat_rates=[{rate,net:d.net,vat:d.vat,gross:d.gross}];derivedVat=true;}
 }
 }
 // Some terminals print VAT before net, with a percentage marker in the row.
 const terminalHeader=lines.findIndex(l=>/mva/i.test(l)&&/netto/i.test(l)&&/totalt?/i.test(l));
 if(terminalHeader>=0&&!d.vat_rates.length){
 const rows=[];
 for(const line of lines.slice(terminalHeader+1,terminalHeader+7)){
 const rateMatch=line.match(/(?:^|\s)(\d{1,2})(?:[,.]0{1,2})?\s*%/);if(!rateMatch)continue;
 const rate=Number(rateMatch[1]),values=numbers(line.slice(rateMatch.index+rateMatch[0].length));if(values.length!==3||![0,10,12,15,25].includes(rate))continue;
 const [vat,net,gross]=values;if(agrees(net+vat,gross)&&agrees(net*rate/100,vat))rows.push({rate,net,vat,gross});
 }
 if(rows.length&&d.gross!==null&&agrees(rows.reduce((s,r)=>s+r.gross,0),d.gross)){d.vat_rates=rows;d.net=Math.round(rows.reduce((s,r)=>s+r.net,0)*100)/100;d.vat=Math.round(rows.reduce((s,r)=>s+r.vat,0)*100)/100;}
 }
 // A single-rate "Herav" line explicitly gives gross and included VAT.
 if(!d.vat_rates.length)for(const line of lines.filter(l=>/^herav\b/i.test(l))){
 const m=line.match(/^herav\s+(\d{1,2})(?:[,.]0{1,2})?\s*%/i);if(!m)continue;
 const values=numbers(line.slice(m[0].length)),rate=Number(m[1]);if(values.length!==2||![0,10,12,15,25].includes(rate))continue;
 const [gross,vat]=values,net=Math.round((gross-vat)*100)/100;
 if(d.gross!==null&&agrees(d.gross,gross)&&agrees(net*rate/100,vat)){d.net=net;d.vat=vat;d.vat_rates=[{rate,net,vat,gross}];}
 }
 const dates=[...text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b|\b(\d{2})[./ °-](\d{2})[./ °-](20\d{2}|\d{2})\b/g)].map(m=>m[1]?m[1]+'-'+m[2]+'-'+m[3]:(m[6].length===2?'20'+m[6]:m[6])+'-'+m[5]+'-'+m[4]);
 const monthNames={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',sep:'09',sept:'09',oct:'10',nov:'11',dec:'12'};
 for(const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(20\d{2})\b/gi))dates.push(m[3]+'-'+monthNames[m[2].toLowerCase()]+'-'+m[1].padStart(2,'0'));
 const unique=[...new Set(dates.filter(date=>!isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date))];if(unique.length===1)d.purchase_date=unique[0];
 const org=text.match(/(?:org(?:anisasjons)?\.?\s*(?:nr|nummer|ni)\.?|moms\s*nr\.?)[^\d]{0,20}(?:NO)?\s*(\d{3})\s?(\d{3})\s?(\d{3})/i);if(org){
 const value=org.slice(1).join(''),weights=[3,2,7,6,5,4,3,2],remainder=value.slice(0,8).split('').reduce((s,n,i)=>s+Number(n)*weights[i],0)%11,control=remainder===0?0:11-remainder;
 if(control===Number(value[8]))d.organization_number=value;
 }
 const companies=lines.slice(0,12).filter(l=>/\b(?:AS|ASA|SA|ENK)\b/.test(l)&&!/[\d%]/.test(l));if(companies.length===1)d.vendor=companies[0].replace(/\s*[|]+\s*$/,'');else if(/\bELKJ[ØO]P\b/i.test(lines.slice(0,12).join(' ')))d.vendor='Elkjøp Norge';
 if(/\bNOK\b/.test(text))d.currency='NOK';
 if(/\b(?:BANK|bankkort|Visa|Mastercard|BankAxept|Contactless|PIN OK|Card)\b/i.test(text))d.payment_method='Kort';
 // Raw OCR is shown separately in the UI, not stored as the user's bookkeeping note.
 d.notes=null;
 d.uncertainties=['Tekstlest lokalt. Kontroller alle foreslåtte verdier mot originalen.',...(derivedVat?['MVA er utledet fra en lesbar sats eller en matematisk kontrollert MVA-rad. Kontroller mot originalen.']:[]),...(unique?.length>1?['Flere datoer ble funnet. Kjøpsdato er derfor ikke valgt automatisk.']:[]),d.vendor?'Kontroller leverandørnavnet. Varelinjer og regnskapskonto må fylles ut manuelt.':'Leverandør, varelinjer og regnskapskonto må fylles ut manuelt.'];
 if(!d.vat_rates.length)d.uncertainties.push('MVA-fordeling må fylles ut manuelt.');
 if(/midlertidig\s+kvittering/i.test(text))d.uncertainties.push('Dokumentet er merket midlertidig kvittering. Skaff og kontroller endelig kvittering før bokføring.');
 if([d.net,d.vat,d.gross].every(v=>v!==null)&&!agrees(d.net+d.vat,d.gross))d.uncertainties.push('Beløpene stemmer ikke: kontroller total og MVA mot originalen.');
 return d;
}


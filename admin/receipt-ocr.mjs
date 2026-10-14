import {emptyData} from './receipt-data.mjs';
export function parseReceiptText(text){
 const d=emptyData(),lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const amount=s=>{const m=s.match(/(-?\d[\d .]*[,.]\d{2})\s*(?:NOK|kr)?\s*$/i);return m?Number(m[1].replace(/[ .]/g,'').replace(',','.')):null;};
 for(const [key,re] of [['gross',/^(?:total(?:t)?(?:\s+nok)?|sum|å betale|a betale)\s*[: ]/i],['net',/^(?:netto|sum eks(?:kl)?\.?\s*mva)\s*[: ]/i],['vat',/^(?:mva|mva-beløp|sum mva)\s*[: ]/i]]){
 const values=lines.filter(l=>re.test(l)&&!/%/.test(l)).map(amount).filter(v=>v!==null);
 if(values.length===1)d[key]=values[0];
 }
 const dates=[...text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b|\b(\d{2})[./](\d{2})[./](20\d{2})\b/g)].map(m=>m[1]?m[1]+'-'+m[2]+'-'+m[3]:m[6]+'-'+m[5]+'-'+m[4]);
 const unique=[...new Set(dates)];if(unique.length===1&&!isNaN(Date.parse(unique[0]))&&new Date(unique[0]).toISOString().slice(0,10)===unique[0])d.purchase_date=unique[0];
 const org=text.match(/org(?:anisasjons)?\.?\s*(?:nr|nummer)\.?\s*:?\s*(\d{3})\s?(\d{3})\s?(\d{3})\b/i);if(org)d.organization_number=org.slice(1).join('');
 if(/\bNOK\b/.test(text))d.currency='NOK';
 d.notes='Tesseract OCR – ukontrollert tekst:\n'+text.slice(0,1750)+(text.length>1750?'\n[Avkortet; se originalfil]':'');
 d.uncertainties=['Tekstlest lokalt. Kontroller alle foreslåtte verdier mot originalen.','Leverandør, MVA-fordeling, varelinjer og regnskapskonto må fylles ut manuelt.'];
 return d;
}

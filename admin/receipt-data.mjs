// Shared validation: integer øre for comparisons, unknown values remain null.
export const textFields=['vendor','organization_number','purchase_date','currency','payment_method','category','account','notes'];
export const moneyFields=['net','vat','gross','rounding'];
export const emptyData=()=>Object.fromEntries([...textFields.map(k=>[k,null]),...moneyFields.map(k=>[k,null]),['vat_rates',[]],['items',[]],['uncertainties',[]]]);
const text=(v,max=2000)=>v==null||v===''?null:typeof v==='string'&&v.length<=max?v:(()=>{throw Error('Ugyldig tekstfelt.');})();
const num=v=>v==null||v===''?null:typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<100000000?v:(()=>{throw Error('Ugyldig tall.');})();
const rows=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw Error('For mange eller ugyldige linjer.');return v;};
export function normalizeData(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Ugyldige kvitteringsdata.');
 const d=emptyData();
 for(const k of textFields)d[k]=text(input[k]);
 for(const k of moneyFields)d[k]=num(input[k]);
 d.vat_rates=rows(input.vat_rates??[],20).map(r=>({rate:num(r.rate),net:num(r.net),vat:num(r.vat),gross:num(r.gross)}));
 d.items=rows(input.items??[],150).map(r=>({description:text(r.description),quantity:num(r.quantity),unit_price:num(r.unit_price),gross:num(r.gross),vat_rate:num(r.vat_rate)}));
 d.uncertainties=rows(input.uncertainties??[],50).map(v=>text(v)).filter(Boolean);
 if(d.purchase_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.purchase_date)||new Date(d.purchase_date).toISOString().slice(0,10)!==d.purchase_date))throw Error('Ugyldig kjøpsdato.');
 if(d.currency&&!/^[A-Z]{3}$/.test(d.currency))throw Error('Valuta må ha tre store bokstaver, for eksempel NOK.');
 return d;
}
export function validateData(input){
 const d=normalizeData(input),errors=[],warnings=[],ore=n=>Math.round(n*100),sum=(rows,k)=>rows.reduce((n,r)=>n+ore(r[k]),0);
 for(const [k,label] of [['vendor','leverandør'],['purchase_date','kjøpsdato'],['currency','valuta'],['gross','totalbeløp'],['net','beløp ekskl. MVA'],['vat','MVA']])if(d[k]===null)errors.push('Mangler '+label+'.');
 if([d.net,d.vat,d.gross].every(v=>v!==null)&&Math.abs(ore(d.net)+ore(d.vat)+ore(d.rounding??0)-ore(d.gross))>2)errors.push('Ekskl. MVA + MVA + avrunding stemmer ikke med totalen (toleranse 0,02).');
 if(d.vat_rates.length){
 for(const [i,r] of d.vat_rates.entries()){
 if(Object.values(r).some(v=>v===null)){errors.push('MVA-linje '+(i+1)+' er ufullstendig.');continue;}
 if(r.rate<0||r.rate>100)errors.push('Ugyldig MVA-sats.');
 if(Math.abs(ore(r.net)+ore(r.vat)-ore(r.gross))>2)errors.push('MVA-linje '+(i+1)+' summerer ikke.');
 if(Math.abs(ore(r.net*r.rate/100)-ore(r.vat))>2)warnings.push('Kontroller sats/beløp på MVA-linje '+(i+1)+'.');
 }
 for(const k of ['net','vat','gross'])if(d[k]!==null&&d.vat_rates.every(r=>r[k]!==null)&&Math.abs(sum(d.vat_rates,k)+(k==='gross'?ore(d.rounding??0):0)-ore(d[k]))>2)errors.push('Summen av MVA-linjene stemmer ikke med '+k+'.');
 }else if(d.vat!==null&&d.vat!==0)errors.push('MVA-fordeling mangler.');
 if(!d.organization_number)warnings.push('Organisasjonsnummer mangler.');
 if(d.items.length&&d.items.every(r=>r.gross!==null)&&d.gross!==null&&Math.abs(sum(d.items,'gross')+ore(d.rounding??0)-ore(d.gross))>2)warnings.push('Varelinjene stemmer ikke med totalen. Kontroller rabatt, pant og avrunding.');
 if(d.uncertainties.length)warnings.push(...d.uncertainties);
 return {data:d,errors,warnings};
}


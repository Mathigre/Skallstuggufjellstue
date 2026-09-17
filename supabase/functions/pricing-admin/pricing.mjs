// Amounts are stored/calculated in ore to avoid floating-point currency errors.
export const PRICE_VERSION = '2026-09-17';
export const RATES = Object.freeze({ night: 1400000, linen: 30000, towel: 15000, cleaning: 300000 });

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Velg gyldige datoer.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Velg gyldige datoer.');
  return date.getTime() / 86400000;
}

function count(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000) throw new Error(`Ugyldig antall ${label}.`);
  return number;
}

export function validateSettings(settings) {
  const price = value => { if (!Number.isSafeInteger(value) || value < 100 || value > 100000000 || value % 100) throw new Error('Priser må være hele kroner mellom 1 og 1 000 000.'); return value; };
  if (!settings || !Array.isArray(settings.seasons) || settings.seasons.length > 100) throw new Error('Ugyldig sesongoppsett.');
  const result = { weekday:price(settings.weekday), weekend:price(settings.weekend), seasons:settings.seasons.map(s => {
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 || day(s.end) < day(s.start)) throw new Error('Fyll inn sesongnavn og gyldige datoer.');
    return {name:s.name.trim(), start:s.start, end:s.end, weekday:price(s.weekday), weekend:price(s.weekend)};
  }).sort((a,b)=>a.start.localeCompare(b.start)) };
  for(let i=1;i<result.seasons.length;i++) if(result.seasons[i].start<=result.seasons[i-1].end) throw new Error('Sesongene kan ikke ha overlappende datoer.');
  return result;
}

export function calculateQuote({ start, end, linen = 0, towels = 0, cleaning = false, settings = null }) {
  const nights = day(end) - day(start);
  if (nights < 1 || nights > 366) throw new Error('Velg et opphold på mellom 1 og 366 netter.');
  const linenCount = count(linen, 'sett sengeklær');
  const towelCount = count(towels, 'håndklær');
  if (typeof cleaning !== 'boolean') throw new Error('Ugyldig valg for full vask.');
  const lines = [];
  if (settings) {
    settings = validateSettings(settings);
    for(let n=day(start);n<day(end);n++) {
      const date=new Date(n*86400000), iso=date.toISOString().slice(0,10), weekend=[5,6].includes(date.getUTCDay());
      const season=settings.seasons.find(s=>iso>=s.start && iso<=s.end);
      const rate=(season||settings)[weekend?'weekend':'weekday'];
      const label=`Overnatting – ${season?.name||'Grunnpris'} (${weekend?'helg':'hverdag'})`;
      const line=lines.find(l=>l.label===label && l.unitPrice===rate);
      if(line)line.quantity++;else lines.push({key:'night',label,quantity:1,unitPrice:rate});
    }
  } else lines.push({ key: 'night', label: 'Overnatting', quantity: nights, unitPrice: RATES.night });
  if (linenCount) lines.push({ key: 'linen', label: 'Sengeklær', quantity: linenCount, unitPrice: RATES.linen });
  if (towelCount) lines.push({ key: 'towel', label: 'Håndklær', quantity: towelCount, unitPrice: RATES.towel });
  if (cleaning) lines.push({ key: 'cleaning', label: 'Full vask', quantity: 1, unitPrice: RATES.cleaning });
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { priceVersion: PRICE_VERSION, nights, linenCount, towelCount, cleaning, lines, total, net: total * 4 / 5, vat: total / 5 };
}

export function formatMoney(ore) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(ore / 100);
}

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

export function calculateQuote({ start, end, linen = 0, towels = 0, cleaning = false }) {
  const nights = day(end) - day(start);
  if (nights < 1 || nights > 366) throw new Error('Velg et opphold på mellom 1 og 366 netter.');
  const linenCount = count(linen, 'sett sengeklær');
  const towelCount = count(towels, 'håndklær');
  if (typeof cleaning !== 'boolean') throw new Error('Ugyldig valg for full vask.');
  const lines = [{ key: 'night', label: 'Overnatting', quantity: nights, unitPrice: RATES.night }];
  if (linenCount) lines.push({ key: 'linen', label: 'Sengeklær', quantity: linenCount, unitPrice: RATES.linen });
  if (towelCount) lines.push({ key: 'towel', label: 'Håndklær', quantity: towelCount, unitPrice: RATES.towel });
  if (cleaning) lines.push({ key: 'cleaning', label: 'Full vask', quantity: 1, unitPrice: RATES.cleaning });
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { priceVersion: PRICE_VERSION, nights, linenCount, towelCount, cleaning, lines, total, net: total * 4 / 5, vat: total / 5 };
}

export function formatMoney(ore) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(ore / 100);
}

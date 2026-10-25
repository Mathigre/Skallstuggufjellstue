import { calculateQuote, formatMoney, validateSettings } from './pricing.mjs?v=rooms1';

function bookingToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}
function refreshBookingDateLimits() {
  const start = document.getElementById('start');
  const end = document.getElementById('end');
  const today = bookingToday();
  start.min = today;
  const earliestStart = start.value && start.value >= today ? start.value : today;
  const nextDay = new Date(earliestStart + 'T00:00:00Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  end.min = nextDay.toISOString().slice(0, 10);
  start.setCustomValidity(start.value && start.value < today ? 'Ankomstdato kan ikke være i fortiden.' : '');
}
function validateNewBookingDate() {
  refreshBookingDateLimits();
  if (document.getElementById('start').value && document.getElementById('start').value < bookingToday()) {
    throw new Error('Ankomstdato kan ikke være i fortiden. Velg dagens dato eller en senere dato.');
  }
}
const form = document.getElementById('bookingForm');
if (form) {
  const section = document.createElement('fieldset');
  section.className = 'booking-extras';
  section.innerHTML = `<legend>Opphold og tillegg</legend>
    <p id="nightlyPriceInfo">Henter priser …</p>
    <div class="booking-extras-grid">
      <label for="linenCount">Sengeklær – 300 kr per sett<input id="linenCount" type="number" min="0" max="1000" step="1" value="0" inputmode="numeric" required></label>
      <label for="towelCount">Håndklær – 150 kr per håndkle<input id="towelCount" type="number" min="0" max="1000" step="1" value="0" inputmode="numeric" required></label>
    </div>
    <label class="booking-cleaning"><input id="fullCleaning" type="checkbox"> Full vask – 3 000 kr per opphold</label>
    <label class="booking-cleaning"><input id="basementRooms" type="checkbox" disabled> Soverom i kjelleren – <span id="basementRoomPrice">Henter pris …</span> per opphold</label>
    <label class="booking-cleaning"><input id="garageRooms" type="checkbox" disabled> Soverom i garasjebygget – <span id="garageRoomPrice">Henter pris …</span> per opphold</label>
    <p><a href="lokaler.html#soveromsoversikt" target="_blank" rel="noopener">Se romfordeling og plassering (ny fane)</a></p>
    <div id="bookingPriceSummary" class="booking-price-summary" aria-live="polite"></div>`;
  form.querySelector('button[type="submit"]').before(section);

  let published;
  window.getBookingQuote = () => {
    validateNewBookingDate();
    if(!published)throw new Error('Prisene er ikke lastet. Vent litt eller last siden på nytt.');
    return {...calculateQuote({
    start: document.getElementById('start').value,
    end: document.getElementById('end').value,
    linen: document.getElementById('linenCount').value,
    towels: document.getElementById('towelCount').value,
    cleaning: document.getElementById('fullCleaning').checked,
    basementRooms:document.getElementById('basementRooms').checked,
    garageRooms:document.getElementById('garageRooms').checked,
    settings: published.settings,
  }),pricingRevision:published.revision}; };
  const render = () => {
    const summary = document.getElementById('bookingPriceSummary');
    summary.replaceChildren();
    try {
      const quote = window.getBookingQuote();
      for (const line of quote.lines) {
        const row = document.createElement('p');
        row.textContent = `${line.label}: ${line.quantity} × ${formatMoney(line.unitPrice)} = ${formatMoney(line.quantity * line.unitPrice)}`;
        summary.appendChild(row);
      }
      const total = document.createElement('strong');
      total.textContent = `Totalpris: ${formatMoney(quote.total)}`;
      summary.appendChild(total);
      const vat = document.createElement('p');
      vat.textContent = `Herav mva (25 %): ${formatMoney(quote.vat)}`;
      summary.appendChild(vat);
    } catch (error) { summary.textContent = error.message; }
  };
  for (const id of ['start', 'end', 'linenCount', 'towelCount', 'fullCleaning', 'basementRooms', 'garageRooms']) document.getElementById(id).addEventListener('input', render);
  window.addEventListener('pageshow', render);
  window.addEventListener('focus', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  form.addEventListener('reset', () => setTimeout(render, 0));
  render();
  try {
    const {data,error}=await supabaseClient.from('booking_price_settings').select('revision,settings').eq('id',1).single();
    if(error||!data)throw new Error('Kunne ikke hente priser. Last siden på nytt.');
    data.settings=validateSettings(data.settings);published=data;
    document.getElementById('basementRoomPrice').textContent=formatMoney(data.settings.extraRooms.basement);
    document.getElementById('garageRoomPrice').textContent=formatMoney(data.settings.extraRooms.garage);
    document.getElementById('basementRooms').disabled=false;document.getElementById('garageRooms').disabled=false;
    document.getElementById('nightlyPriceInfo').textContent=`Grunnpris: ${formatMoney(data.settings.weekday)} søndag–torsdag og ${formatMoney(data.settings.weekend)} fredag–lørdag per natt. Sesongpriser kan gjelde. Alle priser inkluderer 25 % mva. Totalen under gjelder dine datoer.`;
    render();
  } catch(error){document.getElementById('nightlyPriceInfo').textContent=error.message;}
}

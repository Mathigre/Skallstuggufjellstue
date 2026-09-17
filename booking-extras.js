import { calculateQuote, formatMoney, validateSettings } from './pricing.mjs?v=season1';

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
    <div id="bookingPriceSummary" class="booking-price-summary" aria-live="polite"></div>`;
  form.querySelector('button[type="submit"]').before(section);

  let published;
  window.getBookingQuote = () => {
    if(!published)throw new Error('Prisene er ikke lastet. Vent litt eller last siden på nytt.');
    return {...calculateQuote({
    start: document.getElementById('start').value,
    end: document.getElementById('end').value,
    linen: document.getElementById('linenCount').value,
    towels: document.getElementById('towelCount').value,
    cleaning: document.getElementById('fullCleaning').checked,
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
  for (const id of ['start', 'end', 'linenCount', 'towelCount', 'fullCleaning']) document.getElementById(id).addEventListener('input', render);
  form.addEventListener('reset', () => setTimeout(render, 0));
  render();
  try {
    const {data,error}=await supabaseClient.from('booking_price_settings').select('revision,settings').eq('id',1).single();
    if(error||!data)throw new Error('Kunne ikke hente priser. Last siden på nytt.');
    validateSettings(data.settings);published=data;
    document.getElementById('nightlyPriceInfo').textContent=`Grunnpris: ${formatMoney(data.settings.weekday)} søndag–torsdag og ${formatMoney(data.settings.weekend)} fredag–lørdag per natt. Sesongpriser kan gjelde. Alle priser inkluderer 25 % mva. Totalen under gjelder dine datoer.`;
    render();
  } catch(error){document.getElementById('nightlyPriceInfo').textContent=error.message;}
}

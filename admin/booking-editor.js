// Booking management uses the existing Supabase client and dashboard layout.
const bookingOperations = new Set();

function isCalendarImport(booking) {
  return !booking.price_version && (booking.message || '').startsWith('Importert fra Booking Skallstuggu (Google Kalender).');
}
function validBookingDates(booking, values) {
  return /^\d{4}-\d{2}-\d{2}$/.test(values.start_date) && /^\d{4}-\d{2}-\d{2}$/.test(values.end_date) &&
    (values.end_date > values.start_date || (isCalendarImport(booking) && values.end_date === values.start_date));
}

function bookingEditorButton(label, action, className = "btn-neutral") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function addBookingManagement(card, booking) {
  const details = card.querySelector(".booking-details");
  const actions = document.createElement("div");
  actions.className = "booking-actions";
  if (!booking.cancelled_at) {
    actions.appendChild(bookingEditorButton("Rediger booking", () => openBookingEditor(booking)));
    if (booking.status !== "rejected") {
      actions.appendChild(bookingEditorButton("Avbestill booking", () => cancelBooking(booking), "btn-danger"));
    }
  } else {
    const note = document.createElement("p");
    note.className = booking.cancellation_email_sent_at ? "archive-note" : "warning";
    note.textContent = booking.cancellation_email_sent_at
      ? "Avbestilt. Avbestillingsmail er sendt til e-posttjenesten."
      : "Avbestilt og fjernet fra kalenderen. Avbestillingsmail er ikke bekreftet sendt.";
    details.prepend(note);
    if (!booking.cancellation_email_sent_at) {
      actions.appendChild(bookingEditorButton("Prøv avbestillingsmail igjen", () => retryCancellationEmail(booking)));
    }
  }
  details.prepend(actions);
  if (typeof window.appendBookingPricing === "function") window.appendBookingPricing(card, booking);
}

function openBookingEditor(booking) {
  if (booking.cancelled_at || document.getElementById("bookingEditor")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "bookingEditor";
  dialog.className = "booking-editor";
  dialog.setAttribute("aria-labelledby", "bookingEditorTitle");
  dialog.innerHTML = `<form><h2 id="bookingEditorTitle">Rediger booking</h2>
    <div class="booking-editor-grid">
      <label>Navn<input name="name" required maxlength="200" autocomplete="name"></label>
      <label>E-post<input name="email" type="email" ${isCalendarImport(booking) ? "" : "required"} maxlength="254" autocomplete="email"></label>
      <label>Telefon<input name="phone" type="tel" maxlength="50" autocomplete="tel"></label>
      <label>Fra dato<input name="start_date" type="date" required></label>
      <label>Til dato<input name="end_date" type="date" required></label>
    </div>
    <fieldset ${booking.price_version ? "" : "hidden"}><legend>Tillegg (inkl. 25 % mva)</legend><label>Sengeklær – 300 kr/sett<input name="linen_count" type="number" min="0" max="1000" step="1"></label><label>Håndklær – 150 kr/stk<input name="towel_count" type="number" min="0" max="1000" step="1"></label><label><input name="full_cleaning" type="checkbox"> Full vask – 3 000 kr/opphold</label></fieldset>
    <p>Endringene oppdaterer bookingen og kalenderen. Bruk «Send svar til kunde» hvis du også vil varsle kunden om endringen.</p>
    <p class="booking-editor-error" role="alert"></p>
    <div class="booking-actions"><button type="submit" class="btn-success">Lagre endringer</button><button type="button" class="btn-neutral" data-close>Lukk</button></div>
  </form>`;
  const form = dialog.querySelector("form");
  for (const key of ["name", "email", "phone", "start_date", "end_date"]) form.elements.namedItem(key).value = booking[key] || "";
  form.elements.namedItem("linen_count").value = booking.linen_count || 0;
  form.elements.namedItem("towel_count").value = booking.towel_count || 0;
  form.elements.namedItem("full_cleaning").checked = Boolean(booking.full_cleaning);
  let saving = false;
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove());
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(values)) values[key] = values[key].trim();
    if (booking.price_version) { values.linen_count = Number(values.linen_count); values.towel_count = Number(values.towel_count); values.full_cleaning = form.elements.namedItem("full_cleaning").checked; }
    else { delete values.linen_count; delete values.towel_count; delete values.full_cleaning; }
    const errorBox = dialog.querySelector(".booking-editor-error");
    if (!values.name || (!isCalendarImport(booking) && !values.email)) { errorBox.textContent = "Fyll inn navn og e-post."; return; }
    if (!validBookingDates(booking, values)) { errorBox.textContent = isCalendarImport(booking) ? "Til-dato kan ikke være før fra-dato." : "Til-dato må være etter fra-dato."; return; }
    saving = true;
    form.querySelectorAll("button").forEach(button => { button.disabled = true; });
    errorBox.textContent = "";
    try {
      await saveBookingChanges(booking, values);
      dialog.close();
      alert("Booking oppdatert.");
    } catch (error) {
      errorBox.textContent = error.message || "Kunne ikke lagre endringene.";
    } finally {
      saving = false;
      form.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}

function matchBookingSnapshot(query, booking) {
  // Do not overwrite a booking changed in another admin tab since it was opened.
  for (const key of ["status", "name", "email", "phone", "start_date", "end_date", "cancelled_at", "linen_count", "towel_count", "full_cleaning"]) {
    query = booking[key] == null ? query.is(key, null) : query.eq(key, booking[key]);
  }
  return query;
}

async function saveBookingChanges(booking, values) {
  const id = String(booking.id);
  if (bookingOperations.has(id)) throw new Error("Denne bookingen blir allerede oppdatert.");
  if (booking.cancelled_at) throw new Error("Avbestilte bookinger kan ikke redigeres.");
  if (!values.name?.trim() || (!isCalendarImport(booking) && !values.email?.trim()) || (values.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) || !validBookingDates(booking, values)) throw new Error("Kontroller navn, e-post og datoer.");
  bookingOperations.add(id);
  try {
    if (booking.status === "approved") {
      const { data, error } = await supabaseClient.from("bookings").select("id,start_date,end_date").eq("status", "approved");
      if (error) throw new Error("Kunne ikke kontrollere ledige datoer. Prøv igjen.");
      const overlap = (data || []).some(other => String(other.id) !== id && values.start_date < other.end_date && values.end_date > other.start_date);
      if (overlap) throw new Error("Perioden overlapper med en annen godkjent booking. Velg andre datoer.");
    }
    const update = {};
    for (const key of ["name", "email", "phone", "start_date", "end_date"]) update[key] = values[key] || null;
    for (const key of ["linen_count", "towel_count", "full_cleaning"]) if (key in values) update[key] = values[key];
    const { data, error } = await matchBookingSnapshot(supabaseClient.from("bookings").update(update).eq("id", booking.id), booking).select("*").maybeSingle();
    if (error) throw new Error("Kunne ikke lagre: " + error.message);
    if (!data) throw new Error("Bookingen er endret eller du mangler tilgang. Last siden på nytt før du prøver igjen.");
    selectedBooking = null;
    await loadData();
    return data;
  } finally { bookingOperations.delete(id); }
}

async function sendCancellationEmail(bookingId) {
  const response = await fetch(`${supabaseUrl}/functions/v1/booking-cancellation-email`, {
    method: "POST",
    headers:await window.adminHeaders(),
    body: JSON.stringify({ bookingId: String(bookingId) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) throw new Error(result.error || "E-posten kunne ikke sendes.");
  return result;
}

async function cancelBooking(booking) {
  const id = String(booking.id);
  if (bookingOperations.has(id) || booking.cancelled_at || booking.status === "rejected") return;
  if (!booking.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) return alert("Bookingen mangler gyldig e-post. Legg inn kundens e-post via «Rediger booking» først.");
  if (!confirm(`Avbestille bookingen til ${booking.name}, ${formatDate(booking.start_date)} → ${formatDate(booking.end_date)}?\n\nBookingen fjernes fra kalenderen, og kunden varsles på ${booking.email}. Historikken beholdes. Eventuell refusjon må håndteres separat.`)) return;
  bookingOperations.add(id);
  try {
    const { data, error } = await matchBookingSnapshot(supabaseClient.from("bookings").update({ status: "rejected", cancelled_at: new Date().toISOString(), cancellation_email_sent_at: null }).eq("id", booking.id), booking).select("*").maybeSingle();
    if (error) throw new Error("Kunne ikke avbestille: " + error.message);
    if (!data) throw new Error("Bookingen er endret eller du mangler tilgang. Last siden på nytt før du prøver igjen.");
    // Release the calendar immediately, even when the email service is unavailable.
    allBookings = allBookings.map(item => String(item.id) === id ? data : item);
    approvedBookings = allBookings.filter(item => item.status === "approved");
    selectedBooking = null;
    loadCalendar();
    try {
      await sendCancellationEmail(id);
      alert("Bookingen er avbestilt, datoene er frigjort og avbestillingsmail er sendt til e-posttjenesten.");
    } catch (error) {
      alert("Bookingen er avbestilt og datoene er frigjort, men e-posten er ikke bekreftet sendt. Bruk «Prøv avbestillingsmail igjen» under «Avslåtte / avbestilte».\n\n" + error.message);
    }
    await loadData();
  } catch (error) { alert(error.message || "Kunne ikke avbestille bookingen."); }
  finally { bookingOperations.delete(id); }
}

async function retryCancellationEmail(booking) {
  const id = String(booking.id);
  if (bookingOperations.has(id) || !booking.cancelled_at || booking.cancellation_email_sent_at) return;
  if (!confirm(`Sende avbestillingsmail til ${booking.email}?`)) return;
  bookingOperations.add(id);
  try {
    await sendCancellationEmail(id);
    alert("Avbestillingsmail er sendt til e-posttjenesten.");
    await loadData();
  } catch (error) { alert("Avbestillingsmail er ikke bekreftet sendt: " + error.message); }
  finally { bookingOperations.delete(id); }
}


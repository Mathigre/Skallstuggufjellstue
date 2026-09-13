// Manuell booking i admin
(function () {
  function addStyles() {
    if (document.getElementById("manualBookingStyles")) return;
    const s = document.createElement("style");
    s.id = "manualBookingStyles";
    s.textContent = `
      .manual-booking-btn{width:100%;border:0;border-radius:12px;padding:13px 16px;background:#8B4A2B;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;margin-top:12px}
      .manual-booking-form{display:none;margin-top:14px;padding-top:14px;border-top:1px solid #e5ddd4}
      .manual-booking-form.open{display:block}
      .manual-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .manual-field{display:flex;flex-direction:column;gap:5px}.manual-field.full{grid-column:1/-1}
      .manual-field label{font-size:.86rem;font-weight:700;color:#514942}
      .manual-field input,.manual-field select,.manual-field textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid #d6cfc6;border-radius:9px;background:#fff;font:inherit}
      .manual-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.manual-actions button{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}
      .manual-save{background:#2e7d32;color:#fff}.manual-cancel{background:#eee8e1;color:#443c35}
      @media(max-width:600px){.manual-grid{grid-template-columns:1fr}.manual-field.full{grid-column:auto}}
    `;
    document.head.appendChild(s);
  }

  function insertForm() {
    addStyles();
    const searchPanel = document.querySelector(".search-panel");
    if (!searchPanel || document.getElementById("manualBookingBox")) return;
    const box = document.createElement("div");
    box.id = "manualBookingBox";
    box.innerHTML = `
      <button type="button" class="manual-booking-btn" onclick="toggleManualBooking()">+ Ny booking</button>
      <div id="manualBookingForm" class="manual-booking-form">
        <div class="manual-grid">
          <div class="manual-field full"><label>Navn *</label><input id="manualName" autocomplete="name"></div>
          <div class="manual-field"><label>E-post</label><input id="manualEmail" type="email" autocomplete="email"></div>
          <div class="manual-field"><label>Telefon</label><input id="manualPhone" type="tel" autocomplete="tel"></div>
          <div class="manual-field"><label>Fra dato *</label><input id="manualStart" type="date"></div>
          <div class="manual-field"><label>Til dato *</label><input id="manualEnd" type="date"></div>
          <div class="manual-field"><label>Betalingsstatus</label><select id="manualPayment"><option value="unpaid">Ubetalt</option><option value="partial">Delvis betalt</option><option value="paid">Betalt</option></select></div>
          <div class="manual-field full"><label>Kommentar</label><textarea id="manualMessage" rows="3" placeholder="F.eks. telefonbestilling, familie, intern bruk ..."></textarea></div>
        </div>
        <div class="manual-actions"><button type="button" class="manual-save" onclick="saveManualBooking()">Legg inn booking</button><button type="button" class="manual-cancel" onclick="toggleManualBooking(false)">Avbryt</button></div>
      </div>`;
    searchPanel.appendChild(box);
  }

  window.toggleManualBooking = function(force) {
    const form = document.getElementById("manualBookingForm");
    if (!form) return;
    if (force === false) form.classList.remove("open"); else form.classList.toggle("open");
  };

  function approvedOverlap(start, end) {
    return (window.allBookings || allBookings || []).find(b => b.status === "approved" && start < b.end_date && end > b.start_date);
  }

  window.saveManualBooking = async function() {
    const name = document.getElementById("manualName")?.value.trim();
    const email = document.getElementById("manualEmail")?.value.trim() || null;
    const phone = document.getElementById("manualPhone")?.value.trim() || null;
    const start = document.getElementById("manualStart")?.value;
    const end = document.getElementById("manualEnd")?.value;
    const payment = document.getElementById("manualPayment")?.value || "unpaid";
    const message = document.getElementById("manualMessage")?.value.trim() || "Manuelt lagt inn av admin.";
    if (!name || !start || !end) return alert("Fyll inn navn, fra-dato og til-dato.");
    if (!email) return alert("Fyll inn e-post slik at kunden kan få bookingbekreftelse.");
    if (end <= start) return alert("Til-dato må være etter fra-dato.");
    const overlap = approvedOverlap(start, end);
    if (overlap) return alert(`❌ Kan ikke legge inn booking.\nPerioden overlapper med ${overlap.name || "en eksisterende godkjent booking"} (${overlap.start_date} → ${overlap.end_date}).`);
    if (!confirm(`Legge inn ${name} som godkjent booking ${start} → ${end} og sende bekreftelse til ${email}?`)) return;

    const row = {name, email, phone, start_date:start, end_date:end, status:"approved", payment_status:payment, paid_at:payment === "paid" ? new Date().toISOString() : null, message};
    const {data:created,error} = await supabaseClient.from("bookings").insert(row).select("id").single();
    if (error) { console.error(error); return alert("Kunne ikke legge inn bookingen: " + error.message); }

    let emailSent = false;
    try {
      const bookingId = String(created.id);
      const replyUrl = `${location.origin}/reply.html?booking=${encodeURIComponent(bookingId)}`;
      const response = await fetch(`${supabaseUrl}/functions/v1/resend-email`, {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${supabaseAnonKey}`},
        body:JSON.stringify({type:"approved",name,email,phone:phone||"",start,end,invoiceUrl:null,bookingId,replyUrl})
      });
      emailSent = response.ok;
      if (!response.ok) console.error("Booking lagret, men bekreftelsesmail feilet:", await response.text());
    } catch (mailError) {
      console.error("Booking lagret, men bekreftelsesmail feilet:", mailError);
    }

    ["manualName","manualEmail","manualPhone","manualStart","manualEnd","manualMessage"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
    const pay=document.getElementById("manualPayment"); if(pay) pay.value="unpaid";
    toggleManualBooking(false);
    alert(emailSent ? "✅ Booking lagt inn og bekreftelse sendt på e-post!" : "⚠️ Booking ble lagt inn, men bekreftelsesmailen kunne ikke sendes.");
    await loadData();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", insertForm); else insertForm();
})();
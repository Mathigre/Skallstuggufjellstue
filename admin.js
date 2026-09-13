// =========================
// SUPABASE
// =========================
const supabaseUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";

const supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);

// =========================
// DATA
// =========================
let allBookings = [];
let approvedBookings = [];
let selectedBooking = null;
let currentDate = new Date();

// ======== fakturaer =======

async function uploadInvoiceFile(bookingId) {
  const fileInput = document.getElementById(`invoice-${bookingId}`);
  const file = fileInput?.files?.[0];

  if (!file) return null;

  if (file.type !== "application/pdf") {
    alert("Kun PDF-filer er tillatt.");
    return null;
  }

  const fileExt = file.name.split(".").pop();
  const fileName = `faktura-${bookingId}-${Date.now()}.${fileExt}`;
  const filePath = `booking-${bookingId}/${fileName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from("fakturaer")
    .upload(filePath, file, { upsert: true });

  if (uploadError) {
    console.error("Feil ved opplasting:", uploadError);
    alert("Kunne ikke laste opp faktura.");
    return null;
  }

  const { data, error: signedUrlError } = await supabaseClient.storage
    .from("fakturaer")
    .createSignedUrl(filePath, 60 * 60 * 24 * 7);

  if (signedUrlError) {
    console.error("Feil ved oppretting av lenke:", signedUrlError);
    alert("Kunne ikke lage lenke til faktura.");
    return null;
  }

  return data.signedUrl;
}

// =========================
// OPPRETT FAKTURA I FIKEN (FIXET)
// =========================
async function createFikenInvoice(booking) {
  const nights = Math.ceil(
    (new Date(booking.end_date) - new Date(booking.start_date)) / (1000 * 60 * 60 * 24)
  );

  const pricePerNight = 1500;

  let res;

  try {
    res = await fetch(`${supabaseUrl}/functions/v1/create-fiken-invoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        name: booking.name,
        email: booking.email,
        phone: booking.phone || "",
        startDate: booking.start_date,
        endDate: booking.end_date,
        nights: nights,
        pricePerNight: pricePerNight
      })
    });
  } catch (fetchError) {
    console.error("Fetch feilet:", fetchError);
    throw new Error("Kunne ikke nå Edge Function");
  }

  // 🔥 LES SOM TEXT FØRST (fixer JSON error)
  const text = await res.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (parseError) {
    console.error("❌ Ikke JSON fra Edge Function:");
    console.error(text);
    throw new Error("Edge function returnerte ikke gyldig JSON");
  }

  // 🔥 hvis Fiken feiler
  if (!res.ok) {
    console.error("❌ Fiken/API feil:", data);
    throw new Error(data.error || "Feil ved oppretting av faktura");
  }

  console.log("✅ Fiken OK:", data);

  return data;
}
// =========================
// LOAD DATA
// =========================
async function loadData() {
  try {
    const { data, error } = await supabaseClient.from("bookings").select("*");
    if (error) throw error;

    allBookings = data || [];
    approvedBookings = allBookings.filter(b => b.status === "approved");

    loadRequestsWithHighlight();
    loadCalendar();
  } catch (err) {
    console.error("Feil ved henting av data:", err);
  }
}

// =========================
// TOGGLE, STATUS, SEARCH
// =========================
function toggle(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden");
}

function statusText(status) {
  if (status === "approved") return "Godkjent";
  if (status === "rejected") return "Avslått";
  return "Forespørsel";
}

function debounce(func, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
}

document.getElementById("search")?.addEventListener("input", debounce(loadRequestsWithHighlight, 300));

function loadRequestsWithHighlight() {
  const searchTerm = (document.getElementById("search")?.value || "").toLowerCase().trim();

  const foresp = document.getElementById("foresporsler");
  const godkj = document.getElementById("godkjente");
  const avsl = document.getElementById("avslatte");

  foresp.innerHTML = godkj.innerHTML = avsl.innerHTML = "";

  let countPending = 0, countApproved = 0, countRejected = 0;
  let firstMatch = null;

  allBookings.forEach(b => {
    if (b.status === "approved") countApproved++;
    else if (b.status === "rejected") countRejected++;
    else countPending++;

    const nameLower = (b.name || "").toLowerCase();
    const emailLower = (b.email || "").toLowerCase();

    if (searchTerm && !nameLower.includes(searchTerm) && !emailLower.includes(searchTerm)) return;

    if (!firstMatch) firstMatch = b;

    const overlap = checkOverlap(b);

    const div = document.createElement("div");
    div.className = `menu ${b.status === "approved" ? "godkjent" : b.status === "rejected" ? "avslatt" : "foresporsel"}`;

    div.innerHTML = `
      <p><strong>${b.name || "Ukjent"}</strong></p>
      <p>
        E-post: <a href="mailto:${b.email}" class="contact-link">${b.email || "-"}</a><br>
        Telefon: <a href="tel:${b.phone}" class="contact-link">${b.phone || "-"}</a>
      </p>
      <p>${b.start_date} → ${b.end_date}</p>
      <p>Status: <strong>${statusText(b.status)}</strong></p>
      
      ${b.message ? `<div class="customer-message"><strong>Melding fra kunde:</strong><br>${b.message}</div>` : ""}

      ${overlap ? `<div class="warning">⚠️ Dobbelbooking med ${overlap.name || "en annen forespørsel"}</div>` : ""}

      <div style="margin: 12px 0 10px 0;">
        <textarea id="reply-${b.id}" rows="3" placeholder="Skriv svar til kunden her..." 
            style="width:100%; padding:10px; border:1px solid #ccc; border-radius:6px; resize:vertical;"></textarea>

        <div style="margin-top:10px;">
         <label style="display:block; margin-bottom:6px; font-weight:600;">Legg ved faktura (PDF)</label>
         <input type="file" id="invoice-${b.id}" accept=".pdf,application/pdf"
           style="width:100%; padding:8px; border:1px solid #ccc; border-radius:6px; background:white;">
        </div>

        <button onclick="sendReply('${b.id}', '${b.email}', '${b.name}')" 
          style="margin-top:10px; padding:8px 16px; background:#1976d2; color:white; border:none; border-radius:6px; cursor:pointer;">
          Send svar til kunde
         </button>
      </div>

      <button onclick="approve('${b.id}')">Godkjenn</button>
      <button onclick="reject('${b.id}')">Avslå</button>
    `;

    if (b.status === "approved") godkj.appendChild(div);
    else if (b.status === "rejected") avsl.appendChild(div);
    else foresp.appendChild(div);
  });

  document.querySelector("[onclick=\"toggle('foresporsler')\"]").innerText = `📩 Forespørsler (${countPending})`;
  document.querySelector("[onclick=\"toggle('godkjente')\"]").innerText = `✅ Godkjente (${countApproved})`;
  document.querySelector("[onclick=\"toggle('avslatte')\"]").innerText = `❌ Avslåtte (${countRejected})`;

  if (firstMatch) {
    highlightBookingInCalendar(firstMatch);
  } else {
    selectedBooking = null;
    loadCalendar();
  }
}

// =========================
// OVERLAP SJekk
// =========================
function checkOverlap(booking) {
  for (let b of allBookings) {
    if (b.id === booking.id) continue;
    if (b.status !== "pending") continue;

    if (!(booking.end_date <= b.start_date || booking.start_date >= b.end_date)) {
      return b;
    }
  }
  return null;
}

// =========================
// HIGHLIGHT BOOKING I KALENDEREN
// =========================
function highlightBookingInCalendar(booking) {
  selectedBooking = booking;

  const startDate = new Date(booking.start_date);
  currentDate.setFullYear(startDate.getFullYear());
  currentDate.setMonth(startDate.getMonth());

  loadCalendar();

  setTimeout(() => {
    const calendarElement = document.getElementById("calendar");
    if (calendarElement) {
      calendarElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 100);
}

// =========================
// SEND SVAR TIL KUNDE
// =========================
async function sendReply(bookingId, customerEmail, customerName) {
  const textarea = document.getElementById(`reply-${bookingId}`);
  const message = textarea.value.trim();

  if (!message) {
    alert("Skriv en melding før du sender.");
    return;
  }

  if (!confirm(`Vil du sende dette svaret til ${customerName}?`)) return;

  try {
    const response = await fetch("https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/resend-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        type: "admin_reply",
        name: customerName,
        email: customerEmail,
        message: message
      })
    });

    if (response.ok) {
      alert("✅ Svar sendt til kunden!");
      textarea.value = "";
    } else {
      alert("Feil ved sending av svar.");
    }
  } catch (err) {
    console.error(err);
    alert("Kunne ikke sende e-post. Sjekk konsollen.");
  }
}

// =========================
// GODKJENN / AVSLÅ (oppdatert med Fiken)
// =========================
async function approve(id) {
  const b = allBookings.find(x => x.id === id);
  if (!b) return;

  const overlap = checkOverlap(b);
  if (overlap) {
    alert(`❌ Dobbelbooking!\nOverlapper med ${overlap.name || "en annen booking"}`);
    return;
  }

  if (!confirm(`Vil du godkjenne bookingen og lage faktura i Fiken til ${b.name}?`)) return;

  let pdfUrl = null;

  try {
    pdfUrl = await uploadInvoiceFile(id);   // PDF er fortsatt valgfri
  } catch (err) {
    console.error("Feil ved PDF-opplasting:", err);
  }

  try {
    // Lag faktura i Fiken
    const fikenResult = await createFikenInvoice(b);

    // Oppdater booking i databasen
    const { error: updateError } = await supabaseClient
      .from("bookings")
      .update({
        status: "approved",
        invoice_url: fikenResult.fikenDraftUrl || pdfUrl   // Fiken-lenke prioriteres
      })
      .eq("id", id);

    if (updateError) {
      alert(`Kunne ikke godkjenne:\n${updateError.message || updateError}`);
      return;
    }

    // Send e-post til kunde (som før)
    await fetch("https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/resend-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        type: "approved",
        name: b.name,
        email: b.email,
        phone: b.phone || "",
        start: b.start_date,
        end: b.end_date,
        invoiceUrl: fikenResult.fikenDraftUrl || pdfUrl || null
      })
    });

    alert(`✅ Booking godkjent!\nFaktura opprettet i Fiken`);
    await loadData();

  } catch (err) {
    console.error(err);
    alert("Feil ved godkjenning:\n" + err.message);
  }
}

async function reject(id) {
  if (!confirm("Er du sikker på at du vil avslå denne forespørselen?")) return;

  const { error } = await supabaseClient
    .from("bookings")
    .update({ status: "rejected" })
    .eq("id", id);

  if (error) alert("Feil ved avslåing");
  else alert("✅ Booking avslått");

  await loadData();
}

// =========================
// KALENDER + POPUP
// =========================
function changeMonth(dir) {
  currentDate.setMonth(currentDate.getMonth() + dir);
  loadCalendar();
}

function loadCalendar() {
  const calendar = document.getElementById("calendar");
  if (!calendar) return;
  calendar.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  document.getElementById("monthTitle").innerText =
    currentDate.toLocaleString("no-NO", { month: "long", year: "numeric" });

  const days = new Date(year, month + 1, 0).getDate();

  for (let i = 1; i <= days; i++) {
    const dateStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(i).padStart(2, "0");

    const div = document.createElement("div");
    div.classList.add("day");

    const content = document.createElement("div");
    content.className = "day-content";

    const number = document.createElement("div");
    number.className = "day-number";
    number.textContent = i;
    content.appendChild(number);

    let dayBookings = [];
    let isFullyBooked = false;
    let isStart = false;
    let isEnd = false;

    approvedBookings.forEach(b => {
      const bStart = b.start_date;
      const bEnd = b.end_date;
      const name = (b.name || "Ukjent").trim();

      let relevant = false;

      if (dateStr === bStart && dateStr === bEnd) isFullyBooked = relevant = true;
      else if (dateStr === bStart) isStart = relevant = true;
      else if (dateStr === bEnd) isEnd = relevant = true;
      else if (dateStr > bStart && dateStr < bEnd) isFullyBooked = relevant = true;

      if (relevant) {
        dayBookings.push({
          name: name,
          email: b.email || "-",
          phone: b.phone || "-",
          start: b.start_date,
          end: b.end_date
        });
      }
    });

    if (dayBookings.length > 0) {
      const uniqueNames = [...new Set(dayBookings.map(b => b.name))];
      const nameDiv = document.createElement("div");
      nameDiv.className = "day-name";
      nameDiv.textContent = uniqueNames.join(", ");
      content.appendChild(nameDiv);
    }

    if (isFullyBooked || (isStart && isEnd)) div.classList.add("booked");
    else if (isStart) div.classList.add("half-start");
    else if (isEnd) div.classList.add("half-end");

    if (selectedBooking && dateStr >= selectedBooking.start_date && dateStr <= selectedBooking.end_date) {
      div.classList.add("highlight");
    }

    if (dayBookings.length > 0) {
      div.style.cursor = "pointer";
      div.addEventListener("click", () => showDayInfo(dateStr, dayBookings));
    }

    div.appendChild(content);
    calendar.appendChild(div);
  }
}

function showDayInfo(dateStr, bookings) {
  let html = `<h3>${dateStr}</h3><hr>`;
  bookings.forEach(b => {
    html += `<strong>${b.name}</strong><br>E-post: ${b.email}<br>Telefon: ${b.phone}<br>Periode: ${b.start} → ${b.end}<br><br>`;
  });

  const popup = document.createElement("div");
  popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:25px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.4);z-index:10000;max-width:420px;`;
  popup.innerHTML = html;

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Lukk";
  closeBtn.onclick = () => popup.remove();
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
}

// =========================
// START
// =========================
loadData();
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

// =========================
// LOAD DATA
// =========================
async function loadData() {
  try {
    const { data, error } = await supabaseClient
      .from("bookings")
      .select("*");

    if (error) throw error;

    allBookings = data || [];
    approvedBookings = allBookings.filter(b => b.status === "approved");

    loadRequests();
    loadCalendar();

  } catch (err) {
    console.error("Feil ved henting av data:", err);
    alert("Kunne ikke laste bookinger. Sjekk konsollen.");
  }
}

// =========================
// TOGGLE, STATUS, OVERLAP, SEARCH, REQUESTS
// =========================
function toggle(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden");
}

function statusText(status) {
  if (status === "approved") return "Godkjent";
  if (status === "rejected") return "Avslått";
  return "Forespørsel";
}

function checkOverlap(booking) {
  for (let b of approvedBookings) {
    if (booking.id === b.id) continue;
    if (!(booking.end_date <= b.start_date || booking.start_date >= b.end_date)) {
      return b;
    }
  }
  return null;
}

document.getElementById("search")?.addEventListener("input", loadRequests);

function loadRequests() {
  const search = (document.getElementById("search")?.value || "").toLowerCase();

  const foresp = document.getElementById("foresporsler");
  const godkj = document.getElementById("godkjente");
  const avsl = document.getElementById("avslatte");

  if (!foresp || !godkj || !avsl) return;

  foresp.innerHTML = "";
  godkj.innerHTML = "";
  avsl.innerHTML = "";

  let countPending = 0;
  let countApproved = 0;
  let countRejected = 0;

  allBookings.forEach(b => {
    const name = (b.name || "").toLowerCase();
    const email = (b.email || "").toLowerCase();

    if (b.status === "approved") countApproved++;
    else if (b.status === "rejected") countRejected++;
    else countPending++;

    if (!name.includes(search) && !email.includes(search)) return;

    const overlap = checkOverlap(b);

    let css = b.status === "approved" ? "godkjent" :
              b.status === "rejected" ? "avslatt" : "foresporsel";

    const div = document.createElement("div");
    div.className = "menu " + css;

    div.innerHTML = `
      <p><strong>${b.name || "Ukjent"}</strong></p>
      <p>
        E-post: <a href="mailto:${b.email}" class="contact-link">${b.email || "-"}</a><br>
        Telefon: <a href="tel:${b.phone}" class="contact-link">${b.phone || "-"}</a>
      </p>
      <p>${b.start_date} → ${b.end_date}</p>
      <p>Status: <strong>${statusText(b.status)}</strong></p>
      
      ${b.message ? `<div class="customer-message"><strong>Melding fra kunde:</strong><br>${b.message}</div>` : ""}
      
      ${overlap ? `<p class="warning">⚠️ Dobbelbooking med ${overlap.name}</p>` : ""}
      
      <button onclick="approve('${b.id}')">Godkjenn</button>
      <button onclick="reject('${b.id}')">Avslå</button>
    `;

    div.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      selectedBooking = b;
      loadCalendar();
    });

    if (b.status === "approved") godkj.appendChild(div);
    else if (b.status === "rejected") avsl.appendChild(div);
    else foresp.appendChild(div);
  });

  if (foresp.innerHTML === "") foresp.innerHTML = "<p>Ingen forespørsler</p>";

  const forespHeader = document.querySelector("[onclick=\"toggle('foresporsler')\"]");
  const godkjHeader = document.querySelector("[onclick=\"toggle('godkjente')\"]");
  const avslHeader = document.querySelector("[onclick=\"toggle('avslatte')\"]");

  if (forespHeader) forespHeader.innerText = `📩 Forespørsler (${countPending})`;
  if (godkjHeader) godkjHeader.innerText = `✅ Godkjente (${countApproved})`;
  if (avslHeader) avslHeader.innerText = `❌ Avslåtte (${countRejected})`;
}

// =========================
// GODKJENN / AVSLÅ
// =========================
async function approve(id) {
  const b = allBookings.find(x => x.id === id);
  if (!b) return;

  const overlap = checkOverlap(b);
  if (overlap) {
    alert(`❌ Dobbelbooking!\nOverlapper med ${overlap.name || "en annen booking"}`);
    return;
  }

  const adminReply = prompt(
    `Skriv svar til ${b.name} (f.eks. pris, velkomst, tidspunkt osv.):\n\n` +
    `Eksempel: "Velkommen! Total pris for 2 netter blir 2500 kr. Vi møtes kl 15."\n\n` +
    `Skriv her (kan stå tomt):`,
    ""
  );

  const finalReply = adminReply ? adminReply.trim() : "";

  const { error: updateError } = await supabaseClient
    .from("bookings")
    .update({ status: "approved" })
    .eq("id", id);

  if (updateError) {
    console.error("Feil ved oppdatering:", updateError);
    alert(`Kunne ikke godkjenne:\n${updateError.message || updateError}`);
    return;
  }

  try {
    const response = await fetch("https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/resend-email", {
      method: "POST",
      mode: "cors",
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
        adminReply: finalReply
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("E-post feilet:", result);
      alert(`✅ Booking godkjent!\n\nMen e-posten ble ikke sendt til ${b.email}.`);
    } else {
      alert(`✅ Booking godkjent!\n\nBekreftelse med ditt svar er sendt til ${b.email}`);
    }
  } catch (err) {
    console.error("Feil ved e-post sending:", err);
    alert(`✅ Booking er godkjent, men e-posten kunne ikke sendes.\nSjekk konsollen.`);
  }

  await loadData();
}

async function reject(id) {
  if (!confirm("Er du sikker på at du vil avslå denne forespørselen?")) return;

  const { error } = await supabaseClient
    .from("bookings")
    .update({ status: "rejected" })
    .eq("id", id);

  if (error) {
    console.error("Feil ved avslå:", error);
    alert(`Kunne ikke avslå booking.\nFeil: ${error.message || JSON.stringify(error)}`);
    return;
  }

  alert("✅ Booking avslått.");
  await loadData();
}

// =========================
// KALENDER + POPUP (uendret)
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

      if (dateStr === bStart && dateStr === bEnd) {
        isFullyBooked = true;
        relevant = true;
      }
      else if (dateStr === bStart) {
        isStart = true;
        relevant = true;
      }
      else if (dateStr === bEnd) {
        isEnd = true;
        relevant = true;
      }
      else if (dateStr > bStart && dateStr < bEnd) {
        isFullyBooked = true;
        relevant = true;
      }

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

    if (isFullyBooked || (isStart && isEnd)) {
      div.classList.add("booked");
    } else if (isStart) {
      div.classList.add("half-start");
    } else if (isEnd) {
      div.classList.add("half-end");
    }

    if (selectedBooking && 
        dateStr >= selectedBooking.start_date && 
        dateStr <= selectedBooking.end_date) {
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
    html += `
    <strong>${b.name}</strong><br>
    E-post: ${b.email}<br>
    Telefon: ${b.phone}<br>
    Periode: ${b.start} → ${b.end}<br><br>
`;
  });

  const popup = document.createElement("div");
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; padding: 25px; border-radius: 12px; 
    box-shadow: 0 10px 30px rgba(0,0,0,0.4); z-index: 10000; 
    max-width: 420px;
  `;
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
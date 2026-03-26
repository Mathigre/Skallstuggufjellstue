// =========================
// SUPABASE
// =========================
const supabaseUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

// =========================
// MESSAGE FUNCTIONS
// =========================
const messageBox = document.getElementById("messageBox");

function showError(msg) {
  messageBox.className = "message-error";
  messageBox.innerHTML = msg;
  messageBox.style.display = "block";
}

function showSuccess(msg) {
  messageBox.className = "message-success";
  messageBox.innerHTML = msg;
  messageBox.style.display = "block";
}

function clearMessage() {
  messageBox.style.display = "none";
}

// =========================
// OVERLAP SJekk (Dobbeltbooking-perre)
// =========================
function hasOverlap(newStart, newEnd) {
  return approvedBookings.some(b => {
    const existingStart = b.start_date;
    const existingEnd = b.end_date;
    // Overlap hvis ikke (newEnd <= existingStart eller newStart >= existingEnd)
    return !(newEnd <= existingStart || newStart >= existingEnd);
  });
}

// =========================
// BOOKING FORM
// =========================
document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const name  = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const start = document.getElementById("start").value;
  const end   = document.getElementById("end").value;
  const customerMessage = document.getElementById("customerMessage")?.value.trim() || "";

  if (!name || !email || !phone || !start || !end) {
    showError("❌ Fyll inn alle felter!");
    return;
  }
  if (start >= end) {
    showError("❌ Startdato må være før sluttdato!");
    return;
  }

  // === DOBBELTBOOKING SJekk ===
  if (hasOverlap(start, end)) {
    showError("❌ Disse datoene er allerede booket av en annen gjest.<br>Velg en annen periode.");
    return;
  }

  try {
    console.log("📤 Forsøker å lagre booking...");

    const { data, error: insertError } = await supabaseClient
      .from("bookings")
      .insert([{
        name,
        email,
        phone,
        start_date: start,
        end_date: end,
        status: "pending",
        message: customerMessage
      }])
      .select();

    if (insertError) throw insertError;

    console.log("✅ Booking lagret vellykket");

    // SEND E-POSTER
    const functionUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/resend-email";
    let emailsSent = true;

    // Kunde-e-post
    try {
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({ type: "request_customer", name, email, phone, start, end, customerMessage })
      });
      if (!res.ok) emailsSent = false;
    } catch (err) {
      console.error("Kunde-epost feilet:", err);
      emailsSent = false;
    }

    // Eier-e-post
    try {
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({ type: "request_owner", name, email, phone, start, end, customerMessage })
      });
      if (!res.ok) emailsSent = false;
    } catch (err) {
      console.error("Eier-epost feilet:", err);
      emailsSent = false;
    }

    if (emailsSent) {
      showSuccess(`<strong>✅ Takk for din forespørsel!</strong><br><br>Vi har mottatt din booking og melding.<br>Du vil få svar på e-post så snart som mulig.<br><br>Ring <strong>906 88 873</strong> ved spørsmål.`);
    } else {
      showSuccess(`<strong>✅ Booking registrert!</strong><br><br>Forespørselen er lagret, men e-post kunne ikke sendes akkurat nå.<br>Vi kontakter deg likevel.<br><br>Ring: <strong>906 88 873</strong>`);
    }

    document.getElementById("bookingForm").reset();

  } catch (err) {
    console.error("Feil ved innsending:", err);
    showError("❌ Noe gikk galt. Prøv igjen.");
  }
});

// =========================
// SJekk mine bookinger
// =========================
async function checkMyBookings() {
  const email = document.getElementById("checkEmail").value.trim();
  const resultDiv = document.getElementById("myBookingsResult");

  if (!email) {
    resultDiv.innerHTML = `<p style="color:red;">Vennligst skriv inn en e-postadresse.</p>`;
    return;
  }

  resultDiv.innerHTML = `<p>Søker etter dine bookinger...</p>`;

  try {
    const { data, error } = await supabaseClient
      .from("bookings")
      .select("*")
      .eq("email", email)
      .order("start_date", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      resultDiv.innerHTML = `<p style="color:#555;">Ingen bookinger funnet på denne e-posten.</p>`;
      return;
    }

    let html = `<h4>Dine bookinger (${data.length} stk):</h4><ul style="line-height:1.8; padding-left:20px;">`;

    data.forEach(b => {
      const status = b.status === "approved" ? "✅ <strong>Godkjent</strong>" :
                     b.status === "rejected" ? "❌ Avslått" : "⏳ Under behandling";
      
      html += `
        <li style="margin-bottom:15px;">
          <strong>${b.start_date} → ${b.end_date}</strong><br>
          Status: ${status}<br>
          ${b.message ? `Melding: "${b.message}"` : ''}
        </li>`;
    });

    html += `</ul>`;
    resultDiv.innerHTML = html;

  } catch (err) {
    console.error(err);
    resultDiv.innerHTML = `<p style="color:red;">Noe gikk galt ved henting av bookinger. Prøv igjen.</p>`;
  }
}

// =========================
// KALENDER (ren versjon - ingen navn vises)
// =========================
let currentDate = new Date();
let approvedBookings = [];

async function loadCalendarBooking() {
  const { data } = await supabaseClient
    .from("bookings")
    .select("*")
    .eq("status", "approved");

  approvedBookings = data || [];
  drawCalendar();
}

function changeMonth(dir) {
  currentDate.setMonth(currentDate.getMonth() + dir);
  drawCalendar();
}

function drawCalendar() {
  const calendar = document.getElementById("calendar");
  if (!calendar) return;

  calendar.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  document.getElementById("monthTitle").innerText = 
    currentDate.toLocaleString("no-NO", { month: "long", year: "numeric" });

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(i).padStart(2, "0");

    const div = document.createElement("div");
    div.classList.add("day");
    div.innerText = i;

    let isFullyBooked = false;
    let isStart = false;
    let isEnd = false;

    approvedBookings.forEach(b => {
      const bs = b.start_date;
      const be = b.end_date;

      if (dateStr === bs && dateStr === be) isFullyBooked = true;
      else if (dateStr === bs) isStart = true;
      else if (dateStr === be) isEnd = true;
      else if (dateStr > bs && dateStr < be) isFullyBooked = true;
    });

    if (isFullyBooked) div.classList.add("booked");
    else if (isStart && isEnd) div.classList.add("booked");
    else if (isStart) div.classList.add("half-start");
    else if (isEnd) div.classList.add("half-end");

    calendar.appendChild(div);
  }
}

// Start kalender
loadCalendarBooking();
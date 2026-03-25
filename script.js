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

    if (insertError) {
      console.error("Insert feil detaljer:", insertError);
      throw new Error(insertError.message || "Kunne ikke lagre booking i databasen");
    }

    console.log("✅ Booking lagret vellykket:", data);

    // SEND E-POSTER
    const functionUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/resend-email";

    let emailsSent = true;

    // Kunde
    try {
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({ 
          type: "request_customer", 
          name, 
          email, 
          phone, 
          start, 
          end,
          customerMessage
        })
      });
      if (!res.ok) emailsSent = false;
    } catch (err) {
      console.error("Kunde-epost feilet:", err);
      emailsSent = false;
    }

    // Eier
    try {
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({ 
          type: "request_owner", 
          name, 
          email, 
          phone, 
          start, 
          end,
          customerMessage
        })
      });
      if (!res.ok) emailsSent = false;
    } catch (err) {
      console.error("Eier-epost feilet:", err);
      emailsSent = false;
    }

    if (emailsSent) {
      showSuccess(`
        <strong>✅ Takk for din booking!</strong><br><br>
        Forespørselen er mottatt og din melding er sendt til oss.<br>
        Du vil få bekreftelse på e-post fra Skallstuggu snart.<br><br>
        Ring <strong>906 88 873</strong> hvis du ikke hører noe innen 24 timer.
      `);
    } else {
      showSuccess(`
        <strong>✅ Booking registrert!</strong><br><br>
        Forespørselen din er lagret inkludert din melding.<br>
        E-posten kunne ikke sendes akkurat nå, men vi kontakter deg likevel.<br><br>
        Ring gjerne: <strong>906 88 873</strong>
      `);
    }

    document.getElementById("bookingForm").reset();

  } catch (err) {
    console.error("Feil ved innsending:", err);
    showError("❌ Noe gikk galt under innsending. Prøv igjen.");
  }
});

// =========================
// KALENDER (uendret)
// =========================
let currentDate = new Date();
let approvedBookings = [];

async function loadCalendarBooking() {
  const { data } = await supabaseClient.from("bookings").select("*").eq("status", "approved");
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
  document.getElementById("monthTitle").innerText = currentDate.toLocaleString("no-NO", { month: "long", year: "numeric" });

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(i).padStart(2, "0");
    const div = document.createElement("div");
    div.classList.add("day");
    div.innerText = i;

    let isFullyBooked = false, isStart = false, isEnd = false;

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

loadCalendarBooking();
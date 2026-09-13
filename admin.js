// =========================
// SUPABASE
// =========================
const supabaseUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";
const supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);

let allBookings = [];
let approvedBookings = [];
let selectedBooking = null;
let currentDate = new Date();

async function uploadInvoiceFile(bookingId) {
  const fileInput = document.getElementById(`invoice-${bookingId}`);
  const file = fileInput?.files?.[0];
  if (!file) return null;
  if (file.type !== "application/pdf") { alert("Kun PDF-filer er tillatt."); return null; }
  const filePath = `booking-${bookingId}/faktura-${bookingId}-${Date.now()}.pdf`;
  const { error } = await supabaseClient.storage.from("fakturaer").upload(filePath, file, { upsert: true });
  if (error) { console.error(error); alert("Kunne ikke laste opp faktura."); return null; }
  const { data, error: urlError } = await supabaseClient.storage.from("fakturaer").createSignedUrl(filePath, 60 * 60 * 24 * 7);
  if (urlError) { console.error(urlError); return null; }
  return data.signedUrl;
}

async function loadData() {
  try {
    const { data, error } = await supabaseClient.from("bookings").select("*");
    if (error) throw error;
    allBookings = data || [];
    approvedBookings = allBookings.filter(b => b.status === "approved");
    await loadRequestsWithHighlight();
    loadCalendar();
  } catch (err) { console.error("Feil ved henting av data:", err); }
}

function toggle(id) { document.getElementById(id)?.classList.toggle("hidden"); }
function statusText(status) { return status === "approved" ? "Godkjent" : status === "rejected" ? "Avslått" : "Forespørsel"; }
function debounce(func, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), delay); }; }
document.getElementById("search")?.addEventListener("input", debounce(loadRequestsWithHighlight, 300));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

async function getMessages(bookingId) {
  const { data, error } = await supabaseClient.from("booking_messages").select("*").eq("booking_id", bookingId).order("created_at", { ascending: true });
  if (error) { console.error("Kunne ikke hente samtale:", error); return []; }
  return data || [];
}

function renderMessages(messages) {
  if (!messages.length) return `<div style="color:#777;margin:8px 0;">Ingen meldinger i samtalen ennå.</div>`;
  return messages.map(m => {
    const admin = m.sender === "admin";
    return `<div style="margin:8px 0;padding:10px 12px;border-radius:8px;background:${admin ? "#eef4ff" : "#f5f5f5"};">
      <strong>${admin ? "Skallstuggu" : "Kunde"}</strong><br>${escapeHtml(m.message)}
    </div>`;
  }).join("");
}

async function loadRequestsWithHighlight() {
  const searchTerm = (document.getElementById("search")?.value || "").toLowerCase().trim();
  const foresp = document.getElementById("foresporsler"), godkj = document.getElementById("godkjente"), avsl = document.getElementById("avslatte");
  if (!foresp || !godkj || !avsl) return;
  foresp.innerHTML = godkj.innerHTML = avsl.innerHTML = "";
  let countPending = 0, countApproved = 0, countRejected = 0, firstMatch = null;

  for (const b of allBookings) {
    if (b.status === "approved") countApproved++; else if (b.status === "rejected") countRejected++; else countPending++;
    const matches = (b.name || "").toLowerCase().includes(searchTerm) || (b.email || "").toLowerCase().includes(searchTerm);
    if (searchTerm && !matches) continue;
    if (!firstMatch) firstMatch = b;
    const overlap = checkOverlap(b);
    const messages = await getMessages(b.id);
    const div = document.createElement("div");
    div.className = `menu ${b.status === "approved" ? "godkjent" : b.status === "rejected" ? "avslatt" : "foresporsel"}`;
    div.innerHTML = `
      <p><strong>${escapeHtml(b.name || "Ukjent")}</strong></p>
      <p>E-post: <a href="mailto:${escapeHtml(b.email)}" class="contact-link">${escapeHtml(b.email || "-")}</a><br>Telefon: <a href="tel:${escapeHtml(b.phone)}" class="contact-link">${escapeHtml(b.phone || "-")}</a></p>
      <p>${escapeHtml(b.start_date)} → ${escapeHtml(b.end_date)}</p>
      <p>Status: <strong>${statusText(b.status)}</strong></p>
      ${b.message ? `<div class="customer-message"><strong>Melding fra kunde:</strong><br>${escapeHtml(b.message)}</div>` : ""}
      ${overlap ? `<div class="warning">⚠️ Dobbelbooking med ${escapeHtml(overlap.name || "en annen forespørsel")}</div>` : ""}
      <div style="margin-top:14px;border-top:1px solid #ddd;padding-top:12px;"><strong>Samtale</strong>${renderMessages(messages)}</div>
      <div style="margin:12px 0 10px;"><textarea id="reply-${b.id}" rows="3" placeholder="Skriv svar til kunden her..." style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;resize:vertical;"></textarea>
      <div style="margin-top:10px;"><label style="display:block;margin-bottom:6px;font-weight:600;">Legg ved faktura (PDF)</label><input type="file" id="invoice-${b.id}" accept=".pdf,application/pdf" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:white;"></div>
      <button onclick='sendReply(${JSON.stringify(String(b.id))}, ${JSON.stringify(b.email || "")}, ${JSON.stringify(b.name || "")})' style="margin-top:10px;padding:8px 16px;background:#1976d2;color:white;border:none;border-radius:6px;cursor:pointer;">Send svar til kunde</button></div>
      <button onclick='approve(${JSON.stringify(String(b.id))})'>Godkjenn</button>
      <button onclick='reject(${JSON.stringify(String(b.id))})'>Avslå</button>`;
    if (b.status === "approved") godkj.appendChild(div); else if (b.status === "rejected") avsl.appendChild(div); else foresp.appendChild(div);
  }

  const p = document.querySelector("[onclick=\"toggle('foresporsler')\"]"), g = document.querySelector("[onclick=\"toggle('godkjente')\"]"), a = document.querySelector("[onclick=\"toggle('avslatte')\"]");
  if (p) p.innerText = `📩 Forespørsler (${countPending})`; if (g) g.innerText = `✅ Godkjente (${countApproved})`; if (a) a.innerText = `❌ Avslåtte (${countRejected})`;
  if (firstMatch) highlightBookingInCalendar(firstMatch); else { selectedBooking = null; loadCalendar(); }
}

function checkOverlap(booking) {
  for (const b of allBookings) {
    if (b.id === booking.id || b.status !== "pending") continue;
    if (!(booking.end_date <= b.start_date || booking.start_date >= b.end_date)) return b;
  }
  return null;
}

function highlightBookingInCalendar(booking) {
  selectedBooking = booking;
  const d = new Date(booking.start_date);
  currentDate.setFullYear(d.getFullYear()); currentDate.setMonth(d.getMonth()); loadCalendar();
}

async function sendReply(bookingId, customerEmail, customerName) {
  const textarea = document.getElementById(`reply-${bookingId}`);
  const message = textarea?.value.trim();
  if (!message) return alert("Skriv en melding før du sender.");
  if (!confirm(`Vil du sende dette svaret til ${customerName}?`)) return;
  const replyUrl = `${location.origin}/reply.html?booking=${encodeURIComponent(bookingId)}`;
  try {
    const { error: messageError } = await supabaseClient.from("booking_messages").insert({ booking_id: bookingId, sender: "admin", message });
    if (messageError) throw messageError;
    const response = await fetch(`${supabaseUrl}/functions/v1/resend-email`, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({ type: "admin_reply", name: customerName, email: customerEmail, message, bookingId, replyUrl })
    });
    if (!response.ok) throw new Error("E-posten kunne ikke sendes");
    textarea.value = "";
    alert("✅ Svar sendt og lagret i samtalen!");
    await loadRequestsWithHighlight();
  } catch (err) { console.error(err); alert("Kunne ikke sende svaret: " + (err.message || err)); }
}

async function approve(id) {
  const b = allBookings.find(x => String(x.id) === String(id)); if (!b) return;
  const overlap = checkOverlap(b); if (overlap) return alert(`❌ Dobbelbooking!\nOverlapper med ${overlap.name || "en annen booking"}`);
  if (!confirm(`Vil du godkjenne bookingen til ${b.name}?`)) return;
  let pdfUrl = null; try { pdfUrl = await uploadInvoiceFile(id); } catch (e) { console.error(e); }
  const { error } = await supabaseClient.from("bookings").update({ status: "approved", invoice_url: pdfUrl || null }).eq("id", id);
  if (error) return alert("Kunne ikke godkjenne: " + error.message);
  await fetch(`${supabaseUrl}/functions/v1/resend-email`, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${supabaseAnonKey}`}, body:JSON.stringify({type:"approved",name:b.name,email:b.email,phone:b.phone||"",start:b.start_date,end:b.end_date,invoiceUrl:pdfUrl||null}) });
  alert("✅ Booking godkjent!"); await loadData();
}

async function reject(id) {
  if (!confirm("Er du sikker på at du vil avslå denne forespørselen?")) return;
  const { error } = await supabaseClient.from("bookings").update({ status:"rejected" }).eq("id", id);
  if (error) alert("Feil ved avslåing"); else alert("✅ Booking avslått"); await loadData();
}

function changeMonth(dir) { currentDate.setMonth(currentDate.getMonth() + dir); loadCalendar(); }
function loadCalendar() {
  const calendar = document.getElementById("calendar"); if (!calendar) return; calendar.innerHTML = "";
  const year=currentDate.getFullYear(), month=currentDate.getMonth();
  const title=document.getElementById("monthTitle"); if(title) title.innerText=currentDate.toLocaleString("no-NO",{month:"long",year:"numeric"});
  const days=new Date(year,month+1,0).getDate();
  for(let i=1;i<=days;i++){
    const dateStr=year+"-"+String(month+1).padStart(2,"0")+"-"+String(i).padStart(2,"0");
    const div=document.createElement("div"); div.classList.add("day");
    const content=document.createElement("div"); content.className="day-content"; const number=document.createElement("div"); number.className="day-number"; number.textContent=i; content.appendChild(number);
    let dayBookings=[],isFullyBooked=false,isStart=false,isEnd=false;
    approvedBookings.forEach(b=>{let relevant=false;if(dateStr===b.start_date&&dateStr===b.end_date)isFullyBooked=relevant=true;else if(dateStr===b.start_date)isStart=relevant=true;else if(dateStr===b.end_date)isEnd=relevant=true;else if(dateStr>b.start_date&&dateStr<b.end_date)isFullyBooked=relevant=true;if(relevant)dayBookings.push({name:(b.name||"Ukjent").trim(),email:b.email||"-",phone:b.phone||"-",start:b.start_date,end:b.end_date});});
    if(dayBookings.length){const n=document.createElement("div");n.className="day-name";n.textContent=[...new Set(dayBookings.map(b=>b.name))].join(", ");content.appendChild(n);}
    if(isFullyBooked||(isStart&&isEnd))div.classList.add("booked");else if(isStart)div.classList.add("half-start");else if(isEnd)div.classList.add("half-end");
    if(selectedBooking&&dateStr>=selectedBooking.start_date&&dateStr<=selectedBooking.end_date)div.classList.add("highlight");
    if(dayBookings.length){div.style.cursor="pointer";div.addEventListener("click",()=>showDayInfo(dateStr,dayBookings));}
    div.appendChild(content);calendar.appendChild(div);
  }
}
function showDayInfo(dateStr,bookings){let html=`<h3>${escapeHtml(dateStr)}</h3><hr>`;bookings.forEach(b=>{html+=`<strong>${escapeHtml(b.name)}</strong><br>E-post: ${escapeHtml(b.email)}<br>Telefon: ${escapeHtml(b.phone)}<br>Periode: ${escapeHtml(b.start)} → ${escapeHtml(b.end)}<br><br>`;});const popup=document.createElement("div");popup.style.cssText="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:25px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:10000;max-width:420px";popup.innerHTML=html;const close=document.createElement("button");close.textContent="Lukk";close.onclick=()=>popup.remove();popup.appendChild(close);document.body.appendChild(popup);}

loadData();
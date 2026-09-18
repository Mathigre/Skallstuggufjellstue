// =========================
// SUPABASE
// =========================
const supabaseUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";
const supabaseClient = window.adminClient;

let allBookings = [];
let approvedBookings = [];
let selectedBooking = null;
let currentDate = new Date();

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[c])); }
function debounce(func, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), delay); }; }
function toggle(id) { document.getElementById(id)?.classList.toggle("hidden"); }
function statusText(status) { return status === "approved" ? "Godkjent" : status === "rejected" ? "Avslått" : "Forespørsel"; }
function paymentText(status) { return status === "paid" ? "Betalt" : status === "partial" ? "Delvis betalt" : "Ubetalt"; }
function paymentClass(status) { return status === "paid" ? "pay-paid" : status === "partial" ? "pay-partial" : "pay-unpaid"; }
function todayString() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function formatDate(value) { if(!value)return "-"; const d=new Date(value+"T12:00:00"); return d.toLocaleDateString("no-NO",{day:"numeric",month:"short",year:"numeric"}); }

function addDashboardStyles() {
  if (document.getElementById("dashboardStyles")) return;
  const style=document.createElement("style"); style.id="dashboardStyles";
  style.textContent=`
    .dash-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.dash-stat{background:#fff;border:1px solid #e8e2da;border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.04)}.dash-stat span{display:block;color:#70675f;font-size:.86rem;margin-bottom:5px}.dash-stat strong{font-size:1.7rem;color:#2f2a26}.dash-alert{background:#fff8e8;border:1px solid #efd9a8;border-radius:14px;padding:14px 16px;margin-bottom:20px;color:#554a3f}.booking-card{background:#fff!important;border:1px solid #e5dfd8!important;border-left:5px solid #c9b8a9!important;padding:0!important;overflow:hidden;margin-bottom:10px!important}.booking-card.pending{border-left-color:#e0a51a!important}.booking-card.approved{border-left-color:#3f8a55!important}.booking-card.rejected{border-left-color:#b95b5b!important}.booking-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;cursor:pointer}.booking-main{min-width:0}.booking-name{font-size:1.05rem;font-weight:700;color:#2f2a26}.booking-period{color:#6e665f;font-size:.92rem;margin-top:4px}.booking-badges{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.badge{padding:5px 9px;border-radius:999px;font-size:.78rem;font-weight:700;white-space:nowrap}.badge-status{background:#f0ece7;color:#514942}.pay-unpaid{background:#fde8e8;color:#a22b2b}.pay-partial{background:#fff0c9;color:#8a5b00}.pay-paid{background:#dff3e4;color:#236c36}.booking-details{display:none;padding:0 16px 16px;border-top:1px solid #eee}.booking-card.open .booking-details{display:block}.booking-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.booking-actions button,.payment-actions button{border:0;border-radius:8px;padding:9px 13px;cursor:pointer;font-weight:600}.btn-primary{background:#1976d2;color:#fff}.btn-success{background:#2e7d32;color:#fff}.btn-danger{background:#c74747;color:#fff}.btn-neutral{background:#eee8e1;color:#443c35}.payment-box{background:#f8f6f3;border-radius:10px;padding:12px;margin:12px 0}.payment-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.archive-note{color:#777;font-size:.9rem}.section-header{display:flex;justify-content:space-between;align-items:center}.section-count{font-weight:400;color:#756d66}.empty-state{padding:18px;color:#777;text-align:center;background:#faf9f7;border-radius:10px}.invoice-link{display:inline-block;margin-top:6px}.conversation{margin-top:14px;border-top:1px solid #ddd;padding-top:12px}.msg{margin:8px 0;padding:10px 12px;border-radius:8px}.msg-admin{background:#eef4ff}.msg-customer{background:#f5f5f5}@media(max-width:700px){.dash-summary{grid-template-columns:repeat(2,1fr)}.booking-summary{align-items:flex-start;flex-direction:column}.booking-badges{justify-content:flex-start}.dash-stat strong{font-size:1.4rem}}
  `; document.head.appendChild(style);
}

function setupDashboardShell() {
  addDashboardStyles();
  const foresp=document.getElementById("foresporsler"), godkj=document.getElementById("godkjente"), avsl=document.getElementById("avslatte");
  if(!foresp||!godkj||!avsl)return;
  const parent=foresp.parentElement;
  if(!document.getElementById("dashboardSummary")) {
    const summary=document.createElement("div"); summary.id="dashboardSummary"; parent.insertBefore(summary,parent.firstChild);
  }
  if(!document.getElementById("tidligere")) {
    const heading=document.createElement("h3"); heading.className="section-header"; heading.id="tidligereHeading"; heading.onclick=()=>toggle("tidligere");
    const list=document.createElement("div"); list.id="tidligere";
    godkj.insertAdjacentElement("afterend",list); list.insertAdjacentElement("beforebegin",heading);
  }
}

async function uploadInvoiceFile(bookingId) {
  const fileInput=document.getElementById(`invoice-${bookingId}`), file=fileInput?.files?.[0];
  if(!file)return null; if(file.type!=="application/pdf"){alert("Kun PDF-filer er tillatt.");return null;}
  const filePath=`booking-${bookingId}/faktura-${bookingId}-${Date.now()}.pdf`;
  const {error}=await supabaseClient.storage.from("fakturaer").upload(filePath,file,{upsert:true});
  if(error){console.error(error);alert("Kunne ikke laste opp faktura.");return null;}
  const {data,error:urlError}=await supabaseClient.storage.from("fakturaer").createSignedUrl(filePath,60*60*24*7);
  if(urlError){console.error(urlError);return null;} return data.signedUrl;
}

async function getMessages(bookingId) {
  const {data,error}=await supabaseClient.from("booking_messages").select("*").eq("booking_id",bookingId).order("created_at",{ascending:true});
  if(error){console.error("Kunne ikke hente samtale:",error);return [];} return data||[];
}
function renderMessages(messages) {
  if(!messages.length)return `<div style="color:#777;margin:8px 0;">Ingen meldinger i samtalen ennå.</div>`;
  return messages.map(m=>`<div class="msg ${m.sender==="admin"?"msg-admin":"msg-customer"}"><strong>${m.sender==="admin"?"Skallstuggu":"Kunde"}</strong><br>${escapeHtml(m.message)}</div>`).join("");
}

async function loadData() {
  if(!await window.adminReady)return;
  setupDashboardShell();
  try {
    const {data,error}=await supabaseClient.from("bookings").select("*").order("start_date",{ascending:true}); if(error)throw error;
    allBookings=data||[]; approvedBookings=allBookings.filter(b=>b.status==="approved");
    await renderDashboard(); loadCalendar();
  } catch(err){console.error("Feil ved henting av data:",err);}
}

document.getElementById("search")?.addEventListener("input",debounce(renderDashboard,250));

function renderSummary() {
  const today=todayString();
  const pending=allBookings.filter(b=>b.status!=="approved"&&b.status!=="rejected").length;
  const upcoming=allBookings.filter(b=>b.status==="approved"&&b.end_date>=today).length;
  const unpaid=allBookings.filter(b=>b.status==="approved"&&b.end_date>=today&&(b.payment_status||"unpaid")!=="paid").length;
  const paid=allBookings.filter(b=>b.status==="approved"&&(b.payment_status||"unpaid")==="paid").length;
  const arrivals14=allBookings.filter(b=>b.status==="approved"&&b.start_date>=today&&b.start_date<=new Date(Date.now()+14*86400000).toISOString().slice(0,10)).length;
  const el=document.getElementById("dashboardSummary"); if(!el)return;
  el.innerHTML=`<div class="dash-summary"><div class="dash-stat"><span>📩 Forespørsler</span><strong>${pending}</strong></div><div class="dash-stat"><span>🏡 Kommende</span><strong>${upcoming}</strong></div><div class="dash-stat"><span>🔴 Ubetalt</span><strong>${unpaid}</strong></div><div class="dash-stat"><span>✅ Betalt</span><strong>${paid}</strong></div></div><div class="dash-alert"><strong>Krever oppfølging:</strong> ${pending} forespørsel${pending===1?"":"er"}, ${unpaid} kommende ubetalt${unpaid===1?" booking":"e bookinger"} og ${arrivals14} ankomst${arrivals14===1?"":"er"} de neste 14 dagene.</div>`;
}

async function renderBookingCard(b) {
  const messages=await getMessages(b.id), payment=b.payment_status||"unpaid", overlap=b.cancelled_at?null:checkOverlap(b), isApproved=b.status==="approved";
  const div=document.createElement("div"); div.className=`menu booking-card ${b.status==="approved"?"approved":b.status==="rejected"?"rejected":"pending"}`;
  const paidDate=b.paid_at?new Date(b.paid_at).toLocaleDateString("no-NO"):"";
  div.innerHTML=`<div class="booking-summary" onclick="this.parentElement.classList.toggle('open')"><div class="booking-main"><div class="booking-name">${escapeHtml(b.name||"Ukjent")}</div><div class="booking-period">${formatDate(b.start_date)} → ${formatDate(b.end_date)}</div></div><div class="booking-badges"><span class="badge badge-status">${b.cancelled_at ? "Avbestilt" : statusText(b.status)}</span>${isApproved?`<span class="badge ${paymentClass(payment)}">${paymentText(payment)}</span>`:""}<span class="badge badge-status">Åpne ▾</span></div></div><div class="booking-details"><p><strong>E-post:</strong> <a href="mailto:${escapeHtml(b.email)}" class="contact-link">${escapeHtml(b.email||"-")}</a><br><strong>Telefon:</strong> <a href="tel:${escapeHtml(b.phone)}" class="contact-link">${escapeHtml(b.phone||"-")}</a></p>${b.message?`<div class="customer-message"><strong>Melding fra kunde:</strong><br>${escapeHtml(b.message)}</div>`:""}${overlap?`<div class="warning">⚠️ Dobbelbooking med ${escapeHtml(overlap.name||"en annen forespørsel")}</div>`:""}${isApproved?`<div class="payment-box"><strong>Betaling:</strong> <span class="badge ${paymentClass(payment)}">${paymentText(payment)}</span>${paidDate?` <span class="archive-note">registrert ${paidDate}</span>`:""}${b.invoice_url?`<br><a class="invoice-link" href="${escapeHtml(b.invoice_url)}" target="_blank">Åpne faktura</a>`:""}<div class="payment-actions">${payment!=="paid"?`<button class="btn-success" onclick='setPaymentStatus(${JSON.stringify(String(b.id))},"paid")'>Marker som betalt</button>`:""}${payment!=="partial"?`<button class="btn-neutral" onclick='setPaymentStatus(${JSON.stringify(String(b.id))},"partial")'>Delvis betalt</button>`:""}${payment!=="unpaid"?`<button class="btn-neutral" onclick='setPaymentStatus(${JSON.stringify(String(b.id))},"unpaid")'>Marker ubetalt</button>`:""}</div></div>`:""}<div class="conversation"><strong>Samtale</strong>${renderMessages(messages)}</div><div style="margin:12px 0 10px;"><textarea id="reply-${b.id}" rows="3" placeholder="Skriv svar til kunden her..." style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;resize:vertical;box-sizing:border-box"></textarea><div style="margin-top:10px;"><label style="display:block;margin-bottom:6px;font-weight:600;">Legg ved faktura (PDF)</label><input type="file" id="invoice-${b.id}" accept=".pdf,application/pdf" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:white;box-sizing:border-box"></div><div class="booking-actions"><button class="btn-primary" onclick='sendReply(${JSON.stringify(String(b.id))},${escapeHtml(JSON.stringify(b.email||""))},${escapeHtml(JSON.stringify(b.name||""))})'>Send svar til kunde</button>${b.status!=="approved"&&!b.cancelled_at?`<button class="btn-success" onclick='approve(${JSON.stringify(String(b.id))})'>Godkjenn</button>`:""}${b.status!=="rejected"&&b.status!=="approved"?`<button class="btn-danger" onclick='reject(${JSON.stringify(String(b.id))})'>Avslå</button>`:""}</div></div></div>`;
  if (typeof addBookingManagement === "function") addBookingManagement(div, b);
  return div;
}

async function renderDashboard() {
  setupDashboardShell(); renderSummary();
  const searchTerm=(document.getElementById("search")?.value||"").toLowerCase().trim(), today=todayString();
  const foresp=document.getElementById("foresporsler"), kommende=document.getElementById("godkjente"), tidligere=document.getElementById("tidligere"), avsl=document.getElementById("avslatte"); if(!foresp||!kommende||!tidligere||!avsl)return;
  foresp.innerHTML=kommende.innerHTML=tidligere.innerHTML=avsl.innerHTML="";
  const groups={pending:[],upcoming:[],past:[],rejected:[]}; let firstMatch=null;
  for(const b of allBookings){const matches=!searchTerm||(b.name||"").toLowerCase().includes(searchTerm)||(b.email||"").toLowerCase().includes(searchTerm)||(b.phone||"").toLowerCase().includes(searchTerm);if(!matches)continue;if(!firstMatch)firstMatch=b;if(b.status==="rejected")groups.rejected.push(b);else if(b.status!=="approved")groups.pending.push(b);else if(b.end_date<today)groups.past.push(b);else groups.upcoming.push(b);}
  const configs=[[groups.pending,foresp],[groups.upcoming,kommende],[groups.past,tidligere],[groups.rejected,avsl]];
  for(const [items,container] of configs){if(!items.length){container.innerHTML='<div class="empty-state">Ingen bookinger her.</div>';continue;}for(const b of items)container.appendChild(await renderBookingCard(b));}
  const p=document.querySelector("[onclick=\"toggle('foresporsler')\"]"),g=document.querySelector("[onclick=\"toggle('godkjente')\"]"),a=document.querySelector("[onclick=\"toggle('avslatte')\"]"),t=document.getElementById("tidligereHeading");
  if(p)p.innerHTML=`📩 Forespørsler <span class="section-count">(${groups.pending.length})</span>`; if(g)g.innerHTML=`🏡 Kommende bookinger <span class="section-count">(${groups.upcoming.length})</span>`; if(t)t.innerHTML=`🗂️ Tidligere bookinger <span class="section-count">(${groups.past.length})</span>`; if(a)a.innerHTML=`❌ Avslåtte / avbestilte <span class="section-count">(${groups.rejected.length})</span>`;
  if(firstMatch&&searchTerm&&!firstMatch.cancelled_at)highlightBookingInCalendar(firstMatch);else{selectedBooking=null;loadCalendar();}
}

async function setPaymentStatus(id,status) {
  const label=paymentText(status); if(!confirm(`Endre betalingsstatus til «${label}»?`))return;
  const update={payment_status:status,paid_at:status==="paid"?new Date().toISOString():null};
  const {error}=await supabaseClient.from("bookings").update(update).eq("id",id); if(error)return alert("Kunne ikke oppdatere betaling: "+error.message);
  await loadData();
}

function checkOverlap(booking) { for(const b of allBookings){if(String(b.id)===String(booking.id)||b.status!=="pending")continue;if(!(booking.end_date<=b.start_date||booking.start_date>=b.end_date))return b;}return null; }
function highlightBookingInCalendar(booking){selectedBooking=booking;const d=new Date(booking.start_date);currentDate.setFullYear(d.getFullYear());currentDate.setMonth(d.getMonth());loadCalendar();}

async function sendReply(bookingId,customerEmail,customerName) {
  const textarea=document.getElementById(`reply-${bookingId}`),message=textarea?.value.trim(); if(!message)return alert("Skriv en melding før du sender."); if(!bookingId)return alert("Mangler booking-ID. Last siden på nytt og prøv igjen."); if(!confirm(`Vil du sende dette svaret til ${customerName}?`))return;
  const replyUrl=`${location.origin}/reply.html?booking=${encodeURIComponent(bookingId)}`;
  try {
    const invoiceInput=document.getElementById(`invoice-${bookingId}`);
    const hasInvoice=!!invoiceInput?.files?.[0];
    let invoiceUrl=null;
    if(hasInvoice){invoiceUrl=await uploadInvoiceFile(bookingId);if(!invoiceUrl)throw new Error("Fakturaen kunne ikke lastes opp.");const {error:invoiceError}=await supabaseClient.from("bookings").update({invoice_url:invoiceUrl}).eq("id",bookingId);if(invoiceError)throw invoiceError;}
    const {error:messageError}=await supabaseClient.from("booking_messages").insert({booking_id:bookingId,sender:"admin",message});if(messageError)throw messageError;
    const response=await fetch(`${supabaseUrl}/functions/v1/resend-email`,{method:"POST",headers:await window.adminHeaders(),body:JSON.stringify({type:"admin_reply",name:customerName,email:customerEmail,message,bookingId,replyUrl,invoiceUrl})});
    if(!response.ok)throw new Error("E-posten kunne ikke sendes");textarea.value="";if(invoiceInput)invoiceInput.value="";alert(hasInvoice?"✅ Svar og faktura sendt til kunden!":"✅ Svar sendt og lagret i samtalen!");await loadData();
  }catch(err){console.error(err);alert("Kunne ikke sende svaret: "+(err.message||err));}
}

async function approve(id) {
  const b=allBookings.find(x=>String(x.id)===String(id));if(!b||b.cancelled_at)return;const overlap=checkOverlap(b);if(overlap)return alert(`❌ Dobbelbooking!\nOverlapper med ${overlap.name||"en annen booking"}`);if(!confirm(`Vil du godkjenne bookingen til ${b.name}?`))return;
  let pdfUrl=null;try{pdfUrl=await uploadInvoiceFile(id);}catch(e){console.error(e);}const {error}=await supabaseClient.from("bookings").update({status:"approved",invoice_url:pdfUrl||b.invoice_url||null,payment_status:b.payment_status||"unpaid"}).eq("id",id);if(error)return alert("Kunne ikke godkjenne: "+error.message);
  await fetch(`${supabaseUrl}/functions/v1/resend-email`,{method:"POST",headers:await window.adminHeaders(),body:JSON.stringify({type:"approved",name:b.name,email:b.email,phone:b.phone||"",start:b.start_date,end:b.end_date,invoiceUrl:pdfUrl||b.invoice_url||null,bookingId:String(b.id),replyUrl:`${location.origin}/reply.html?booking=${encodeURIComponent(String(b.id))}`})});alert("✅ Booking godkjent!");await loadData();
}
async function reject(id){const booking=allBookings.find(b=>String(b.id)===String(id));if(!booking||booking.cancelled_at)return;if(booking.status==="approved")return cancelBooking(booking);if(!confirm("Er du sikker på at du vil avslå denne forespørselen?"))return;const{error}=await supabaseClient.from("bookings").update({status:"rejected"}).eq("id",id);if(error)alert("Feil ved avslåing");else alert("✅ Booking avslått");await loadData();}

function changeMonth(dir){currentDate.setMonth(currentDate.getMonth()+dir);loadCalendar();}
function loadCalendar(){const calendar=document.getElementById("calendar");if(!calendar)return;calendar.innerHTML="";const year=currentDate.getFullYear(),month=currentDate.getMonth();const title=document.getElementById("monthTitle");if(title)title.innerText=currentDate.toLocaleString("no-NO",{month:"long",year:"numeric"});const days=new Date(year,month+1,0).getDate();for(let i=1;i<=days;i++){const dateStr=year+"-"+String(month+1).padStart(2,"0")+"-"+String(i).padStart(2,"0");const div=document.createElement("div");div.classList.add("day");const content=document.createElement("div");content.className="day-content";const number=document.createElement("div");number.className="day-number";number.textContent=i;content.appendChild(number);let dayBookings=[],isFullyBooked=false,isStart=false,isEnd=false;approvedBookings.forEach(b=>{let relevant=false;if(dateStr===b.start_date&&dateStr===b.end_date)isFullyBooked=relevant=true;else if(dateStr===b.start_date)isStart=relevant=true;else if(dateStr===b.end_date)isEnd=relevant=true;else if(dateStr>b.start_date&&dateStr<b.end_date)isFullyBooked=relevant=true;if(relevant)dayBookings.push({name:(b.name||"Ukjent").trim(),email:b.email||"-",phone:b.phone||"-",start:b.start_date,end:b.end_date});});if(dayBookings.length){const n=document.createElement("div");n.className="day-name";n.textContent=[...new Set(dayBookings.map(b=>b.name))].join(", ");content.appendChild(n);}if(isFullyBooked||(isStart&&isEnd))div.classList.add("booked");else if(isStart)div.classList.add("half-start");else if(isEnd)div.classList.add("half-end");if(selectedBooking&&dateStr>=selectedBooking.start_date&&dateStr<=selectedBooking.end_date)div.classList.add("highlight");if(dayBookings.length){div.style.cursor="pointer";div.addEventListener("click",()=>showDayInfo(dateStr,dayBookings));}div.appendChild(content);calendar.appendChild(div);}}
function showDayInfo(dateStr,bookings){let html=`<h3>${escapeHtml(dateStr)}</h3><hr>`;bookings.forEach(b=>{html+=`<strong>${escapeHtml(b.name)}</strong><br>E-post: ${escapeHtml(b.email)}<br>Telefon: ${escapeHtml(b.phone)}<br>Periode: ${escapeHtml(b.start)} → ${escapeHtml(b.end)}<br><br>`;});const popup=document.createElement("div");popup.style.cssText="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:25px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:10000;max-width:420px";popup.innerHTML=html;const close=document.createElement("button");close.textContent="Lukk";close.onclick=()=>popup.remove();popup.appendChild(close);document.body.appendChild(popup);}

setupDashboardShell();
if(document.getElementById("foresporsler"))window.adminReady.then(user=>{if(user)loadData();});

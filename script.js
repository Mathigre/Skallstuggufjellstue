// =========================
// SUPABASE
// =========================
const supabaseUrl = "https://rbphgvnwmzjeuvyrasvy.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

const publicApi=async body=>{const r=await fetch(supabaseUrl+'/functions/v1/booking-public',{method:'POST',headers:{apikey:supabaseAnonKey,Authorization:'Bearer '+supabaseAnonKey,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Forespørselen feilet.');return data;};
const messageBox=document.getElementById('messageBox');
function focusBookingMessage(){
 messageBox.tabIndex=-1;
 messageBox.focus({preventScroll:true});
 const header=document.querySelector('header');
 messageBox.style.scrollMarginTop=((header?.getBoundingClientRect().height||0)+24)+'px';
 messageBox.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function showError(message){messageBox.className='message-error';messageBox.textContent=message;messageBox.style.display='block';}
let submitting=false;
document.getElementById('bookingForm').addEventListener('submit',async event=>{
 event.preventDefault();if(submitting)return;submitting=true;const button=event.target.querySelector('button[type="submit"]');button.disabled=true;
 try{
  const q=window.getBookingQuote();
  const value=id=>document.getElementById(id).value.trim();
  const result=await publicApi({action:'create',booking:{name:value('name'),email:value('email'),phone:value('phone'),start_date:value('start'),end_date:value('end'),message:value('customerMessage'),linen_count:q.linenCount,towel_count:q.towelCount,full_cleaning:q.cleaning,pricing_revision:q.pricingRevision}});
  messageBox.className='message-success';messageBox.style.display='block';messageBox.replaceChildren();
  const text=document.createElement('p');text.textContent=result.emailsSent?'Takk! Forespørselen er registrert. Du får en privat bookinglenke på e-post.':'Forespørselen er registrert, men e-post kunne ikke sendes. Ta vare på den private lenken under, eller kontakt oss på 906 88 873.';
  const link=document.createElement('a');link.href=result.replyUrl;link.textContent='Åpne din booking og samtale';messageBox.append(text,link);event.target.reset();
  focusBookingMessage();
 }catch(error){showError(error.message);focusBookingMessage();}finally{submitting=false;button.disabled=false;}
});
function checkMyBookings(){const result=document.getElementById('myBookingsResult');try{const url=new URL(document.getElementById('checkEmail').value.trim());const token=new URLSearchParams(url.hash.slice(1)).get('token');if(url.origin!==location.origin||url.pathname!=='/reply.html'||!/^[a-f0-9]{64}$/.test(token||''))throw new Error();location.href='reply.html#token='+token;}catch{result.textContent='Lim inn den private bookinglenken fra e-posten. Har du bare en eldre lenke, kontakt Skallstuggu for en ny.';}}

let currentDate = new Date();
let approvedBookings = [];

async function loadCalendarBooking() {
  try { const {dates}=await publicApi({action:'calendar'}); approvedBookings=dates; }
  catch(error){showError('Kalenderen kunne ikke lastes. Prøv å laste siden på nytt.');return;}
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

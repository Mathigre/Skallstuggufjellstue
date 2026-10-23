(() => {
 const form=document.getElementById('contactForm');if(!form)return;
 const status=document.getElementById('contactStatus'),button=form.querySelector('button[type="submit"]');
 let requestId=crypto.randomUUID(),sending=false;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(sending||!form.reportValidity())return;
  const data=new FormData(form);sending=true;button.disabled=true;status.textContent='Sender spørsmålet …';
  try{
   const r=await fetch('https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/mail-center',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'contact',request_id:requestId,name:data.get('name'),email:data.get('email'),phone:data.get('phone'),question:data.get('question'),website:data.get('website')}),signal:AbortSignal.timeout(25000)});
   const result=await r.json();if(!r.ok||!result.success)throw new Error(result.error||'Kunne ikke sende meldingen.');
   status.textContent='Takk! Spørsmålet er mottatt. Vi svarer på dagtid så snart vi har anledning. Referanse: '+result.reference.slice(0,8)+'.';
   form.reset();requestId=crypto.randomUUID();
  }catch(error){status.textContent=(error.name==='TimeoutError'?'Vi fikk ikke bekreftet mottaket. Prøv igjen; samme melding blir ikke registrert to ganger.':error.message||'Kunne ikke sende meldingen.')+' Du kan også ringe 906 88 873.';}
  finally{sending=false;button.disabled=false;}
 });
})();

(() => {
 const base='https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/mail-center';
 const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const format=value=>value?new Intl.DateTimeFormat('nb-NO',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'';
 let filter='unanswered',offset=0,total=0,selected=null,loading=false,searchTimer,threadGeneration=0,messagesOffset=0;
 const drafts=new Map();
 const categoryNames={customer:'Kundehenvendelser',newsletter:'Nyhetsbrev/reklame',review:'Må vurderes'};
 async function api(body){const r=await fetch(base,{method:'POST',headers:await window.adminHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Kunne ikke hente mail.');return data;}
 const feedback=text=>{$('mailFeedback').textContent=text;};
 function remember(){const text=$('replyText');if(selected&&text)drafts.set(selected,{text:text.value,requestId:text.dataset.requestId});}
 async function loadList(){
  if(loading)return;loading=true;
  try{
   const data=await api({action:'list',category:$('mailCategory').value,filter,offset,search:$('mailSearch').value});total=data.total;
   document.querySelectorAll('[data-filter]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.filter===filter));button.querySelector('span').textContent=data.counts[button.dataset.filter]||0;});
   $('threadList').replaceChildren();
   for(const thread of data.threads){const button=document.createElement('button');button.type='button';button.dataset.threadId=thread.id;button.className='thread-row'+(thread.unread?' unread':'')+(thread.id===selected?' selected':'');button.innerHTML=`<span class="thread-name">${escape(thread.contact_name||thread.contact_email)} <small>${escape(format(thread.last_message_at))}</small></span><span class="thread-subject">${escape(thread.subject)}</span><span class="thread-preview">${escape(categoryNames[thread.category]||'Må vurderes')} · ${thread.source==='contact'?'Kontaktskjema · ':''}${escape(thread.preview)}</span>`;button.addEventListener('click',()=>openThread(thread.id));$('threadList').append(button);}
   if(!data.threads.length)$('threadList').innerHTML='<div class="mail-empty">Ingen henvendelser i denne visningen.</div>';
   $('previousPage').disabled=offset===0;$('nextPage').disabled=offset+40>=total;$('pageInfo').textContent=total?`${offset+1}–${Math.min(offset+40,total)} av ${total}`:'0 samtaler';
  }catch(e){feedback(e.message);}finally{loading=false;}
 }
 async function openThread(id,older=false){
  remember();const generation=++threadGeneration;if(!older){selected=id;messagesOffset=0;}else messagesOffset+=100;
  try{
   const data=await api({action:'thread',thread_id:id,offset:messagesOffset});if(generation!==threadGeneration)return;
   const thread=data.thread;const draft=drafts.get(id)||{text:'',requestId:crypto.randomUUID()};
   const gmail=thread.gmail_thread_id?'https://mail.google.com/mail/u/?authuser=minsten.mg%40gmail.com#all/'+encodeURIComponent(thread.gmail_thread_id):null;
   const contents=data.messages.map(message=>{const state={queued:'Venter på sending',sending:'Sender',sent:'Sendt',failed:'Sending mislyktes – ikke markert som besvart',uncertain:'Sending må kontrolleres'}[message.delivery_state]||'';return `<article class="mail-message ${escape(message.direction)}"><header><strong>${message.direction==='outgoing'?'Skallstuggu':message.direction==='notification'?'Systemvarsel':escape(message.sender_name||message.sender_email)}</strong><span>${escape(format(message.received_at))}</span></header><pre>${escape(message.body)}</pre>${message.attachments?.length?`<div class="mail-attachments">Vedlegg: ${message.attachments.map(a=>escape(a.filename)).join(', ')}. ${gmail?`<a href="${escape(gmail)}" target="_blank" rel="noopener">Åpne vedlegg i Gmail</a>`:'Se originalen i e-posten.'}</div>`:''}${state?`<p class="mail-delivery">${state}</p>`:''}${message.delivery_state==='failed'?`<button type="button" data-retry="${escape(message.id)}">Prøv sending på nytt</button>`:''}</article>`;}).join('');
   $('conversation').innerHTML=`<div class="conversation-heading"><button type="button" id="backToInbox" class="mail-back">← Innboks</button><h2>${escape(thread.subject)}</h2><p><strong>${escape(thread.contact_name)}</strong></p><p>E-post: ${escape(thread.contact_email)}</p>${thread.contact_phone?`<p>Telefon: <a href="tel:${escape(thread.contact_phone.replace(/[^+0-9]/g,''))}">${escape(thread.contact_phone)}</a></p>`:''}<p>Innboks: <strong>${escape(categoryNames[thread.category]||'Må vurderes')}</strong><br><small>${escape(thread.category_reason)}</small></p><label>Flytt til <select id="moveCategory">${Object.entries(categoryNames).map(([value,label])=>`<option value="${value}" ${thread.category===value?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" id="saveCategory">Lagre plassering</button><div class="mail-actions"><button type="button" id="markUnread">Marker ulest</button>${gmail?`<a href="${escape(gmail)}" target="_blank" rel="noopener">Åpne i Gmail</a>`:''}</div></div><div class="mail-messages">${data.has_more?'<button id="olderMessages" type="button">Vis eldre meldinger</button>':''}${older?'<p>Eldre del av samtalen. Velg samtalen på nytt for de nyeste meldingene.</p>':''}${contents}</div><form class="mail-reply" id="replyForm"><label for="replyText">Svar på henvendelsen</label><textarea id="replyText" maxlength="20000" required placeholder="Skriv svaret ditt …"></textarea><p class="mail-delivery">Svaret sendes til ${escape(thread.contact_email)}.</p><button type="submit">Send svar</button><button type="button" id="refreshConversation">Oppdater samtalen</button><p id="replyStatus" role="status" aria-live="polite"></p></form>`;
   document.body.classList.add('mail-thread-open');
   $('backToInbox').onclick=()=>{remember();++threadGeneration;document.body.classList.remove('mail-thread-open');const row=Array.from(document.querySelectorAll('[data-thread-id]')).find(button=>button.dataset.threadId===id);row?.focus();$('mailCategory').scrollIntoView({block:'start'});};
   if(!older&&matchMedia('(max-width:850px)').matches)$('conversation').scrollIntoView({block:'start'});
   $('replyText').value=draft.text;$('replyText').dataset.requestId=draft.requestId;
   document.querySelectorAll('[data-retry]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api({action:'retry',thread_id:id,message_id:button.dataset.retry});await openThread(id);}catch(e){feedback(e.message);button.disabled=false;}});
   $('saveCategory').onclick=async()=>{try{await api({action:'categorize',thread_id:id,category:$('moveCategory').value});await openThread(id);feedback('Plasseringen er lagret og beholdes ved nye svar i samtalen.');}catch(e){feedback(e.message);}};
   $('markUnread').onclick=async()=>{try{await api({action:'unread',thread_id:id});await loadList();feedback('Samtalen er markert som ulest.');}catch(e){feedback(e.message);}};
   if($('olderMessages'))$('olderMessages').onclick=()=>openThread(id,true);
   $('refreshConversation').onclick=()=>openThread(id);
   $('replyForm').onsubmit=async event=>{
    event.preventDefault();const textarea=$('replyText'),text=textarea.value.trim();if(!text)return;
    const button=event.target.querySelector('button[type=submit]');button.disabled=true;
    try{
     const result=await api({action:'reply',thread_id:id,request_id:textarea.dataset.requestId,message:text});
     drafts.delete(id);textarea.value='';textarea.dataset.requestId=crypto.randomUUID();
     const status=$('replyStatus');
     const show=state=>{status.textContent=state==='sent'?'Sendt – e-posttjenesten har tatt imot svaret.':state==='failed'?'Sendingen mislyktes. Oppdater samtalen for å prøve på nytt.':state==='uncertain'?'Sendestatus må kontrolleres før du sender på nytt.':'Svaret er lagret. Venter på bekreftelse fra e-posttjenesten …';};
     show(result.delivery_state);
     if(result.delivery_state==='sent'){await openThread(id);if(selected===id)$('replyStatus').textContent='Sendt – e-posttjenesten har tatt imot svaret.';}
     else if(result.message_id){
      const watch=async()=>{
       for(let attempt=0;attempt<20;attempt++){
        await new Promise(resolve=>setTimeout(resolve,3000));
        if(selected!==id||!status.isConnected)return;
        try{const delivery=await api({action:'delivery',thread_id:id,message_id:result.message_id});show(delivery.delivery_state);
         if(['sent','failed','uncertain'].includes(delivery.delivery_state)){
          if(!$('replyText').value){await openThread(id);if(selected===id)$('replyStatus').textContent=status.textContent;}return;
         }
        }catch{status.textContent='Svaret er lagret, men sendestatus kunne ikke hentes. Ikke send samme svar på nytt.';return;}
       }
       if(status.isConnected)status.textContent='Svaret venter fortsatt i sendekø. Sending prøves automatisk igjen; ikke send samme svar på nytt.';
      };watch();
     }
    }catch(e){$('replyStatus').textContent=e.message;}finally{button.disabled=false;}

   };
   await loadList();
  }catch(e){feedback(e.message);}
 }
 async function loadStatus(){
  try{
   const data=await api({action:'status'}),c=data.connection;
   $('redirectUri').textContent=data.redirect_uri;$('connectGmail').disabled=!data.oauth_configured;$('connectGmail').textContent=c.enabled?'Koble Gmail til på nytt':'Koble til Gmail';$('syncGmail').disabled=!c.enabled;
   const stale=c.last_sync_at&&Date.now()-Date.parse(c.last_sync_at)>5*60000;
   let text=!c.enabled?'Gmail er ikke koblet til. Kontaktskjemaet virker, men direkte e-post til Gmail importeres ikke ennå.':c.last_error?'Gmail-synkronisering trenger oppfølging. Kontroller tilkoblingen; e-postene er fortsatt i Gmail.':!c.backfill_complete?'Gmail er koblet til. Starter synkronisering av nye meldinger.':'Gmail er koblet til. Henter bare nye meldinger; gammel historikk importeres ikke.';
   if(c.last_sync_at)text+=' Sist synkronisert: '+format(c.last_sync_at)+'.';if(stale)text+=' Synkroniseringen er forsinket.';if(data.pending_jobs)text+=` ${data.pending_jobs} sendinger/varsler venter.`;const deliveryStale=data.oldest_pending_at&&Date.now()-Date.parse(data.oldest_pending_at)>5*60000;if(deliveryStale)text+=' Sendekøen er forsinket og bør kontrolleres.';if(data.failed_jobs)text+=` ${data.failed_jobs} sendinger/varsler krever oppfølging.`;
   $('connectionBrief').textContent=!c.enabled?'Ikke tilkoblet':c.last_error||stale||deliveryStale||data.failed_jobs?'Trenger oppfølging':'Gmail tilkoblet';
   $('mailSettings').dataset.state=!c.enabled||c.last_error||stale||deliveryStale||data.failed_jobs?'warning':'ok';
   $('connectionStatus').textContent=text;document.querySelector('.mail-connection').dataset.state=!c.enabled||c.last_error||stale||deliveryStale||data.failed_jobs?'warning':'ok';
   if(!data.oauth_configured)$('setupGuide').open=true;
  }catch(e){feedback(e.message);}
 }
 (async()=>{
  if(!await window.adminReady)return;
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;offset=0;loadList();});
  $('mailCategory').onchange=()=>{offset=0;loadList();};
  $('mailSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;loadList();},300);};
  $('previousPage').onclick=()=>{offset=Math.max(0,offset-40);loadList();};$('nextPage').onclick=()=>{offset+=40;loadList();};
  $('refreshMail').onclick=()=>{loadList();loadStatus();};
  $('syncGmail').onclick=async()=>{try{await api({action:'sync'});feedback('Synkronisering er startet. Oversikten oppdateres snart.');}catch(e){feedback(e.message);}};
  $('connectGmail').onclick=async()=>{try{const result=await api({action:'connect'});const u=new URL(result.url);if(u.origin!=='https://accounts.google.com')throw Error('Ugyldig Google-adresse.');location.assign(u.href);}catch(e){feedback(e.message);}};
  const params=new URLSearchParams(location.search);if(params.get('gmail')==='failed')feedback('Gmail ble ikke koblet til. Kontroller at du bruker minsten.mg@gmail.com og at oppsettet er riktig.');
  await Promise.all([loadList(),loadStatus()]);const thread=params.get('thread');if(/^[0-9a-f-]{36}$/i.test(thread||''))openThread(thread);
  setInterval(()=>{if(!document.hidden){loadList();loadStatus();}},30000);
 })();
})();

(async()=>{
 if(!await window.adminReady)return;
 const panel=document.createElement('section');panel.className='push-panel';panel.setAttribute('aria-label','Varsler på denne enheten');
 panel.innerHTML='<div><strong>Varsler på denne enheten</strong><p id="pushStatus" role="status">Sjekker støtte for varsler …</p></div><div class="push-actions"><button type="button" id="pushEnable" disabled>Aktiver varsler</button><button type="button" id="pushDisable" hidden>Deaktiver</button></div>';
 const header=document.querySelector('.admin-site-header');if(header)header.after(panel);else document.body.prepend(panel);
 const status=panel.querySelector('#pushStatus'),enable=panel.querySelector('#pushEnable'),disable=panel.querySelector('#pushDisable');
 const api=async body=>{const r=await fetch('https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/admin-push',{method:'POST',headers:await window.adminHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Kunne ikke endre varsling.');return data;};
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 if(ios&&!standalone){status.textContent='På iPhone: Legg admin til på Hjem-skjermen via Del-menyen. Åpne ikonet og aktiver varsler der (iOS 16.4 eller nyere).';return;}
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){status.textContent='Denne nettleseren støtter ikke pushvarsler. Prøv en oppdatert nettleser eller åpne admin fra hjemskjermen.';return;}
 let registration,publicKey;
 const active=value=>{enable.hidden=value;disable.hidden=!value;enable.disabled=false;};
 const busy=value=>{[enable,disable].forEach(button=>button.disabled=value);};
 const error=e=>{status.textContent=e.message||'Kunne ikke aktivere varsler.';};
 window.disableAdminPush=async()=>{
  const sub=await registration?.pushManager.getSubscription();
  if(sub){let serverError;try{await api({action:'unsubscribe',endpoint:sub.endpoint});}catch(e){serverError=e;}const removed=await sub.unsubscribe();if(!removed&&serverError)throw serverError;}
  active(false);status.textContent='Varsler er deaktivert på denne enheten.';
 };
 try{
  registration=await navigator.serviceWorker.register('/admin/push-sw.js',{scope:'/admin/'});
  await navigator.serviceWorker.ready;
  publicKey=(await api({action:'config'})).publicKey;
  const sub=await registration.pushManager.getSubscription();
  if(sub&&Notification.permission==='granted'){
   await api({action:'subscribe',subscription:sub.toJSON()});active(true);status.textContent='Aktivert for nye bookingforespørsler og meldinger fra gjester.';
  }else{active(false);status.textContent=Notification.permission==='denied'?'Varsler er blokkert. Tillat varsler for Skallstuggu i telefonens eller nettleserens innstillinger, og åpne siden på nytt.':'Få beskjed om nye forespørsler og kundemeldinger, også når admin er lukket.';}
 }catch(e){error(e);enable.disabled=true;return;}
 enable.addEventListener('click',async()=>{
  busy(true);
  try{
   const permission=await Notification.requestPermission();
   if(permission!=='granted')throw new Error('Varsler ble ikke tillatt. Du kan endre dette i telefonens eller nettleserens varslingsinnstillinger.');
   const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   const sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
   try{await api({action:'subscribe',subscription:sub.toJSON()});}catch(e){await sub.unsubscribe();throw e;}
   active(true);status.textContent='Varsler er aktivert for nye bookingforespørsler og meldinger fra gjester.';
  }catch(e){error(e);}finally{busy(false);}
 });
 disable.addEventListener('click',async()=>{busy(true);try{await window.disableAdminPush();}catch(e){error(e);}finally{busy(false);}});
})();

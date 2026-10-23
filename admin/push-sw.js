self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const bookingId=idPattern.test(data.bookingId||'')?data.bookingId:null;
 const threadId=idPattern.test(data.threadId||'')?data.threadId:null;
 event.waitUntil(self.registration.showNotification(data.title||'Skallstuggu Admin',{body:data.body||'Du har en ny oppdatering i admin.',icon:'/images/Logo.png',tag:data.tag||'skallstuggu-admin',data:{bookingId,threadId}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const id=event.notification.data?.bookingId;
 const thread=event.notification.data?.threadId;
 const url=new URL(idPattern.test(thread||'')?'/admin/mail.html':'/admin/admin.html',self.location.origin);
 if(idPattern.test(thread||''))url.searchParams.set('thread',thread);
 if(idPattern.test(id||''))url.searchParams.set('booking',id);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){const current=new URL(client.url);if(current.origin===url.origin&&current.pathname.startsWith('/admin/')){await client.navigate(url.href);return client.focus();}}
  return self.clients.openWindow(url.href);
 })());
});

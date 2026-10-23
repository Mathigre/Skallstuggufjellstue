const { chromium }=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1365,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const thread={id:'a71e91b0-b91b-4bbc-b0cd-aad8bd2e4a4b',source:'contact',contact_name:'Kari Hansen',contact_email:'kari@example.test',contact_phone:'99988777',subject:'Spørsmål om familieselskap',preview:'Kan vi leie hytta?',last_incoming_at:'2026-10-23T10:00:00Z',last_message_at:'2026-10-23T10:00:00Z',unread:true};
 let contact,reply,read=0;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/admin/auth.js'){await route.fulfill({contentType:'text/javascript',body:`window.adminReady=Promise.resolve({id:'admin'});window.adminHeaders=async()=>({'Content-Type':'application/json'});window.logoutAdmin=()=>{};document.addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('admin-authorized');document.getElementById('adminContent').style.display='block';});`});return;}
  if(url.hostname==='rbphgvnwmzjeuvyrasvy.supabase.co'&&url.pathname.endsWith('/mail-center')){
   if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}});return;}
   const body=request.postDataJSON();let data;
   if(body.action==='status')data={connection:{enabled:false,backfill_complete:false},failed_jobs:0,test_mode:true,oauth_configured:false,redirect_uri:'https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/mail-center/oauth/callback'};
   if(body.action==='list')data={threads:[thread],counts:{all:1,new:1,unanswered:1,answered:0},total:1};
   if(body.action==='thread'){read++;data={thread,messages:[{direction:'incoming',sender_name:'Kari Hansen',body:'Kan vi leie hytta? <script>bad()</script>',received_at:thread.last_incoming_at,attachments:[]}],has_more:false};}
   if(body.action==='reply'){reply=body;data={queued:true};}
   if(body.action==='contact'){contact=body;data={success:true,reference:body.request_id};}
   await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(data||{})});return;
  }
  if(url.hostname!=='127.0.0.1'){await route.abort();return;}
  await route.continue();
 });
 await page.goto('http://127.0.0.1:8123/admin/mail.html');
 await page.getByRole('button',{name:/Kari Hansen/}).click();
 await page.getByLabel('Svar på henvendelsen').fill('Takk for spørsmålet. Dette er et prøvesvar.');
 await page.getByRole('button',{name:'Send prøvesvar'}).click();
 await page.getByText('Svaret er lagret og lagt i sendekø.',{exact:false}).waitFor();
 assert.match(reply.message,/prøvesvar/);assert.equal(read,1);assert.equal(await page.locator('script').filter({hasText:'bad()'}).count(),0);
 await page.screenshot({path:'/workspace/mail-admin-preview.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto('http://127.0.0.1:8123/kontakt.html');
 await page.getByLabel('Fullt navn',{exact:true}).fill('Kari Hansen');await page.getByLabel('E-postadresse',{exact:true}).fill('kari@example.test');await page.getByLabel('Telefonnummer',{exact:true}).fill('99988777');await page.getByLabel('Spørsmålet ditt',{exact:true}).fill('Kan vi leie hytta til familieselskap?');
 await page.getByRole('button',{name:'Send spørsmål',exact:true}).click();await page.getByText('Takk! Spørsmålet er mottatt.',{exact:false}).waitFor();
 assert.equal(contact.name,'Kari Hansen');assert.equal(contact.phone,'99988777');assert.ok(contact.request_id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/workspace/mail-contact-mobile-preview.png',fullPage:true});
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: admin inbox, safe message rendering, queued reply and mobile contact form with simulated API; no emails sent.');
})().catch(e=>{console.error(e);process.exit(1);});

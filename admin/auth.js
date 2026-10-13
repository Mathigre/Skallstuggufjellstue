(() => {
  const url='https://rbphgvnwmzjeuvyrasvy.supabase.co';
  const key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";
  const client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  window.adminClient=client;
  let redirecting=false;
  const goLogin=()=>{if(!redirecting){redirecting=true;location.replace('login.html'+(/^([0-9a-f-]{36})$/i.test(new URLSearchParams(location.search).get('booking')||'')?'?booking='+encodeURIComponent(new URLSearchParams(location.search).get('booking')):''));}};
  localStorage.removeItem('adminLoggedIn');localStorage.removeItem('skallstugguFikenTestAccess');
  window.adminHeaders=async()=>{const {data,error}=await client.auth.getSession();if(error||!data.session)throw new Error('Logg inn på nytt.');return {'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+data.session.access_token};};
  window.logoutAdmin=async()=>{try{await window.disableAdminPush?.();}catch{console.warn('Kunne ikke deaktivere varsler.');}await client.auth.signOut();goLogin();};
  const loginPage=location.pathname.endsWith('/login.html');
  window.adminReady=(async()=>{
    if(loginPage)return null;
    const {data,error}=await client.auth.getUser();
    if(error||!data.user){goLogin();return null;}
    const membership=await client.from('admin_users').select('user_id').eq('user_id',data.user.id).maybeSingle();
    if(membership.error||!membership.data){await client.auth.signOut();goLogin();return null;}
    document.documentElement.classList.add('admin-authorized');
    const reveal=()=>{const content=document.getElementById('adminContent');if(content)content.style.display='block';};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal,{once:true});else reveal();
    const installPush=()=>{const css=document.createElement('link');css.rel='stylesheet';css.href='push.css?v=1';document.head.append(css);const script=document.createElement('script');script.src='push.js?v=1';document.head.append(script);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installPush,{once:true});else setTimeout(installPush,0);
    return data.user;
  })();
  client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'&&!loginPage)goLogin();});
})();

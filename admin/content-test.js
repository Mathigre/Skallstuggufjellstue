// Enkel CMS-test for Administrasjon
(function(){
  const SUPABASE_URL="https://rbphgvnwmzjeuvyrasvy.supabase.co";
  const SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicGhndm53bXpqZXV2eXJhc3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjM3MjksImV4cCI6MjA4OTk5OTcyOX0.ug7k4jDtYwudivBJaWyKuCdwbt3GVnLXtWtpsBUhvEQ";
  let client;

  function render(){
    const old=document.querySelector('.coming-soon-box');
    if(!old)return;
    old.innerHTML=`
      <div style="text-align:left;max-width:760px;margin:0 auto">
        <div style="font-size:.82rem;font-weight:800;color:#8B4A2B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Test av innholdsredigering</div>
        <h1 style="margin:0 0 10px">Rediger forsiden</h1>
        <p style="margin:0 0 28px;color:#6a625b">Dette feltet styrer teksten som står under «Skallstuggu» på forsiden.</p>
        <label for="heroSubtitle" style="display:block;font-weight:700;margin-bottom:8px">Tekst under Skallstuggu</label>
        <input id="heroSubtitle" type="text" placeholder="Opplev fjellet på sitt beste" style="width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid #d6cfc6;border-radius:10px;font-size:1rem">
        <div style="margin-top:18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <button id="saveHeroSubtitle" style="border:0;border-radius:10px;background:#2e7d32;color:white;padding:12px 22px;font-weight:700;cursor:pointer">Lagre endring</button>
          <span id="contentStatus" style="font-weight:600;color:#6a625b"></span>
        </div>
        <div style="margin-top:28px;padding:22px;background:#fffaf3;border:1px solid #eadfce;border-radius:14px">
          <div style="font-size:.82rem;font-weight:700;color:#777;margin-bottom:8px">FORHÅNDSVISNING</div>
          <h2 style="color:#8B4A2B;margin:0 0 8px">Skallstuggu</h2>
          <p id="heroPreview" style="margin:0;font-size:1.1rem">Opplev fjellet på sitt beste</p>
        </div>
      </div>`;
    document.getElementById('heroSubtitle').addEventListener('input',e=>document.getElementById('heroPreview').textContent=e.target.value||'Opplev fjellet på sitt beste');
    document.getElementById('saveHeroSubtitle').addEventListener('click',save);
    load();
  }

  async function load(){
    const status=document.getElementById('contentStatus');
    try{
      if(!window.supabase)throw new Error('Supabase-biblioteket mangler');
      client=client||window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
      const {data,error}=await client.from('site_content').select('value').eq('key','hero_subtitle').single();
      if(error)throw error;
      const value=data?.value||'Opplev fjellet på sitt beste';
      document.getElementById('heroSubtitle').value=value;
      document.getElementById('heroPreview').textContent=value;
    }catch(e){console.error(e);status.textContent='Kunne ikke hente teksten.';status.style.color='#c62828'}
  }

  async function save(){
    const input=document.getElementById('heroSubtitle');
    const status=document.getElementById('contentStatus');
    const value=input.value.trim();
    if(!value)return alert('Skriv inn en tekst først.');
    status.textContent='Lagrer…';status.style.color='#6a625b';
    try{
      client=client||window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
      const {error}=await client.from('site_content').upsert({key:'hero_subtitle',value,updated_at:new Date().toISOString()},{onConflict:'key'});
      if(error)throw error;
      status.textContent='✓ Lagret';status.style.color='#2e7d32';
    }catch(e){console.error(e);status.textContent='Kunne ikke lagre';status.style.color='#c62828';alert('Kunne ikke lagre teksten: '+(e.message||e));}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
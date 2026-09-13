// config.js - Admin innstillinger
const ADMIN_CONFIG = {
  password: "1234Test",
  adminTitle: "Booking admin"
};

// Last inn enkel innholdsredigering kun på Administrasjon-siden.
if (window.location.pathname.endsWith('/admin/administrasjon.html') || window.location.pathname.endsWith('/administrasjon.html')) {
  const supabaseScript = document.createElement('script');
  supabaseScript.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  supabaseScript.onload = () => {
    const cmsScript = document.createElement('script');
    cmsScript.src = 'content-test.js?v=20260913-1';
    document.body.appendChild(cmsScript);
  };
  document.body.appendChild(supabaseScript);
}
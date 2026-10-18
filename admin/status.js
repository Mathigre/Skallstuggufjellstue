const $ = id => document.getElementById(id);
const supabaseUrl = 'https://rbphgvnwmzjeuvyrasvy.supabase.co';
let running = false;

function setResult(id, state, label, message) {
  const row = $(id);
  if (!row) return;
  row.dataset.state = state;
  row.querySelector('.status-label').textContent = label;
  row.querySelector('p').textContent = message;
}

async function checkAdmin() {
  const user = await window.adminReady;
  if (!user) throw new Error('Administratortilgang mangler. Logg inn på nytt.');
  const { data, error } = await window.adminClient.auth.getUser();
  if (error || !data?.user?.id) throw new Error('Innloggingen kunne ikke bekreftes. Logg inn på nytt.');
  return 'Innlogging og administratortilgang er bekreftet.';
}

async function checkServices() {
  const headers = await window.adminHeaders();
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-health`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'check' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Admininnloggingen må fornyes. Logg inn på nytt.');
    throw new Error(`Statuskontrollen svarte med HTTP ${response.status}. Kontroller at funksjonen er distribuert.`);
  }
  const result = await response.json();
  if (!result.checks) throw new Error('Statuskontrollen svarte med uventede data.');
  return result.checks;
}

async function checkPush() {
  const manage = $('pushManage');
  if (manage) manage.hidden = true;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { state: 'warning', label: 'Støttes ikke', message: 'Denne nettleseren støtter ikke webvarsler.' };
  }
  if (Notification.permission !== 'granted') {
    return { state: 'warning', label: 'Ikke aktivert', message: 'Varsler er ikke gitt tillatelse på denne enheten.' };
  }
  const registration = await navigator.serviceWorker.getRegistration('/admin/');
  if (!registration) return { state: 'warning', label: 'Mangler', message: 'Adminens varslingstjeneste er ikke installert i denne nettleseren.' };
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { state: 'warning', label: 'Ikke abonnert', message: 'Varsler er tillatt, men denne enheten er ikke abonnert.' };
  if (manage && typeof window.disableAdminPush === 'function') manage.hidden = false;
  return { state: 'warning', label: 'Aktiv, ikke leveringstestet', message: 'Denne enheten er abonnert. Faktisk levering av varsler testes ikke her.' };
}

async function runChecks() {
  if (running) return;
  running = true;
  $('checkNow').disabled = true;
  $('checkedAt').textContent = 'Kontrollerer …';
  const rows = ['adminCheck', 'databaseCheck', 'storageCheck', 'emailCheck', 'fikenCheck', 'pushCheck'];
  rows.forEach(id => setResult(id, 'pending', 'Kontrollerer', 'Kontrollen pågår …'));

  const adminResult = await Promise.allSettled([checkAdmin()]);
  if (adminResult[0].status === 'fulfilled') setResult('adminCheck', 'ok', 'OK', adminResult[0].value);
  else setResult('adminCheck', 'error', 'Feil', adminResult[0].reason?.message || 'Kunne ikke bekrefte administratortilgang.');

  let checks;
  try {
    checks = await checkServices();
    for (const [key, id] of [['database', 'databaseCheck'], ['storage', 'storageCheck'], ['email', 'emailCheck'], ['fiken', 'fikenCheck']]) {
      const check = checks[key];
      if (!check) setResult(id, 'unknown', 'Ukjent', 'Funksjonen returnerte ingen status for denne tjenesten.');
      else setResult(id, check.state || 'unknown', check.label || 'Ukjent', check.message || 'Statusinformasjon mangler.');
    }
  } catch (error) {
    const message = error?.message || 'Kunne ikke hente tjenestestatus.';
    for (const id of ['databaseCheck', 'storageCheck', 'emailCheck', 'fikenCheck']) setResult(id, 'error', 'Feil', message);
  }

  try {
    const result = await checkPush();
    setResult('pushCheck', result.state, result.label, result.message);
  } catch {
    setResult('pushCheck', 'warning', 'Ukjent', 'Kunne ikke lese varslingstilstanden på denne enheten.');
  }

  const timestamp = new Date().toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' });
  $('checkedAt').textContent = `Sist kontrollert: ${timestamp}. E-post og Fiken testes kun med skrivebeskyttede kall.`;
  $('checkNow').disabled = false;
  running = false;
}

$('checkNow').addEventListener('click', runChecks);
$('pushManage')?.addEventListener('click', async () => {
  const button = $('pushManage');
  button.disabled = true;
  try { await window.disableAdminPush?.(); await runChecks(); }
  catch (error) { setResult('pushCheck', 'error', 'Feil', error?.message || 'Kunne ikke deaktivere varsler.'); }
  finally { button.disabled = false; }
});
window.addEventListener('adminpushchange', () => setTimeout(runChecks, 400));
if (await window.adminReady) await runChecks();

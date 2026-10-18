const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const allowedOrigins = new Set([
  'https://skallstuggu-test.no',
  'https://skallstuggufjellstue.pages.dev',
]);

function headersFor(origin: string) {
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://skallstuggu-test.no',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(origin), 'Content-Type': 'application/json' },
  });
}

type Check = { state: 'ok' | 'warning' | 'error'; label: string; message: string };
const ok = (message: string): Check => ({ state: 'ok', label: 'OK', message });
const error = (message: string): Check => ({ state: 'error', label: 'Feil', message });
const warning = (message: string): Check => ({ state: 'warning', label: 'Ikke satt opp', message });

async function checkAdmin(req: Request) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const token = req.headers.get('authorization') || '';
  if (!token.startsWith('Bearer ')) return null;
  const common = { apikey: SERVICE_KEY };
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { ...common, Authorization: token },
    signal: AbortSignal.timeout(10000),
  });
  if (!authResponse.ok) return null;
  const user = await authResponse.json();
  if (!user?.id || user.is_anonymous) return null;
  const adminResponse = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`, {
    headers: { ...common, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!adminResponse.ok || !(await adminResponse.json()).length) return null;
  return true;
}

async function runCheck(test: () => Promise<boolean>, success: string, failure: string): Promise<Check> {
  try {
    return await test() ? ok(success) : error(failure);
  } catch {
    return error(failure);
  }
}

async function checkDatabase(): Promise<Check> {
  if (!SUPABASE_URL || !SERVICE_KEY) return warning('Supabase-serveroppsettet mangler.');
  return runCheck(async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/bookings?select=id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    await response.body?.cancel();
    return true;
  }, 'Supabase-databasen svarte på en leseforespørsel.', 'Databasen svarte ikke som forventet. Se Supabase-status og logger.');
}

async function checkStorage(): Promise<Check> {
  if (!SUPABASE_URL || !SERVICE_KEY) return warning('Supabase-serveroppsettet mangler.');
  return runCheck(async () => {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/kvitteringer`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1, offset: 0 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    await response.body?.cancel();
    return true;
  }, 'Det private filområdet svarer. Ingen filer ble hentet.', 'Kvitteringslagringen svarte ikke som forventet. Se Supabase-status og logger.');
}

async function checkEmail(): Promise<Check> {
  const key = Deno.env.get('RESEND_API_KEY') || '';
  if (!key) return warning('RESEND_API_KEY mangler i Supabase Secrets.');
  return runCheck(async () => {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    await response.body?.cancel();
    return true;
  }, 'Resend godkjente API-nøkkelen. Dette bekrefter ikke faktisk levering.', 'Resend avviste kontrollen. Kontroller API-nøkkel og Resend-status.');
}

async function checkFiken(): Promise<Check> {
  const token = Deno.env.get('FIKEN_TOKEN') || '';
  if (!token) return warning('FIKEN_TOKEN mangler i Supabase Secrets.');
  return runCheck(async () => {
    const response = await fetch('https://api.fiken.no/api/v2/companies?page=0&pageSize=100', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return false;
    const companies = await response.json();
    return Array.isArray(companies) && companies.some((company: { slug?: string }) => company.slug === 'apiskallstuggu');
  }, 'Fiken-tokenet virker, og testforetaket apiskallstuggu er tilgjengelig. Ingen data er endret.', 'Fiken kunne ikke bekrefte testforetaket. Kontroller tilkoblingen og tilgangen i Fiken.');
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(origin) });
  if (req.method !== 'POST') return reply({ error: 'Bruk POST.' }, 405, origin);
  if (!allowedOrigins.has(origin)) return reply({ error: 'Ugyldig origin.' }, 403, origin);

  let authorized = false;
  try { authorized = (await checkAdmin(req)) === true; } catch { /* Keep the response generic. */ }
  if (!authorized) return reply({ error: 'Admininnlogging kreves.' }, 403, origin);

  const checks = await Promise.all([checkDatabase(), checkStorage(), checkEmail(), checkFiken()]);
  return reply({
    checkedAt: new Date().toISOString(),
    checks: { database: checks[0], storage: checks[1], email: checks[2], fiken: checks[3] },
  }, 200, origin);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { createHandler, cancellationEmail } from '../supabase/functions/booking-cancellation-email/index.ts';

const original = { id: 'booking-1', name: 'Testgjest', email: 'guest@example.com', phone: '12345678', start_date: '2026-10-01', end_date: '2026-10-04', status: 'approved', cancelled_at: null, cancellation_email_sent_at: null, invoice_url: 'invoice.pdf', payment_status: 'paid', message: 'Original melding' };

function frontend({ rows = [structuredClone(original)], failUpdate = false, failMail = false, stale = false } = {}) {
  let updates = 0, mails = 0;
  const alerts = [], events = [];
  const client = { from() {
    let update = null;
    const filters = [];
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      is(key, value) { filters.push([key, value]); return query; }, update(value) { update = value; return query; },
      async maybeSingle() {
        updates++;
        if (failUpdate) return { error: { message: 'Database unavailable' } };
        const row = stale ? null : rows.find(row => filters.every(([key, value]) => (row[key] ?? null) === value));
        if (row) Object.assign(row, update);
        return { data: row ? structuredClone(row) : null, error: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key] === value)), error: null }).then(resolve, reject); }
    };
    return query;
  } };
  const context = vm.createContext({
    supabaseClient: client, supabaseUrl: 'https://example.test', supabaseAnonKey: 'test-token',
    allBookings: structuredClone(rows), approvedBookings: rows.filter(row => row.status === 'approved'), selectedBooking: original,
    formatDate: value => value, confirm: () => true, alert: value => alerts.push(value),
    loadCalendar: () => events.push('calendar'), loadData: async () => events.push('reload'),
    fetch: async () => { mails++; events.push('mail'); return { ok: !failMail, json: async () => failMail ? { error: 'Mail unavailable' } : { success: true } }; }
  });
  vm.runInContext(fs.readFileSync(new URL('../admin/booking-editor.js', import.meta.url), 'utf8'), context);
  return { context, rows, alerts, events, counts: () => ({ updates, mails }) };
}

test('edit updates contact details/dates without changing payment, invoice or customer message', async () => {
  const f = frontend();
  await f.context.saveBookingChanges(original, { name: 'Nytt navn', email: 'new@example.com', phone: '87654321', start_date: '2026-10-05', end_date: '2026-10-08', payment_status: 'unpaid' });
  assert.equal(f.rows[0].start_date, '2026-10-05');
  assert.equal(f.rows[0].payment_status, 'paid');
  assert.equal(f.rows[0].invoice_url, 'invoice.pdf');
  assert.equal(f.rows[0].message, 'Original melding');
  assert.equal(f.counts().mails, 0);
});

test('edit rejects overlap, permits same-day turnover, and excludes itself', async () => {
  const f = frontend({ rows: [structuredClone(original), { ...original, id: 'booking-2', start_date: '2026-10-04', end_date: '2026-10-07' }] });
  await assert.rejects(f.context.saveBookingChanges(original, { ...original, end_date: '2026-10-05' }), /overlapper/);
  await f.context.saveBookingChanges(original, { ...original, end_date: '2026-10-04' });
  assert.equal(f.counts().updates, 1);
});

test('invalid date order and stale records never overwrite bookings', async () => {
  const f = frontend({ stale: true });
  await assert.rejects(f.context.saveBookingChanges(original, { ...original, end_date: original.start_date }), /Kontroller/);
  await assert.rejects(f.context.saveBookingChanges(original, original), /endret/);
  assert.equal(f.rows[0].status, 'approved');
});

test('cancellation frees calendar before email and preserves invoice/history', async () => {
  const f = frontend();
  await f.context.cancelBooking(original);
  assert.equal(f.rows[0].status, 'rejected');
  assert.ok(f.rows[0].cancelled_at);
  assert.equal(f.rows[0].invoice_url, 'invoice.pdf');
  assert.equal(f.context.approvedBookings.length, 0);
  assert.equal(f.context.selectedBooking, null);
  assert.ok(f.events.indexOf('calendar') < f.events.indexOf('mail'));
  assert.equal(f.counts().mails, 1);
});

test('database error or stale cancellation sends no email', async () => {
  for (const options of [{ failUpdate: true }, { stale: true }]) {
    const f = frontend(options);
    await f.context.cancelBooking(original);
    assert.equal(f.counts().mails, 0);
    assert.equal(f.rows[0].status, 'approved');
  }
});

test('mail failure leaves booking cancelled and offers retry; retry does not cancel twice', async () => {
  const f = frontend({ failMail: true });
  await f.context.cancelBooking(original);
  assert.equal(f.context.approvedBookings.length, 0);
  assert.match(f.alerts[0], /Prøv avbestillingsmail igjen/);
  await f.context.retryCancellationEmail(f.rows[0]);
  assert.equal(f.counts().updates, 1);
  assert.equal(f.counts().mails, 2);
});

test('double-click cancellation performs only one update and email', async () => {
  const f = frontend();
  await Promise.all([f.context.cancelBooking(original), f.context.cancelBooking(original)]);
  assert.deepEqual(f.counts(), { updates: 1, mails: 1 });
});

function backend(options = {}) {
  let row = { ...original, status: 'rejected', cancelled_at: '2026-09-17T10:00:00.000Z', cancellation_email_attempted_at: null, ...options.row };
  const calls = [];
  let failSave = options.failSave;
  const handler = createHandler({
    env: key => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', RESEND_API_KEY: 'test-secret' }[key]),
    now: () => new Date('2026-09-17T10:01:00.000Z'),
    request: async (url, init) => {
      calls.push({ url, ...init });
      if (url === 'https://api.resend.com/emails') return Response.json(options.failMail ? { error: 'failed' } : { id: 'mail-123' }, { status: options.failMail ? 500 : 200 });
      if (init.method === 'PATCH') {
        const patch = JSON.parse(init.body);
        if (patch.cancellation_email_sent_at && failSave) { failSave = false; return Response.json({}, { status: 500 }); }
        if (options.noUpdate) return Response.json([]);
        Object.assign(row, patch);
      }
      return Response.json(options.missing ? [] : [row]);
    }
  });
  const send = (body = { bookingId: 'booking-1' }) => handler(new Request('https://function.example', { method: 'POST', headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { handler, send, calls, row: () => row };
}

test('cancellation mail uses database recipient, escapes text and retains caller RLS', async () => {
  const b = backend({ row: { name: '<img src=x onerror=alert(1)>' } });
  const response = await b.send({ bookingId: 'booking-1', email: 'attacker@example.com' });
  assert.equal(response.status, 200);
  const mail = b.calls.find(call => call.url.includes('api.resend.com'));
  const payload = JSON.parse(mail.body);
  assert.deepEqual(payload.to, ['guest@example.com']);
  assert.match(payload.html, /&lt;img/);
  assert.doesNotMatch(payload.html, /<img src=x/);
  assert.equal(b.calls[0].headers.Authorization, 'Bearer caller-token');
  assert.ok(b.row().cancellation_email_sent_at);
});

test('already sent email is not resent; un-cancelled and missing bookings are rejected', async () => {
  for (const [options, status] of [[{ row: { cancellation_email_sent_at: '2026-09-17T10:00:00Z' } }, 200], [{ row: { cancelled_at: null } }, 409], [{ missing: true }, 404], [{ noUpdate: true }, 403]]) {
    const b = backend(options);
    assert.equal((await b.send()).status, status);
    assert.equal(b.calls.filter(call => call.url.includes('api.resend.com')).length, 0);
  }
});

test('mail rejection does not mark sent; unconfirmed persistence retries with identical payload/key', async () => {
  const rejected = backend({ failMail: true });
  assert.equal((await rejected.send()).status, 502);
  assert.equal(rejected.row().cancellation_email_sent_at, null);
  const b = backend({ failSave: true });
  assert.equal((await b.send()).status, 503);
  assert.equal((await b.send()).status, 200);
  const mails = b.calls.filter(call => call.url.includes('api.resend.com'));
  assert.equal(mails[0].headers['Idempotency-Key'], mails[1].headers['Idempotency-Key']);
  assert.equal(mails[0].body, mails[1].body);
  assert.equal((await b.send()).status, 200);
  assert.equal(b.calls.filter(call => call.url.includes('api.resend.com')).length, 2);
});

test('old uncertain delivery requires checking Resend instead of risking a duplicate', async () => {
  const b = backend({ row: { cancellation_email_attempted_at: '2026-09-15T10:00:00Z' } });
  assert.equal((await b.send()).status, 409);
  assert.equal(b.calls.filter(call => call.url.includes('api.resend.com')).length, 0);
});

test('missing auth, malformed ID and wrong methods send nothing', async () => {
  const b = backend();
  assert.equal((await b.handler(new Request('https://example.test', { method: 'POST' }))).status, 401);
  assert.equal((await b.send({ bookingId: '1&select=*' })).status, 400);
  assert.equal((await b.handler(new Request('https://example.test'))).status, 405);
  assert.equal(b.calls.length, 0);
});

// Standalone function: the existing resend-email and its templates stay intact.
// No service-role key: database calls retain the caller's existing RLS context.
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://skallstuggu-test.no",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function cancellationEmail(booking) {
  return {
    from: "Skallstuggu <booking@skallstuggu-test.no>",
    to: [booking.email],
    subject: "Din booking er avbestilt – Skallstuggu",
    html: `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"></head>
      <body style="font-family:Arial,Helvetica,sans-serif;line-height:1.65;color:#333;max-width:620px;margin:0 auto;padding:30px 20px;background:#fff">
        <h2 style="color:#8B4A2B">Hei ${escapeHtml(booking.name)},</h2>
        <p>Vi bekrefter at din booking hos Skallstuggu er avbestilt.</p>
        <div style="background:#f8f1e3;padding:25px;border-left:6px solid #8B4A2B;margin:30px 0;border-radius:4px">
          <strong>Avbestilt opphold:</strong><br>${escapeHtml(booking.start_date)} → ${escapeHtml(booking.end_date)}<br>
          <strong>Bookingreferanse:</strong> ${escapeHtml(booking.id)}
        </div>
        <p>Reservasjonen er fjernet fra kalenderen.</p>
        <p>Eventuell tilbakebetaling eller avbestillingskostnad avklares separat i henhold til leievilkårene.</p>
        <p>Har du spørsmål, kontakt oss på <a href="mailto:post@skallstuggu.no">post@skallstuggu.no</a> eller telefon <a href="tel:90688873">906 88 873</a>.</p>
        <div style="margin-top:50px;padding-top:35px;border-top:1px solid #ddd;text-align:center;color:#555">
          <p style="color:#8B4A2B;font-weight:bold">Med vennlig hilsen</p><p><strong>Skallstuggu</strong></p>
          <p>Vulusjøen • 7600 Levanger • Trøndelag</p>
          <img src="https://rbphgvnwmzjeuvyrasvy.supabase.co/storage/v1/object/public/leiebetingelser/logo.png" alt="Skallstuggu" style="max-width:180px;height:auto">
        </div>
      </body></html>`,
  };
}

export function createHandler({ env, request = fetch, now = () => new Date() }) {
  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Kun POST er tillatt." }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Mangler tilgangstoken." }, 401);
    try {
      const { bookingId } = await req.json();
      if (typeof bookingId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(bookingId)) return json({ error: "Ugyldig bookingreferanse." }, 400);
      const url = env("SUPABASE_URL"), anonKey = env("SUPABASE_ANON_KEY"), resendKey = env("RESEND_API_KEY");
      if (!url || !anonKey || !resendKey) return json({ error: "E-posttjenesten er ikke konfigurert." }, 503);
      const headers = { apikey: anonKey, Authorization: authorization, "Content-Type": "application/json", Prefer: "return=representation" };
      const endpoint = `${url}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}`;
      const read = async () => {
        const response = await request(endpoint + "&select=id,name,email,start_date,end_date,status,cancelled_at,cancellation_email_sent_at,cancellation_email_attempted_at", { headers });
        if (!response.ok) throw new Error("Kunne ikke hente avbestillingen.");
        const rows = await response.json();
        return rows[0];
      };
      let booking = await read();
      if (!booking) return json({ error: "Fant ikke bookingen eller mangler tilgang." }, 404);
      if (!booking.cancelled_at || booking.status !== "rejected") return json({ error: "Bookingen er ikke avbestilt." }, 409);
      if (booking.cancellation_email_sent_at) return json({ success: true, alreadySent: true });
      if (!booking.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) return json({ error: "Bookingen mangler en gyldig e-postadresse." }, 422);

      // Persist the first attempt before contacting Resend. A returned row also
      // confirms that this caller has UPDATE rights under existing RLS policies.
      if (!booking.cancellation_email_attempted_at) {
        const claim = await request(endpoint + "&cancellation_email_attempted_at=is.null&cancellation_email_sent_at=is.null&status=eq.rejected", {
          method: "PATCH", headers, body: JSON.stringify({ cancellation_email_attempted_at: now().toISOString() }),
        });
        if (!claim.ok) throw new Error("Kunne ikke registrere e-postforsøket.");
        const claimed = await claim.json();
        booking = claimed[0] || await read();
        if (!booking?.cancellation_email_attempted_at) return json({ error: "Mangler tilgang til å sende avbestillingsmail." }, 403);
        if (booking.cancellation_email_sent_at) return json({ success: true, alreadySent: true });
      }

      // Resend retains idempotency keys for 24 hours. Do not blindly resend an
      // uncertain delivery after that window: ask the owner to check Resend.
      if (now().getTime() - new Date(booking.cancellation_email_attempted_at).getTime() >= 23 * 60 * 60 * 1000) {
        return json({ error: "Tidligere sending må kontrolleres i Resend før nytt forsøk, for å unngå dobbelt e-post." }, 409);
      }
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `booking-cancelled/${booking.id}/${booking.cancelled_at}` },
        body: JSON.stringify(cancellationEmail(booking)),
      });
      if (!response.ok) return json({ error: "E-posttjenesten avviste sendingen. Prøv igjen senere." }, 502);
      const receipt = await response.json();
      if (!receipt.id) return json({ error: "E-posttjenesten ga ingen sendebekreftelse." }, 502);
      const saved = await request(endpoint + "&cancelled_at=eq." + encodeURIComponent(booking.cancelled_at), {
        method: "PATCH", headers, body: JSON.stringify({ cancellation_email_sent_at: now().toISOString() }),
      });
      if (!saved.ok || !(await saved.json()).length) return json({ error: "E-posten ble godtatt, men sendestatus kunne ikke lagres. Et nytt forsøk innen 23 timer bruker samme sendereferanse." }, 503);
      return json({ success: true });
    } catch {
      return json({ error: "Kunne ikke bekrefte e-postsendingen. Avbestillingen er fortsatt lagret." }, 503);
    }
  };
}

// JavaScript-compatible TypeScript keeps the handler testable without Deno.
if (typeof Deno !== "undefined") Deno.serve(createHandler({ env: key => Deno.env.get(key) }));

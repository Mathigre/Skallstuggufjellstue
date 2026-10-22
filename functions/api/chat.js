const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestsByIp = new Map();

const SYSTEM_PROMPT = `Du er Skallstuggu Fjellstues digitale vert. Svar kort, vennlig og på norsk bokmål.
Bruk bare fakta i denne instruksen. Ikke finn på priser, ledige datoer, regler eller fasiliteter.
Skallstuggu ligger på Frolfjellet ved Vulusjøen i Levanger, omtrent 480 meter over havet. Hytta har 22 soverom og 51 sengeplasser. Vulusjøen ligger omtrent 150 meter unna, og turen til Hårskallens topp er omtrent 2 km. Kjøkkenet kan brukes til arrangementer for opptil 80 personer. Søndagskafé og mat ved arrangementer er omtalt på nettsiden.
For oppdaterte priser og tilgjengelighet skal du sende gjesten til bookingsiden: https://skallstuggu-test.no/booking.html
For spørsmål du ikke kan svare sikkert på, be gjesten kontakte Skallstuggu via https://skallstuggu-test.no/kontakt.html eller post@skallstuggu.no.
Ikke be om betalingskort, fødselsnummer eller andre sensitive opplysninger. Du kan ikke opprette, endre eller bekrefte bestillinger.`;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function allowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (
      url.hostname === "skallstuggu-test.no" ||
      url.hostname === "www.skallstuggu.no" ||
      url.hostname === "skallstuggu.no" ||
      url.hostname.endsWith(".skallstuggufjellstue.pages.dev")
    );
  } catch {
    return false;
  }
}

function allowRequest(ip) {
  const now = Date.now();
  const entry = requestsByIp.get(ip);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    requestsByIp.set(ip, { startedAt: now, count: 1 });
    if (requestsByIp.size > 5000) {
      for (const [key, value] of requestsByIp) {
        if (now - value.startedAt >= WINDOW_MS) requestsByIp.delete(key);
      }
    }
    return true;
  }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request.headers.get("Origin"))) {
    return json({ error: "Forespørselen ble avvist." }, 403);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 16_000) return json({ error: "Meldingen er for stor." }, 413);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!allowRequest(ip)) {
    return json({ error: "Vent litt før du prøver igjen." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Ugyldig forespørsel." }, 400);
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0 || body.messages.length > 8) {
    return json({ error: "Samtalen har ugyldig format." }, 400);
  }

  const messages = [];
  for (const item of body.messages) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") {
      return json({ error: "Samtalen har ugyldig format." }, 400);
    }
    const content = item.content.trim();
    if (!content || content.length > 1000) return json({ error: "Meldingen må være under 1000 tegn." }, 400);
    messages.push({ role: item.role, content });
  }
  if (messages.at(-1)?.role !== "user") return json({ error: "Siste melding må være et spørsmål." }, 400);

  if (!env.AI) return json({ error: "Chatten er ikke aktivert ennå." }, 503);

  try {
    const result = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 220,
      temperature: 0.2,
    });
    const answer = typeof result?.response === "string" ? result.response.trim() : "";
    if (!answer) return json({ error: "Jeg fikk ikke laget et svar. Prøv igjen." }, 502);
    return json({ answer });
  } catch {
    return json({ error: "Chatten er midlertidig utilgjengelig. Prøv igjen senere." }, 502);
  }
}


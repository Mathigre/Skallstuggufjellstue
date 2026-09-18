import {requireAdmin,db,newToken,hashToken} from "./auth.ts";
const env=name=>Deno.env.get(name);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://skallstuggu-test.no",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_URL = "https://skallstuggu-test.no/admin/admin.html";

const PDF_URL =
  "https://rbphgvnwmzjeuvyrasvy.supabase.co/storage/v1/object/public/leiebetingelser/Leiebetingelse_Skallstuggu.pdf";

const LOGO_URL =
  "https://rbphgvnwmzjeuvyrasvy.supabase.co/storage/v1/object/public/leiebetingelser/logo.png";

const MAIN_COLOR = "#8B4A2B";

function getEmailSignature() {
  return `
    <div style="margin-top: 50px; padding-top: 35px; border-top: 1px solid #ddd; font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #555555; text-align: center;">
      
      <p style="margin: 0 0 8px 0; font-weight: bold; color: ${MAIN_COLOR};">
        Med vennlig hilsen
      </p>

      <p style="margin: 0 0 18px 0; font-weight: bold; color: #333; font-size: 17px;">
        Skallstuggu
      </p>
      
      <p style="margin: 4px 0;">
        Vulusjøen • 7600 Levanger • Trøndelag
      </p>

      <p style="margin: 4px 0;">
        Telefon:
        <a href="tel:90688873"
           style="color: ${MAIN_COLOR}; text-decoration: none;">
          906 88 873
        </a>
      </p>

      <p style="margin: 4px 0;">
        E-post:
        <a href="mailto:post@skallstuggu.no"
           style="color: ${MAIN_COLOR}; text-decoration: none;">
          post@skallstuggu.no
        </a>
      </p>

      <p style="margin: 22px 0 10px 0; font-size: 14px; color: #777;">
        Følg oss i sosiale media:
      </p>

      <p style="margin: 0 0 25px 0;">
        <a href="https://www.facebook.com/Skallstuggu"
           style="color: ${MAIN_COLOR}; text-decoration: none; margin-right: 18px;">
          Facebook
        </a>

        <a href="https://www.instagram.com/skallstuggu/"
           style="color: ${MAIN_COLOR}; text-decoration: none;">
          Instagram
        </a>
      </p>

      <div style="margin-top: 20px;">
        <img
          src="${LOGO_URL}"
          alt="Skallstuggu"
          style="max-width: 180px; height: auto; display: block; margin: 0 auto;"
        >
      </div>

    </div>
  `;
}

Deno.serve(async (req) => {

  // ====================
  // CORS
  // ====================

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }
  if(req.method!=='POST')return new Response('Method not allowed',{status:405,headers:corsHeaders});

  try {

    // ====================
    // DATA FRA NETTSIDEN
    // ====================

    const service=req.headers.get('authorization')==='Bearer '+env('SUPABASE_SERVICE_ROLE_KEY');
    if(!service)await requireAdmin(req,env);
    const body = await req.json();
    if(!['request_customer','request_owner','admin_reply','approved'].includes(body.type))throw new Error('Ukjent e-posttype.');
    if(!service && ['request_customer','request_owner'].includes(body.type))throw new Error('Kun bookingtjenesten kan sende forespørselsmail.');
    if(!/^[a-f0-9-]{36}$/i.test(body.bookingId||''))throw new Error('Bookingreferanse mangler.');
    const [booking]=await db('bookings?id=eq.'+body.bookingId+'&select=id,name,email,phone,start_date,end_date,message,status,booking_total_ore,invoice_url',env);
    if(!booking || !booking.email)throw new Error('Bookingen finnes ikke eller mangler e-post.');
    if(body.type==='approved'&&booking.status!=='approved')throw new Error('Bookingen er ikke godkjent.');
    Object.assign(body,{name:esc(booking.name),email:booking.email,phone:esc(booking.phone),start:booking.start_date,end:booking.end_date,customerMessage:esc((booking.message||'')+(booking.booking_total_ore!=null?'\nTotalpris inkl. mva: '+booking.booking_total_ore/100+' kr.':'')),message:esc(body.message||''),adminReply:esc(body.adminReply||'')});
    body.invoiceUrl=booking.invoice_url&&booking.invoice_url.startsWith(env('SUPABASE_URL')+'/storage/v1/object/sign/fakturaer/')?esc(booking.invoice_url):null;
    if(body.type!=='request_owner'){
      const token=newToken();
      await db('booking_access_tokens',env,'POST',{token_hash:await hashToken(token),booking_id:booking.id,email:booking.email,expires_at:new Date(Date.now()+365*86400000).toISOString()});
      body.replyUrl='https://skallstuggu-test.no/reply.html#token='+token;
    }


    const {
      type,
      name,
      email,
      phone,
      start,
      end,
      customerMessage,
      adminReply,
      message,
      invoiceUrl,
      bookingId,
      replyUrl,
    } = body;


    // ============================================================
    // DEBUG – VISER HVA ADMIN FAKTISK SENDER
    // ============================================================










    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY mangler i Supabase Secrets.");


    let subject = "";
    let html = "";
    let to: string[] = [];

    const signature = (type!=='request_owner' ? '<p><a href="'+replyUrl+'">Se din booking og send melding</a></p><p>Lenken er privat. Ikke del den med andre.</p>' : '') + getEmailSignature();


    // ============================================================
    // SVAR FRA ADMIN TIL KUNDE
    // ============================================================

    if (type === "admin_reply") {

      subject =
        "Svar fra Skallstuggu på din forespørsel";

      to = [email];


      // Lag svarlenken
      const customerReplyUrl =
        replyUrl ||
        `https://skallstuggu-test.no/reply.html?booking=${encodeURIComponent(
          bookingId || ""
        )}`;


      // DEBUG AV FERDIG LENKE
  


      html = `
        <!DOCTYPE html>

        <html>

        <head>
          <meta charset="utf-8">
        </head>

        <body style="
          font-family: Arial, Helvetica, sans-serif;
          line-height: 1.65;
          color: #333;
          max-width: 620px;
          margin: 0 auto;
          padding: 30px 20px;
          background-color: #ffffff;
        ">

          <h2 style="color: ${MAIN_COLOR};">
            Hei ${name},
          </h2>

          <p>
            Vi har mottatt din bookingforespørsel
            og har nå svart på den.
          </p>

          <div style="
            background: #f8f1e3;
            padding: 25px;
            border-left: 6px solid ${MAIN_COLOR};
            margin: 30px 0;
            border-radius: 4px;
          ">

            <strong style="color: ${MAIN_COLOR};">
              Svar fra oss:
            </strong>

            <br><br>

            ${message || adminReply || ""}

          </div>


          ${
            invoiceUrl
              ? `
                <div style="
                  background: #e8f5e9;
                  padding: 20px;
                  border-left: 6px solid #2e7d32;
                  margin: 30px 0;
                  border-radius: 4px;
                  text-align: left;
                ">
                  <strong style="color:#2e7d32;">Faktura:</strong>
                  <br><br>
                  <a href="${invoiceUrl}" target="_blank" style="display:inline-block;background:#2e7d32;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:6px;font-weight:bold;">
                    Åpne faktura (PDF)
                  </a>
                  <p style="margin:10px 0 0;font-size:14px;color:#555;">
                    Lenken er tilgjengelig i en begrenset periode.
                  </p>
                </div>
              `
              : ""
          }

          <div style="
            margin: 35px 0;
            text-align: center;
          ">

            <a
              href="${customerReplyUrl}"
              target="_blank"
              style="
                display: inline-block;
                background: ${MAIN_COLOR};
                color: #ffffff;
                padding: 14px 28px;
                text-decoration: none;
                border-radius: 6px;
                font-weight: bold;
                font-size: 16px;
              "
            >
              Svar på meldingen
            </a>

          </div>


          <p style="
            text-align: center;
            font-size: 14px;
            color: #666;
          ">
            Trykk på knappen for å se samtalen
            og sende oss et nytt svar.
          </p>


          <p>
            Du kan også ringe oss på
            <strong>906 88 873</strong>.
          </p>


          ${signature}

        </body>

        </html>
      `;
    }


    // ============================================================
    // BOOKINGFORESPØRSEL – BEKREFTELSE TIL KUNDE
    // ============================================================

    else if (type === "request_customer") {

      subject =
        "Vi har mottatt din bookingforespørsel – Skallstuggu";

      to = [email];


      html = `
        <!DOCTYPE html>

        <html>

        <head>
          <meta charset="utf-8">
        </head>

        <body style="
          font-family: Arial, Helvetica, sans-serif;
          line-height: 1.65;
          color: #333;
          max-width: 620px;
          margin: 0 auto;
          padding: 30px 20px;
          background-color: #ffffff;
        ">

          <h2 style="color: ${MAIN_COLOR};">
            Hei ${name},
          </h2>


          <p>
            Takk for din bookingforespørsel
            til Skallstuggu.
          </p>


          <p>
            Vi har mottatt forespørselen din
            for perioden
            <strong>
              ${start} → ${end}
            </strong>.
          </p>


          ${
            customerMessage
              ? `
                <p>
                  <strong>
                    Din melding til oss:
                  </strong>
                  <br>
                  “${customerMessage}”
                </p>
              `
              : ""
          }


          <p>
            <strong>
              Viktig informasjon:
            </strong>
          </p>


          <p>
            Vi ber deg lese gjennom
            leiebetingelsene nøye og sette deg
            inn i gjeldende priser på nettsiden vår.
          </p>


          <p>
            <a
              href="${PDF_URL}"
              target="_blank"
              style="
                color: ${MAIN_COLOR};
                font-weight: bold;
              "
            >
              Åpne Leiebetingelser (PDF)
            </a>
          </p>


          <p>
            Vi behandler forespørselen din
            så raskt som mulig og sender deg
            svar snart.
          </p>


          <p>
            Har du spørsmål?
            Ring oss gjerne på
            <strong>906 88 873</strong>.
          </p>


          ${signature}

        </body>

        </html>
      `;
    }


    // ============================================================
    // NY BOOKINGFORESPØRSEL TIL EIER
    // ============================================================

    else if (type === "request_owner") {

      subject =
        `Ny bookingforespørsel fra ${name}`;

      to = [
  "minsten.mg@gmail.com",
  "post@skallstuggu.no"
];


      html = `
        <!DOCTYPE html>

        <html>

        <head>
          <meta charset="utf-8">
        </head>

        <body style="
          font-family: Arial, Helvetica, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 620px;
          margin: 0 auto;
          padding: 30px 20px;
        ">

          <h2>
            Ny bookingforespørsel
          </h2>


          <p>
            <strong>Navn:</strong>
            ${name}
          </p>


          <p>
            <strong>E-post:</strong>
            ${esc(email)}
          </p>


          <p>
            <strong>Telefon:</strong>
            ${phone || "-"}
          </p>


          <p>
            <strong>Periode:</strong>
            ${start} → ${end}
          </p>


          ${
            customerMessage
              ? `
                <p>
                  <strong>
                    Kundens melding:
                  </strong>
                  <br>
                  “${customerMessage}”
                </p>
              `
              : ""
          }


          <p style="margin-top: 35px;">

            <a
              href="${ADMIN_URL}"
              target="_blank"
              style="
                background: ${MAIN_COLOR};
                color: white;
                padding: 14px 24px;
                text-decoration: none;
                border-radius: 6px;
                font-weight: bold;
              "
            >
              Gå til admin-siden for å behandle forespørselen
            </a>

          </p>

        </body>

        </html>
      `;
    }


    // ============================================================
    // BOOKING GODKJENT
    // ============================================================

    else if (type === "approved") {

      subject =
        `✓ Din booking er godkjent – Skallstuggu`;

      to = [email];


      const invoiceSection =
        invoiceUrl
          ? `
            <div style="
              background: #e8f5e9;
              padding: 20px;
              border-left: 6px solid #2e7d32;
              margin: 30px 0;
              border-radius: 4px;
            ">

              <strong style="color:#2e7d32;">
                Faktura:
              </strong>

              <br><br>

              <a
                href="${invoiceUrl}"
                target="_blank"
                style="
                  color:#2e7d32;
                  font-weight:bold;
                "
              >
                Last ned faktura her
              </a>


              <p style="
                margin-top:10px;
                font-size:14px;
                color:#555;
              ">
                Lenken er tilgjengelig
                i en begrenset periode.
              </p>

            </div>
          `
          : "";


      html = `
        <!DOCTYPE html>

        <html>

        <head>
          <meta charset="utf-8">
        </head>

        <body style="
          font-family: Arial, Helvetica, sans-serif;
          line-height: 1.65;
          color: #333;
          max-width: 620px;
          margin: 0 auto;
          padding: 30px 20px;
          background-color: #ffffff;
        ">


          <h2 style="color: ${MAIN_COLOR};">
            Hei ${name},
          </h2>


          <p>
            <strong>God nyhet!</strong>

            Din booking for perioden

            <strong>
              ${start} → ${end}
            </strong>

            er nå godkjent.
          </p>


          ${
            adminReply
              ? `
                <div style="
                  background: #f8f1e3;
                  padding: 25px;
                  border-left: 6px solid ${MAIN_COLOR};
                  margin: 30px 0;
                  border-radius: 4px;
                ">

                  <strong style="color: ${MAIN_COLOR};">
                    Melding fra oss:
                  </strong>

                  <br><br>

                  ${adminReply}

                </div>
              `
              : ""
          }


          ${invoiceSection}


          <p>
            <strong>
              Viktig før oppholdet:
            </strong>
          </p>


          <p>
            Vi ber deg lese gjennom
            leiebetingelsene nøye.
          </p>


          <p>
            <a
              href="${PDF_URL}"
              target="_blank"
              style="
                color: ${MAIN_COLOR};
                font-weight: bold;
              "
            >
              Åpne Leiebetingelser (PDF)
            </a>
          </p>


          <p>
            Vi gleder oss til å se deg
            på Skallstuggu!
          </p>


          ${signature}

        </body>

        </html>
      `;
    }


    // ============================================================
    // UKJENT TYPE
    // ============================================================

    else {

      throw new Error(
        `Ukjent e-posttype: ${type}`
      );

    }


    // ============================================================
    // SEND VIA RESEND
    // ============================================================




    const resendResponse =
      await fetch(
        "https://api.resend.com/emails",
        {

          method: "POST",

          headers: {

            "Authorization":
              `Bearer ${RESEND_API_KEY}`,

            "Content-Type":
              "application/json",

          },

          body: JSON.stringify({

            from:
              "Skallstuggu <booking@skallstuggu-test.no>",

            to,

            subject,

            html,

          }),

        }
      );


    // ============================================================
    // RESEND FEIL
    // ============================================================

    if (!resendResponse.ok) {

      const errorText =
        await resendResponse.text();

      throw new Error(
        `Resend feil: ${resendResponse.status} - ${errorText}`
      );

    }





    // ============================================================
    // OK
    // ============================================================

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
        status: 200,
      }
    );

  } catch (error) {

    console.error(
      "Feil i resend-email:",
      error
    );


    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
        status: 400,
      }
    );

  }
});

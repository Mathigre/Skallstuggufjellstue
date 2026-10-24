const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOGO_URL =
  "https://rbphgvnwmzjeuvyrasvy.supabase.co/storage/v1/object/public/leiebetingelser/logo.png";

const MAIN_COLOR = "#8B4A2B";

function getEmailSignature(replyEmail) {
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
        <a href="mailto:${escapeHtml(replyEmail)}"
           style="color: ${MAIN_COLOR}; text-decoration: none;">
          ${escapeHtml(replyEmail)}
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


export function acknowledgementHtml({name,message,replyEmail}) {
 return `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
 <body style="font-family:Arial,Helvetica,sans-serif;line-height:1.65;color:#333;max-width:620px;margin:0 auto;padding:30px 20px;background-color:#ffffff">
 <h2 style="color:${MAIN_COLOR}">Hei ${escapeHtml(name)},</h2>
 <p>Takk for henvendelsen! Vi har mottatt meldingen din og svarer så snart vi kan.</p>
 <div style="background:#f8f1e3;padding:25px;border-left:6px solid ${MAIN_COLOR};margin:30px 0;border-radius:4px">
 <strong style="color:${MAIN_COLOR}">Din melding:</strong><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(message)}</p></div>
 <p>Dette er en automatisk bekreftelse. Hvis det haster, kan du ringe oss på <a href="tel:90688873" style="color:${MAIN_COLOR}">906 88 873</a>.</p>
 ${getEmailSignature(replyEmail)}</body></html>`;
}

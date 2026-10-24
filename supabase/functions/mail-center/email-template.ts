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
 <body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#333;max-width:620px;margin:0 auto;padding:30px 20px;background-color:#ffffff">
 <h2 style="color:${MAIN_COLOR}">Hei ${escapeHtml(name)},</h2>
 <p>Takk for din henvendelse til Skallstuggu.</p>
 <p>Vi har mottatt meldingen din gjennom kontaktskjemaet vårt.</p>
 <p><strong>Din melding til oss:</strong><br><span style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(message)}</span></p>
 <p>Vi behandler henvendelsen din så raskt som mulig og sender deg svar så snart vi kan.</p>
 <p>Har du spørsmål, eller haster det? Ring oss gjerne på <a href="tel:90688873" style="color:${MAIN_COLOR};font-weight:bold;text-decoration:none">906 88 873</a>.</p>
 <p style="font-size:13px;color:#777">Dette er en automatisk bekreftelse på at meldingen din er mottatt.</p>
 ${getEmailSignature('post@skallstuggu.no')}</body></html>`;
}

let inlineLogo;
export async function acknowledgementContent(details) {
 const html=acknowledgementHtml(details);
 try {
  inlineLogo ||= fetch('https://skallstuggu-test.no/images/Logo.png',{signal:AbortSignal.timeout(5000)}).then(async response=>{
   if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('logo_unavailable');
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>1000000||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw Error('invalid_logo');
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return btoa(binary);
  });
  const content=await inlineLogo;
  return {html:html.replace(LOGO_URL,'cid:skallstuggu-logo'),attachments:[{filename:'skallstuggu-logo.png',content,content_type:'image/png',content_id:'skallstuggu-logo'}]};
 }catch{inlineLogo=null;return {html:html.replace(LOGO_URL,'https://skallstuggu-test.no/images/Logo.png')};}
}

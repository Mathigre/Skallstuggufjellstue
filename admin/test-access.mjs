import { ACCESS_HASH } from './fiken-access-hash.mjs';
let accessCode = '';


export async function ensureFikenAccess() {
  if (accessCode) return true;
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'booking-editor';
    dialog.innerHTML = `<form><h2>Priser og Fiken-testtilgang</h2><p>Bruk den private testkoden for å endre priser eller opprette Fiken-utkast.</p><label>Testkode<input type="password" name="code" required autocomplete="off" style="width:100%;box-sizing:border-box;padding:12px"></label><p role="alert"></p><div class="booking-actions"><button class="btn-success">Fortsett</button><button type="button" class="btn-neutral">Avbryt</button></div></form>`;
    dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.remove(); resolve(Boolean(accessCode)); });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const value = dialog.querySelector('input').value.trim();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
      if (hash !== ACCESS_HASH) { dialog.querySelector('[role="alert"]').textContent = 'Feil testkode.'; return; }
      accessCode = value; dialog.close();
    };
    document.body.appendChild(dialog); dialog.showModal();
  });
};


export const getAccessCode=()=>accessCode;
export const clearAccessCode=()=>{accessCode="";};

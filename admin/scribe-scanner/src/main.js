import scribe from 'scribe.js-ocr';

const fileInput = document.querySelector('#file');
const scanButton = document.querySelector('#scan');
const status = document.querySelector('#status');
const textOutput = document.querySelector('#text');
let active = false;
scribe.opt.workerN = 1;
const warmPromise = scribe.init({ ocr: true, font: false }).catch(() => null);

function setStatus(text, progress = null) {
  status.textContent = text;
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'skallstuggu:scribe:status', text, progress }, window.location.origin);
  }
}

async function recognize(file) {
  if (active) return;
  active = true;
  scanButton.disabled = true;
  textOutput.value = '';
  let doc;
  try {
    setStatus('Klargjør Scribe på enheten …');
    await warmPromise;
    scribe.opt.progressHandler = (message) => {
      if (message?.type === 'recognize') {
        const percent = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : null;
        setStatus(percent === null ? 'Leser kvitteringen lokalt …' : 'Scribe leser kvitteringen … ' + percent + ' %', percent);
      }
    };
    doc = await scribe.openDocument([file]);
    await doc.recognize({ langs: ['nor', 'eng'], mode: 'speed', modeAdv: 'lstm' });
    const text = await doc.exportData('text');
    textOutput.value = text;
    setStatus(text.trim() ? 'Ferdig. Kontroller teksten mot originalbilaget.' : 'Fant ingen lesbar tekst.');
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'skallstuggu:scribe:result', text }, window.location.origin);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Kvitteringen kunne ikke leses.');
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'skallstuggu:scribe:error', text: status.textContent }, window.location.origin);
    }
  } finally {
    try { await doc?.close(); } catch { /* The document may already be released. */ }
    active = false;
    scanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => {
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('Velg et bilde eller en PDF først.');
    return;
  }
  void recognize(file);
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.type !== 'skallstuggu:scribe:scan' || !(message.file instanceof Blob)) return;
  const name = typeof message.name === 'string' ? message.name : 'kvittering';
  void recognize(new File([message.file], name, { type: message.file.type || 'application/octet-stream' }));
});


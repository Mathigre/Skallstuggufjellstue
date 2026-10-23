import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, claimsHumanIdentity } from '../functions/api/chat.js';
import { makeScenarios, mockSettings } from './chatbot-scenarios.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let requestId = 0;
const request = messages => new Request('https://skallstuggu-test.no/api/chat', { method: 'POST', headers: { Origin: 'https://skallstuggu-test.no', 'Content-Type': 'application/json', 'CF-Connecting-IP': `test-${++requestId}` }, body: JSON.stringify({ messages }) });
const call = (messages, env = {}) => onRequestPost({ request: request(messages), env });
const scenarios = makeScenarios();
test('1000 normal visitor questions through the actual chat handler', async () => {
  assert.equal(scenarios.length, 1000);
  assert.equal(new Set(scenarios.map(s => s.question)).size, 1000);
  const originalFetch = globalThis.fetch;
  const results = [];
  try {
    for (const scenario of scenarios) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options.method });
        if (String(url).includes('/rest/v1/booking_price_settings')) return Response.json([{ revision: 1, settings: mockSettings }]);
        if (String(url).endsWith('/functions/v1/booking-public')) return Response.json({ dates: scenario.occupied ? [{ start_date: scenario.date, end_date: new Date(new Date(scenario.date+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10) }] : [] });
        throw Error('Unexpected external request: '+url);
      };
      const response = await call([{ role: 'user', content: scenario.question }], { AI: { run: () => { throw Error('Curated or live-data question must not use the language model'); } } });
      const { answer } = await response.json();
      assert.equal(response.status, 200, scenario.question);
      assert.equal(typeof answer, 'string', scenario.question);
      if (scenario.kind === 'faq') { if (scenario.id.startsWith('kontakt-')) { assert.match(answer, /906 88 873/); assert.match(answer, /post@skallstuggu.no/); } else assert.equal(answer, scenario.expected, scenario.question); }
      if (scenario.kind === 'identity') assert.match(answer, /AI-assistent, ikke en ansatt/, scenario.question);
      if (scenario.kind === 'human-contact') { assert.match(answer, /906 88 873/, scenario.question); assert.match(answer, /post@skallstuggu.no/, scenario.question); }
      if (scenario.kind === 'price') {
        const weekend = [5,6].includes(new Date(scenario.date+'T00:00:00Z').getUTCDay());
        const amount = weekend ? 14000 : 9000;
        assert.match(answer.replace(/\s/gu, ''), new RegExp(String(amount).replace(/000$/, '[.,]?000')), scenario.question);
        assert.match(answer, /inkludert 25 % mva/, scenario.question);
        assert.equal(calls.length, 1, scenario.question);
      }
      if (scenario.kind === 'availability') {
        assert.match(answer, scenario.occupied ? /fullbooket/ : /Ledige netter/, scenario.question);
        assert.match(answer, /ikke en bekreftet reservasjon/, scenario.question);
        assert.equal(calls.length, 1, scenario.question);
      }
      assert.equal(claimsHumanIdentity(answer), false, scenario.question);
      results.push({ ...scenario, answer, passed: true, mode: ['price','availability'].includes(scenario.kind) ? 'simulated booking API; actual handler' : 'actual handler; no model' });
    }
  } finally { globalThis.fetch = originalFetch; }
  if (process.env.CHATBOT_REPORT_DIR) {
    await mkdir(process.env.CHATBOT_REPORT_DIR, { recursive: true });
    await writeFile(process.env.CHATBOT_REPORT_DIR+'/chatbot-1000-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), simulation: true, total: results.length, passed: results.length, results }, null, 2));
    const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
    await writeFile(process.env.CHATBOT_REPORT_DIR+'/chatbot-1000-results.md', '# 1 000 spørsmål og simulerte svar\n\nDette er kjøring av den faktiske chat-koden. Pris- og kalender-API er simulert med testdata, ikke reelle tilbud eller bekreftelser. De 500 FAQ-spørsmålene dekker 50 temaer. I tillegg testes 30 identitetsspørsmål, 20 ønsker om menneskelig kontakt, 250 prisforespørsler og 200 spørsmål om ledighet. Dette er ikke 1 000 modellgenererte svar.\n\n| Nr. | Spørsmål | Svar | Resultat |\n| --- | --- | --- | --- |\n'+results.map((r,i)=>`| ${i+1} | ${cell(r.question)} | ${cell(r.answer)} | OK |`).join('\n')+'\n');
  }
});
test('invented employee identity is blocked, including in old history', async () => {
  const reported = 'Hei! Jeg heter Kari, og jeg er en av ansatte ved Skallstuggu Fjellstue.';
  let input;
  const response = await call([{ role: 'assistant', content: reported }, { role: 'user', content: 'Fortell en hyggelig ting om stedet.' }], { AI: { run: async (_, payload) => { input = payload; return { response: reported }; } } });
  assert.match((await response.json()).answer, /AI-assistent/);
  assert.ok(!input.messages.some(message => message.content === reported));
  for (const bad of [reported, 'Jeg er Ingrid.', 'Jeg jobber ved Skallstuggu.', 'I am an employee at Skallstuggu.']) assert.equal(claimsHumanIdentity(bad), true);
});
test('new topics are not hijacked by earlier pricing questions', async () => {
  let input;
  const response = await call([{ role: 'user', content: 'Hva koster en natt?' }, { role: 'assistant', content: 'Hvilken dato?' }, { role: 'user', content: 'Fortell en hyggelig ting om stedet.' }], { AI: { run: async (_, payload) => { input = payload; return { response: 'Hytta ligger i fine naturomgivelser.' }; } } });
  assert.equal((await response.json()).answer, 'Hytta ligger i fine naturomgivelser.');
  assert.ok(input);
});

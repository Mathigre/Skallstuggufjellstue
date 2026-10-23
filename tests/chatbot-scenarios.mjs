import { faqTopics } from '../chatbot-faq.mjs';

export const mockSettings = { weekday: 900000, weekend: 1400000, seasons: [] };
export function makeScenarios() {
  const cases = faqTopics.flatMap(topic => topic.questions.map((question, i) => ({ id: `${topic.id}-${i+1}`, kind: 'faq', question, expected: topic.answer, source: topic.source })));
  const identityQuestions = ['Hvem er du?', 'Hva heter du?', 'Hvem snakker jeg med?', 'Er du en ansatt?', 'Er du et menneske?', 'Er du en person?', 'Er du en robot?', 'Er du en AI?', 'Jobber du her?', 'Who are you?'];
  const personQuestions = ['Kan jeg få snakke med en ekte person?', 'Jeg vil snakke med en ansatt.', 'Kan jeg kontakte eieren?', 'Jeg ønsker å prate med et menneske.', 'Hvordan får jeg tak i noen som jobber der?'];
  for (const prefix of ['', 'Hei, ', 'God dag! ']) for (const question of identityQuestions) cases.push({ id: `identity-${cases.length}`, kind: 'identity', question: prefix + question });
  for (const prefix of ['', 'Hei, ', 'God dag! ', 'Jeg trenger hjelp. ']) for (const question of personQuestions) cases.push({ id: `person-${cases.length}`, kind: 'human-contact', question: prefix + question });
  // A moving future date keeps the suite valid when rerun in later years.
  const start = new Date(); start.setUTCHours(0,0,0,0); start.setUTCDate(start.getUTCDate()+30);
  for (let i=0; i<50; i++) {
    const date = new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
    const priceQuestions = [`Hva koster en natt ${date}?`, `Hva er prisen for ${date}?`, `Kan jeg få pris på ${date}?`, `Hva koster overnatting ${date}?`, `Hvor mye koster hytta ${date}?`];
    for (const question of priceQuestions) cases.push({ id: `price-${cases.length}`, kind: 'price', date, question });
    const availabilityQuestions = [`Er hytta ledig ${date}?`, `Kan vi booke ${date}?`, `Er det tilgjengelig ${date}?`, `Er datoen ${date} opptatt?`];
    for (const question of availabilityQuestions) cases.push({ id: `availability-${cases.length}`, kind: 'availability', date, occupied: i % 2 === 0, question });
  }
  return cases;
}

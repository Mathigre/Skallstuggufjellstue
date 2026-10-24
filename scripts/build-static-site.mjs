import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const excluded = new Set([
  '.git', '.github', '.vscode', 'node_modules', 'dist', 'database', 'docs',
  'dokumenter', 'supabase', 'functions', 'tests', 'test-fixtures', 'work', 'outputs', 'scribe-prototype',
  'scripts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'old-engine.mjs', 'ocr-test.html', 'preview-server.mjs', 'make-fixtures.cjs',
  'chatbot-knowledge.md',
]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (excluded.has(entry.name) || entry.name.startsWith('.')) continue;
  if (entry.name === 'admin') {
    await cp(path.join(root, entry.name), path.join(output, entry.name), {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(root, source).split(path.sep);
        return !relative.includes('scribe-scanner') && !relative.includes('node_modules');
      },
    });
    continue;
  }
  await cp(path.join(root, entry.name), path.join(output, entry.name), { recursive: true });
}

// Publish the two visitor documents without including their editable source files.
await mkdir(path.join(output, 'dokumenter'), { recursive: true });
for (const name of ['Leiebetingelser_Skallstuggu.pdf', 'Personvern_Skallstuggu.pdf']) {
  const source = path.join(root, 'dokumenter', name);
  const bytes = await readFile(source);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error(`Invalid public PDF: ${name}`);
  await cp(source, path.join(output, 'dokumenter', name));
}

async function addChatWidget(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'admin') await addChatWidget(file, rel);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html') || entry.name === 'admin.html') continue;
    const html = await readFile(file, 'utf8');
    if (html.includes('/chatbot-widget.js') || !html.includes('</body>')) continue;
    await writeFile(file, html.replace('</body>', '  <script src="/chatbot-widget.js" defer></script>\n</body>'));
  }
}

await addChatWidget(output);

// Build a text index from public pages plus the separately maintained chatbot knowledge source.
// The markdown file is not copied as a standalone website page. Each heading becomes its own
// retrieval document so the Worker can select the most relevant material for a visitor question.
async function collectPublicPages(directory, relative = '', pages = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'admin') await collectPublicPages(file, rel, pages); continue; }
    if (!entry.isFile() || !entry.name.endsWith('.html') || entry.name === 'admin.html') continue;
    const html = await readFile(file, 'utf8');
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || rel).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    let plain = html.replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?\s*>|<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
    plain = plain.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 12000);
    if (plain.length > 60) pages.push({ title, path: '/' + rel, text: plain });
  }
  return pages;
}
const publicPages = await collectPublicPages(output);
const knowledgeSource = await readFile(path.join(root, 'chatbot-knowledge.md'), 'utf8');
for (const section of knowledgeSource.split(/^##\s+/m).slice(1)) {
  const [headingLine, ...bodyLines] = section.split('\n');
  const heading = (headingLine || '').trim();
  const text = bodyLines.join('\n').trim();
  if (!heading || text.length < 40 || heading === 'Kilder og vedlikehold' || heading === 'Praktisk sikkerhet for boten') continue;
  const slug = heading.toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-|-$/g, '');
  publicPages.push({
    title: 'Skallstuggu kunnskapsbase: ' + heading,
    path: '/kunnskapskilde/' + slug,
    text: text.slice(0, 12000),
  });
}
await writeFile(path.join(output, 'chatbot-knowledge.json'), JSON.stringify(publicPages), 'utf8');

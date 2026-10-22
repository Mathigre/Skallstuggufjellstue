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

async function addChatWidget(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'admin') await addChatWidget(file, rel);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    if (html.includes('/chatbot-widget.js') || !html.includes('</body>')) continue;
    await writeFile(file, html.replace('</body>', '  <script src="/chatbot-widget.js" defer></script>\n</body>'));
  }
}

await addChatWidget(output);

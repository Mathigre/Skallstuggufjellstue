import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: { process: 'undefined', DISABLE_DOCX_XLSX: 'true' },
  optimizeDeps: { exclude: ['scribe.js-ocr'] },
  worker: { format: 'es' },
  build: { outDir: '../../dist/admin/scribe-scanner', emptyOutDir: true },
});


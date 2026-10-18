# Skallstuggu receipt scanner

This is a standalone browser utility that runs Scribe.js OCR. The admin page sends one receipt `Blob` through a same-origin `postMessage` and receives the recognized text. The scanner has no Supabase or Fiken client, credentials, booking code, or customer data access.

The uploaded receipt stays in the browser. Scribe downloads public OCR language data from jsDelivr on first use; this model download does not include receipt images or text. The returned text is displayed for the administrator to verify against the original.

## Build and publish

From the repository root, run `pnpm install --frozen-lockfile` and `pnpm build`. The build copies public website files to `dist/` and emits the scanner at `dist/admin/scribe-scanner/`.

For Cloudflare Pages, set the build command to `pnpm install --frozen-lockfile && pnpm build` and the build output directory to `dist`. Do not deploy this scanner before both settings are configured and the preview build succeeds.

## License

This separate scanner utility and Scribe.js are offered under GNU AGPL version 3. See `LICENSE`. Other repository directories are not licensed by this subdirectory's notice. Whether a particular deployment counts as a combined program is a legal question; this separation is a technical boundary, not legal advice.


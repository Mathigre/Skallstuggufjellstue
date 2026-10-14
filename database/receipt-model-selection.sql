-- Explicit selection after 2.5 Flash-Lite returned 404 for this project's key.
-- Standard image/text prices checked 2026-10-13:
-- https://ai.google.dev/gemini-api/docs/pricing
-- No automatic fallback. Keep old run price snapshots unchanged.
update public.receipt_settings
set model='gemini-3.1-flash-lite',
    input_usd_per_million=0.25,
    output_usd_per_million=1.50
where id=true;

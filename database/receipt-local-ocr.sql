-- Disable paid Gemini requests; local OCR uses only get/save endpoints.
update public.receipt_settings set enabled=false where id=true;

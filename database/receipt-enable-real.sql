-- Explicitly enabled by owner for local Tesseract; paid AI remains disabled.
update public.receipt_settings set real_documents_enabled=true,enabled=false where id=true;

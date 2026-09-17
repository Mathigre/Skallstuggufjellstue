# Booking prices and Fiken test drafts

New bookings use NOK 14,000/night, 300/linen set, 150/towel and optional 3,000 cleaning per stay, all including 25% VAT. The database calculates the authoritative total. Existing bookings retain their earlier pricing.

Approval creates or updates a draft only in the verified test company apiskallstuggu. Customer name and email are copied to the Fiken contact. No invoice is issued or sent. Editing approved bookings updates the draft; cancellation removes the draft. Already issued invoices must be handled manually in Fiken. Retry via the button on the booking if export fails.

FIKEN_TOKEN stays in Supabase secrets. A separate private test-access code is required once per page session. Only its SHA-256 hash is public. This does not replace the existing admin authentication. Export and lock tables deny anonymous access. A stale processing lock requires manual verification before clearing; uncertain writes are not blindly retried.

Deployment: database/booking-pricing.sql was applied through Supabase migrations; deploy supabase/functions/fiken-booking with JWT verification enabled. Keep the shared pricing modules identical.

Validation: 12 automated tests; browser quote/editor/access-code checks; live test draft created at 31,900, updated to 32,200 using the same draft, then cancelled. Test booking cleaned up; no emails or invoices sent. Existing booking-table RLS/auth weaknesses remain outside this focused change.

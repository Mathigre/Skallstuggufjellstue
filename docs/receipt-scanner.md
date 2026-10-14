# Kvitteringsskanner – utrulling og drift

Ny side: admin/kvitteringer.html. Bruker eksisterende admin_users og Supabase-innlogging.
Originaler ligger privat i kvitteringer, med fem minutters signerte leselenker. Ingen dokumenter sendes til Fiken.

## Utrulling
- Migrasjonen 20261013193727_receipt_scanner er allerede brukt i rbphgvnwmzjeuvyrasvy. Ikke kjør den på nytt. database/receipt-scanner.sql er samme SQL for gjennomgang.
- database/receipt-model-selection.sql velger eksplisitt gemini-3.1-flash-lite med standardpris $0.25 input / $1.50 output per million tokens. Dette er allerede konfigurert i testprosjektet.
- Publiser receipt-analyze med supabase/functions/shared/auth.ts og admin/receipt-data.mjs som avhengigheter. JWT-verifisering skal være aktiv. Funksjonen er publisert i testprosjektet.
- GEMINI_API_KEY er kun en serversecret. SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY er runtime-secrets; ingen av dem skal kopieres til klienten.
- Frontend publiseres først når PR er gjennomgått og merget. Menylenken tilføyes av eksisterende admin-navigation.js.
- CORS standard er https://skallstuggu-test.no; endre RECEIPT_ALLOWED_ORIGIN ved domeneflytting.
- Testmodus er aktiv: real_documents_enabled=false. Bruk bare syntetiske dokumenter til avtaler, behandling hos Google, lagring og tilgang er avklart. Aktivering av ekte bilag er en eksplisitt driftsbeslutning.

## Kontroll og kostnad
10 forsøk/admin/dag og 20 totalt/dag, Europe/Oslo. Atomisk SQL-reservasjon før generateContent.
Feil og tidsavbrudd teller også; ingen automatisk retry eller modellfallback. Ny analyse krever uttrykkelig bekreftelse.
Maks10MB original, PDF1–3 sider, output4096 tokens. Store bilder får en mindre analysekopi når nettleseren støtter dekoding; originalen beholdes.
Pris og modell lagres per forsøk. Manglende tokenrapport gir ukjent kostnad, ikke null.
2.5 Flash-Lite ble prøvd først og ga404 for prosjektet. 3.1 ble valgt etter pris-/modellkontroll:
https://ai.google.dev/gemini-api/docs/pricing
https://ai.google.dev/gemini-api/docs/deprecations/
Modelloversikten bekrefter ikke at generering/betaling er tilgjengelig. HTTP402 vises som betalingsproblem.
Kategori/konto er bare forslag. MVA valideres i øre, med0.02 toleranse og eget avrundingsfelt. Manuell kontroll kreves.
AI-data og kontrollert data lagres separat. Ny analyse overskriver ikke manuelle rettelser.
Avbrutte forsøk kan frigjøres manuelt etter5min uten nytt AI-kall.

## Lagring og gjenoppretting
Sletting flytter til papirkurv og beholder originalen. Ingen automatisk fysisk sletting.
Et mislykket DB-innslag etter vellykket filopplasting kan etterlate en foreldreløs fil. Rydd bare etter kontroll mot original_path/analysis_path og sikkerhetskopi.
Sett opp separat sikkerhetskopi av både database og Storage-objekter før ordinær regnskapsbruk. DB-backup alene dekker ikke originalfilene.
Ved deaktivering: sett receipt_settings.enabled=false for å stoppe nye analyser; behold tabeller/bucket og historikk.

## Test
Node24 + pdf-lib1.17.1. Sett RECEIPT_TEST_MODULES til node_modules som inneholder pdf-lib og kjør:
node --test tests/receipt-data.test.mjs tests/receipt-edge.test.mjs
19 tester bestått: auth, feil/timeout/402/429 uten retry, faktiske bytes i API-request, tokenberegning, ukjente verdier, blandet MVA, avrunding og godkjenningskrav.
tests/receipt-database.sql kjører i transaksjon med rollback og er testet før live-kall: privat bucket, grants, busy/reanalyse, revisjoner,10/20-kvoter, redigering, papirkurv og kostnad. Krever tom analysehistorikk for gjeldende dag.
UI bekreftet admininnlogging, PNG-opplasting, privat forhåndsvisning og avvisning av PDF på4 sider.
Kamera på fysisk telefon, HEIC på iPhone, full mobil/desktop-layout og booking/e-post/Fiken-regresjon er ikke ferdig gjennomtestet. Eksisterende booking-/mail-/Fiken-kode er ikke endret.
Supabase advisor: ingen nye sikkerhetsadvarsler; INFO om manglende RLS-policy er tilsiktet for server-only-tabellene. Eksisterende advarsel om leaked password protection er uendret.

# Lokal kvitteringsskanner med Tesseract

## Nåværende løsning
Tesseract.js6.0.1 med norsk+engelsk leser på brukerens enhet. PDF.js4.10.38 rasteriserer opptil3 sider. Ingen kvitteringsdata sendes til Google eller OCR-leverandør; biblioteker/modeller hentes fra jsDelivr og projectnaptha. Originaler og lagrede rettelser ligger privat i Supabase.

Knappen «Les tekst gratis» henter originalen med tidsbegrenset signert URL. OCR-forslag vises som ulagret utkast. Bare eksplisitte datoer og merkede total/netto/MVA-beløp fylles ut; tvetydige verdier blir null. Leverandør, MVA-fordeling, varelinjer og regnskapskonto kontrolleres/fylles manuelt. Lest tekst vises separat; opptil1750 tegn blir med i notatfeltet ved lagring. Originalen bevares alltid.

## Aktivering
Frontend ligger i PR9, ikke publisert. Eksisterende innlogging og adminmeny gjenbrukes. Migrasjon20261013193727_receipt_scanner og receipt-analyze-backend er allerede publisert i testprosjektet. Ikke kjør migrasjonen på nytt.
Kjør database/receipt-local-ocr.sql etter tidligere modellkonfigurasjon ved nye installasjoner. Dette er allerede gjort i testprosjektet: enabled=false sperrer betalte Gemini-kall server-side, også fra eldre faner. Den gamle API-ruten beholdes for arkiv/get/save, men klienten kaller aldri analyze/model. Ingen ny secret trengs. real_documents_enabled er fortsatt false under utprøving.

## Begrensninger
Gratis tekstlesing er ingen garanti for korrekt regnskap. Mobilhastighet/bildekvalitet varierer. HEIC kan lagres, men OCR krever at nettleseren dekoder formatet; ved feil må brukeren velge JPG/PNG. PDF støttes gjennom lokal rasterisering. Maks10MB original,3 PDF-sider,120sek OCR,60MP kildebilde og12MP arbeidsbilde. Første bruk trenger nett til modellnedlasting. Supabase-lagring/trafikk følger abonnementet.

## Sikkerhet og arkiv
Admin verifiseres på serveren. RLS og grants hindrer direkte klienttilgang; originaler har5min leselenker. Manuell godkjenning kreves. Papirkurv beholder originaler og tillater gjenoppretting. Ta separat backup av database og Storage før ordinær bruk. Ingen Fiken-oversending er implementert.

## Tester
24 Node-tester bestått: OCR-feltparsing, tvetydige beløp/datoer, MVA, avrunding, auth, API-feil og tidligere kostnadssperrer. Kjør Node24 med pdf-lib1.17.1 tilgjengelig via RECEIPT_TEST_MODULES:
node --test tests/receipt-*.test.mjs
SQL-integrasjonstestene fra første versjon bestod med rollback. De krever aktivert AI-testkonfigurasjon og tom dagslogg; skal ikke kjøres uendret mot den deaktiverte live-konfigurasjonen.
Fysisk mobilkamera/HEIC er ikke verifisert på alle enheter.

Nettlesertest 2026-10-14: faktisk Tesseract på syntetisk PNG leste 2026-10-13, NOK, netto200, MVA40 og total240 korrekt. Utkast lagret i Supabase og åpnet igjen med samme verdier. Antall Gemini-kall forble3 (alle fra tidligere tester). PDF-rasterisering og fysisk mobil/HEIC må fortsatt verifiseres praktisk.

## Publisering 2026-10-14
Eier har bedt om publisering og ekte bilag. real_documents_enabled=true; enabled=false (betalt Gemini fortsatt sperret). Syntetiske testbilag er flyttet til papirkurven. Varsler pauser serverlevering ved utlogging, men beholder nettleserabonnementet for automatisk gjenopptak ved neste innlogging. Deaktiver-knappen avslutter abonnementet. Ny test tests/push-logout.test.mjs verifiserer dette uten nye tillatelsesforespørsler.

## Fiken-eksport i utviklingsbranchen (15. oktober 2026)
Egen `fiken-receipt` Edge Function oppretter bare kjøps**utkast** via `POST /purchases/drafts` i bekreftet testforetak `apiskallstuggu`. Kvitteringen vedlegges via `POST /purchases/drafts/{draftId}/attachments`. Ingen postering, betalingsregistrering eller sending til ekte foretak utføres. Bare administratorer og eksplisitt syntetiske kvitteringer med status "kontrollert" kan eksporteres. Kostnadskonto må være kontrollert (fire siffer); NOK og eksplisitt MVA-fordeling (0/12/15/25 %) kreves. Utslagsgivende avrunding må rettes manuelt.
Eksportloggen `receipt_fiken_exports` har en unik nøkkel per kvittering og reserveres atomisk i `receipt_fiken_claim`. En usikker sending kan ikke gjentas automatisk. `fiken_test_lock` deles med bookingutkastene (Fiken tillater kun én samtidig API-forespørsel).
Originalfilen blir liggende privat i Supabase. JPG/PNG/PDF kan legges ved. HEIC krever en tilgjengelig konvertert JPG-analysekopi.
Sikkerhetsvalg: Testbilag skal ikke inneholde ekte leverandør-/personopplysninger. Kontroller alltid utkastet og vedlegget i Fiken. Eksport av ekte bilag og eventuell automatisk bokføring er ikke aktivert.
Database: migrasjonen `receipt_fiken_export_test_drafts` er lagt inn i Skallstuggu Supabase; kilde: `database/receipt-fiken-export.sql`. Frontendendringene ligger i PR #9 og må gjennomgås før publisering.

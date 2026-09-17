# Redigering og avbestilling av bookinger

## Endringen

På `/admin/admin.html` åpner eier et eksisterende bookingkort og velger **Rediger booking** eller **Avbestill booking**. Layout, manuell booking, fakturaopplasting og kundesamtaler beholdes.

Redigering gjelder navn, e-post, telefon og datoer. Betalingsstatus, faktura og kundens melding endres ikke. Godkjente bookinger kontrolleres mot ferske godkjente reservasjoner før datoer lagres. Datoene kan møtes på utsjekksdagen. Et skjema med foreldede opplysninger får ikke overskrive en annen endring.

Avbestilling setter eksisterende `status` til `rejected` og fyller ut `cancelled_at`. Dermed virker dagens kalenderfiltrering og eksisterende statusbegrensninger fortsatt. Admin og «Sjekk mine bookinger» viser **Avbestilt**, mens arkivet heter **Avslåtte / avbestilte**. Ingen booking, faktura eller samtale slettes permanent.

En egen Edge Function sender avbestillingsmail til adressen som er lagret på bookingen. Eksisterende `resend-email` og dens e-posttyper erstattes ikke. E-posten omtaler ikke refusjon som gjennomført. `cancellation_email_sent_at` betyr at Resend har godtatt sendingen, ikke at mottakeren har lest eller mottatt den i innboksen.

## Før nettsideendringen publiseres

1. Kjør `supabase/migrations/202609170001_booking_cancellation.sql` i SQL Editor i riktig Supabase-prosjekt. Den legger til tre nullable felt og en trigger som hindrer at gamle admin-faner redigerer eller reaktiverer avbestilte bookinger. Eksisterende rader, RLS og tillatelser beholdes.
2. Opprett Edge Function **booking-cancellation-email** i Supabase. Bruk hele `supabase/functions/booking-cancellation-email/index.ts` som `index.ts`. Behold JWT-verifisering på. Funksjonen trenger ingen eksterne imports.
3. Legg den nye Resend-nøkkelen i Supabase Edge Function Secrets som **RESEND_API_KEY**. `SUPABASE_URL` og `SUPABASE_ANON_KEY` er standard miljøverdier i Supabase. Ikke legg Resend-nøkkelen i nettleserkoden eller GitHub.
4. Nøkkelen som ble delt under arbeidet må roteres. Før den gamle nøkkelen slettes, oppdater også den eksisterende `resend-email`: erstatt den hardkodede nøkkelverdien med `Deno.env.get("RESEND_API_KEY")`, og avvis sending dersom verdien mangler. Behold øvrig funksjonskode. Dermed fortsetter vanlige bekreftelser og svar å virke med ny nøkkel.
5. Publiser Edge Function først, og deretter nettsidefilene. Det er ikke nok å slå sammen GitHub-endringen for å installere SQL eller Edge Function.
6. Bruk en avtalt testbooking og en e-postadresse dere kontrollerer for siste ende-til-ende-kontroll: rediger, avbestill, se at begge kalendere frigjør datoene, og kontroller mailen. Ikke bruk en ekte kundebooking som test.

## Feil og nytt sendeforsøk

Avbestillingen lagres før mailen sendes. En e-postfeil reserverer derfor ikke datoene på nytt. Arkivet viser **Prøv avbestillingsmail igjen** også etter omlasting hvis sendingen ikke er bekreftet.

Samme avbestilling bruker samme Resend-idempotensnøkkel og uendret meldingsinnhold. Etter 23 timer fra første forsøk stopper funksjonen nye forsøk og ber eier kontrollere Resend. Resend beholder slike nøkler i 24 timer; den ekstra timen er en sikkerhetsmargin. Ved et gammelt usikkert forsøk: finn sendingen i Resend før sendestatus eventuelt rettes i databasen. Ikke nullstill felter eller send på nytt uten å kontrollere dette.

## Verifisering og avgrensninger

Kjør `node --test tests/booking-management.test.mjs` med Node 24. Testene bruker falske bookinger og et simulert e-postsystem. Ingen virkelige bookinger endres, og ingen kundemail sendes av testene.

Lokal nettleserkontroll med simulerte data dekker redigeringsdialog, lagring, mobilbredde, avbestilling, kalender og sendefeil. SQL-migreringen og funksjonen må fortsatt verifiseres mot det faktiske Supabase-oppsettet før sammenslåing. RLS-reglene, eventuelle eksisterende triggere og leveranse gjennom Resend er ikke tilgjengelige i dette repositoriet.

Prosjektet bruker i dag en kodekontroll i nettleseren og en offentlig Supabase-anon-nøkkel. Dette er ikke serververifisert eierinnlogging. Funksjonen bruker samme databasekontekst som innringeren, uten service-role eller nye RLS-unntak. Kontroller at faktiske RLS-regler begrenser oppdateringer til eier før produksjonsbruk; frontendens passordskjerm alene gir ikke dette vernet.

Overlapp kontrolleres med ferske data før redigering, men er ikke en databasegaranti mot to helt samtidige bestillinger. Eksisterende godkjenning/manuell booking har samme begrensning. En eventuell databasebegrensning må vurderes mot eksisterende bookingdata separat.

Referanser: [Supabase – RLS i Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Resend – idempotensnøkler](https://resend.com/changelog/idempotency-keys).

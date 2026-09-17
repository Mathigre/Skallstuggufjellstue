# Sesongpriser og Fiken-test

Grunnpris er 9 000 kr søndag–torsdag og 14 000 kr fredag–lørdag, inkludert 25 % mva. Nattens startdato bestemmer satsen; avreisedagen belastes ikke. Sesonger overstyrer grunnpris og kan ikke overlappe. Hver sesongs sluttdato er inklusive. Periodene gjentas ikke automatisk neste år.

Startforslag: høstferie 10 000 / 15 000 kr, vinterferie og sommer 11 000 / 16 000 kr, påske og jul/nyttår 14 000 / 18 000 kr (hverdag/helg). Datoene er brede ferieperioder, ikke en offisiell skolerute. Eieren kan endre dem på admin/priser.html. Satsene er forslag, ikke dokumenterte lokale markedspriser. Sommervektingen støttes av [SSBs overnattingsstatistikk](https://www.ssb.no/transport-og-reiseliv/reiseliv/statistikk/overnattingar/artikler/rekordmange-overnattingar-i-juli-ved-norske-overnattingsbedrifter).

Nye bookinger lagrer en databasegenerert kopi av prisoppsettet. Senere prisendringer påvirker ikke disse. Endres datoer på en eksisterende booking, beregnes nettene ut fra dens opprinnelige prisoppsett. Eldre fastprisbookinger beholder 14 000 kr/natt. Gamle bufrede skjemaer uten prisversjon beholder også tidligere tilbudt fastpris. Ved endrede priser etter at et nytt skjema ble lastet, avvises innsending og kunden bes laste siden på nytt.

Prisoppsett er offentlig lesbart med RLS; bare serveren kan skrive etter kontroll av privat testkode. API-et bruker forventet revisjon for å unngå overskriving mellom to adminfaner. Service-role og FIKEN_TOKEN eksponeres ikke. Eksisterende bookingtabell/admin-autentisering er ikke bygget om.

Godkjenning og manuell booking oppretter kunde og utkast i apiskallstuggu. Kundens e-post brukes som kontaktens faktura-e-post. Utkast blir oppdatert ved endring og slettet ved avbestilling. Ingen Fiken-faktura utstedes eller sendes automatisk. API-et kontrollerer fortsatt at foretaket er et testforetak. Ved feil brukes Fiken-knappen på bookingen for å prøve igjen.

Deploy: database/season-pricing.sql (Supabase-migrasjoner seasonal_booking_prices_and_snapshots og preserve_quotes_from_cached_booking_forms), oppdatert fiken-booking og ny pricing-admin. JWT-verifisering er på for begge. De tre kopiene av pricing.mjs må være identiske.

Verifisering: 18 automatiske tester, nettlesertest av prisberegning/godkjenning/prisredigering/mobil, transaksjonstest av databaseberegning og låst prisavtale, offentlig lesetilgang og sperret anonym skriving. Ekte Fiken-testutkast på 49 900 kr ble opprettet og fjernet; testbookingen er slettet. Ingen test-e-post eller ferdig faktura ble sendt.

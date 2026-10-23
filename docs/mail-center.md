# Mail og kontaktskjema

## Det eier får

- Kontaktskjema krever fullt navn, e-post, telefon og spørsmål. Meldingen lagres før varsling/e-post forsøkes.
- «Mail» i admin med Nye (uleste), Ubesvarte, Besvarte og Alle, søk, samtalehistorikk og svarfelt.
- En ny innkommende melding gjør samtalen ubesvart igjen. Et svar som bare er i sendekø eller feiler, gjør den ikke besvart. En ny melding som kommer mens et svar sendes, beholdes som ubesvart.
- Push på de samme registrerte enhetene som for bookingvarsler. Varsler inneholder ikke navn eller meldingstekst på låseskjermen. Klikk åpner riktig samtale, også via innlogging.
- Avsenderens vedlegg beholdes i Gmail; admin viser navn og lenke til originalen. Ved svært lange e-poster vises et utdrag med tydelig beskjed om å åpne originalen. Ingen HTML fra e-post kjøres i admin, og eksterne sporingsbilder lastes ikke.

**Testmodus er låst på serveren:** e-post fra denne nye løsningen, også prøvesvar, sendes bare til `minsten.mg@gmail.com`. Den tiltenkte kundeadressen vises i admin og i prøvesvaret. Testmodus må endres bevisst i backend før ordinær bruk; det finnes ingen offentlig parameter som kan omgå den.

## Førstegangsoppsett for Gmail

ChatGPTs Gmail-tilkobling gir ikke nettsiden en varig Gmail-fullmakt. Nettsiden bruker derfor egen Google OAuth-tilkobling med bare `gmail.readonly`. Den sletter, arkiverer eller markerer ikke meldinger som lest i Gmail. Svar fra admin sendes med eksisterende Resend-oppsett; svar sendt direkte fra Gmail leses inn som utgående meldinger og påvirker besvart-status.

1. Opprett/velg et prosjekt i https://console.cloud.google.com/ og aktiver **Gmail API**.
2. Konfigurer Google Auth Platform/OAuth-samtykke. Legg `minsten.mg@gmail.com` til som testbruker dersom appen er i ekstern testmodus. Legg til scopet `https://www.googleapis.com/auth/gmail.readonly`.
3. Opprett OAuth-klient av typen **Web application**.
4. Legg til nøyaktig denne autoriserte redirect-URI-en:

   `https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/mail-center/oauth/callback`

5. I Supabase-prosjektets Edge Functions → Secrets: legg klient-ID som `GOOGLE_MAIL_CLIENT_ID` og klienthemmelighet som `GOOGLE_MAIL_CLIENT_SECRET`. Ikke legg hemmeligheten i GitHub, JavaScript eller chatten. Backend bruker prosjektets eksisterende `RESEND_API_KEY`, `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY`.
6. Gå til https://skallstuggu-test.no/admin/mail.html, logg inn og velg **Koble til Gmail**. Bruk bare `minsten.mg@gmail.com` og godkjenn tilgangen. Andre Gmail-kontoer blir avvist.
7. Bekreft at tilkoblingen er aktiv, og at «Sist synkronisert» oppdateres. Historikken importeres i sider à 25 meldinger. I importperioden vises at oversikten ikke er komplett. Nye meldinger undersøkes separat underveis. Spam/papirkurv tas også med; Gmail-utkast er ikke mottatt e-post og importeres ikke.

Google kan la refresh tokens for en ekstern OAuth-app i testmodus utløpe etter sju dager. Da vises synkfeilen, og kontoen må godkjennes på nytt. Før permanent drift må riktig driftsadresse, Google-samtykke/verifisering og behandling av personopplysninger avklares. Ikke lov kontinuerlig import bare fordi førstegangstesten virket.

## Drift og feil

Databasen har private tabeller `mail_threads`, `mail_messages`, `mail_jobs`, `mail_connection` og `mail_oauth_states`. RLS er aktivert. Kunder kan ikke lese innboksen eller skrive direkte til tabellene. Admin må autentiseres og finnes i `admin_users`. Token-/køtabeller er stengt for klienttilgang; bare service-role benyttes. OAuth-refresh-token lagres kryptert i Vault. CSRF-state er engangsbruk med ti minutters levetid, og PKCE brukes.

Cron `skallstuggu-mail-every-minute` kaller `mail-center` omtrent hvert minutt, med et eget tilfeldig token i Vault. Funksjonen har JWT-gatewaykontroll avslått fordi den også tar imot offentlige skjema og OAuth-callback; innholdet håndhever separat admin-, cron- og skjematilgang. En offentlig anon-nøkkel er ikke nok til private handlinger.

E-postvarsler og svar ligger i en varig outbox. Resend-sendinger bruker en stabil idempotensnøkkel ved ny sending etter nettverksfeil, med begrenset retry-vindu. Etter gjentatte feil markeres sendingen mislykket i admin; ingenting slettes. En operatør må kontrollere providerhistorikken før eldre, usikre sendinger sendes på nytt.

Gmail-history-cursor avanseres først etter at de aktuelle meldingene er lagret. Delvis gjennomført paginering beholdes. Ved utløpt history-ID kjøres ny full gjennomgang. Meldinger slettet i Gmail sletter ikke historikken i admin. Tilkoblingsfeil, forsinket synk og mislykkede køjobber vises i Mail.

Av sikkerhetshensyn er dette ikke en garanti for at e-postleverandøren aldri mister eller avviser en e-post. Oppfølging krever at Gmail-tilkoblingen er aktiv, at e-postene faktisk mottas der, og at feilvarsler følges opp. E-post til andre adresser, som `post@skallstuggu.no`, omfattes ikke automatisk før den adressen videresendes eller kobles til.

## Validering

- `node tests/mail-center.test.mjs`: kontaktvalidering, MIME/Unicode, paginering, gjenopptakelse, utløpt historikk og låsing.
- `node tests/mail-delivery.test.mjs`: testmottaker, provider-idempotens, feil ved sending og sperret privat API. Sender ingen faktisk e-post.
- `tests/mail-center.sql`: faktisk database, i én transaksjon som rulles tilbake; sjekker atomisk lagring, duplikater, ny melding under utsending og rettigheter. Ingen testbooking eller testmail beholdes.
- Eksisterende chatbot-regresjon og relevante innloggings-/push-tester skal fortsatt bestå.

## Valgt mønster og kilder

Løsningen følger delte innbokser: egne køer, samlet samtalehistorikk og gjenåpning ved nytt kundesvar. Den bruker ikke et vanlig `mailto:`-skjema, som verken sikrer lagring eller fanger direkte e-post.

- Help Scout, kontakt fra både skjema og e-post: https://www.helpscout.com/blog/help-scout-channels/
- Front, status og gjenåpning ved kundesvar: https://help.front.com/en/articles/1300288
- Gmail, full og delvis synkronisering: https://developers.google.com/workspace/gmail/api/guides/sync
- Google OAuth for serverapper: https://developers.google.com/identity/protocols/oauth2/web-server
- Supabase, Vault og planlagte Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Resend API: https://resend.com/docs/api-reference/emails/send-email

## Automatisk mottaksbekreftelse
Nye kontaktskjemaer køer både eiervarsel og en separat mottaksbekreftelse via Resend. Bekreftelsen takker for henvendelsen uten å love svartid og markerer ikke samtalen som besvart. I testmodus går også bekreftelsen bare til minsten.mg@gmail.com; den tiltenkte mottakeren står i teksten. Eksisterende henvendelser får ikke etterutsendt bekreftelse. Etter grunnskjemaet kjøres database/mail-contact-acknowledgement.sql.

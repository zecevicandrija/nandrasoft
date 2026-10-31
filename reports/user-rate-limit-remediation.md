# Ograničavanje zahteva po korisniku — 31.10.2026.

## Izmena

Globalna IP kvota od 3.000 zahteva na 15 minuta uklonjena je sa poslovnih
API ruta. `lib/rateLimiting.js` sada primenjuje tu kvotu **po korisničkom
ID-ju iz proverene sesije**. Radnici iza iste WiFi/NAT adrese ne dele
brojač. Jedan nalog deli svoju kvotu između uređaja, IP adresa i poslovnih
API ruta; promena IP-ja ne resetuje njegov brojač.

Redosled u `index.js` je:

1. Health i odbijanje novog rada tokom gašenja.
2. IP limiter javne prijave/registracije i Better Auth handler.
3. Provera sesije, pa korisnički limiter za preostale `/api` rute.
4. JSON parser i postojeći poslovni routeri sa proverama uloga.

Identitet ne dolazi iz tela, query parametara ili zaglavlja `X-User-ID`.
Neprijavljeni zahtevi dobijaju 401, a deaktivirani nalozi 403 pre
korisničkog brojanja. `requireAuth` i dalje proverava sesiju u bazi bez
cookie cache-a, a privatni request-scoped marker sprečava duplu proveru
istog HTTP zahteva u glavnom middleware-u i routeru. Provera u novom
zahtevu se ponavlja; sesije se ne keširaju između zahteva.

## Javna prijava i Better Auth

Prijava i registracija dele IP kvotu od **60 neuspešnih pokušaja na
15 minuta**. Uspešni odgovori se uklanjaju iz brojača. Zahtevi koji su
još u toku privremeno se broje do završetka odgovora, što je ponašanje
`skipSuccessfulRequests`. Proveren je i istovremeni nalet 50 uspešnih
prijava sa iste IP adrese.

U instaliranom Better Auth-u pronađeno je dodatno produkciono pravilo
od 3 zahteva na 10 sekundi za prijavu/registraciju, koje broji i uspehe.
Za ove putanje isključeno je kroz `customRules`, jer ih štiti Express
limiter. Isključena je i njegova IP kvota za `/get-session`, kako redovne
provere sesije ne bi delile NAT kvotu. Ostala Better Auth pravila,
uključujući osetljive auth operacije, ostaju na snazi.

`/api/health` je izuzet iz korisničkih i login kvota. Odgovori 429 imaju
razumljivu JSON poruku, standardna rate-limit zaglavlja i `Retry-After`.

Store ostaje procesni memorijski store iz `express-rate-limit`, bez
novih servisa ili migracija. Kvota se resetuje pri restartu procesa i
važi zasebno po procesu ako se pokreće više instanci. Postojeće
`trust proxy: 1` ostaje nepromenjeno; IP login kvota koristi Express-ov
obračun adrese prema toj konfiguraciji.

## Verifikacija

`npm.cmd run test:rate-limits` proverava stvarni Express HTTP lanac sa
malim test kvotama i stvarni Better Auth handler u produkcionom režimu
limitera sa memorijskim test korisnikom. Testovi pokrivaju:

- 50 radnika sa iste IP adrese i izolaciju njihovih kvota;
- istu korisničku kvotu na različitim rutama i IP adresama;
- odbijanje lažiranog identiteta i deaktiviranih naloga;
- jednu proveru sesije po poslovnom zahtevu;
- uspešne prijave, strogu zajedničku kvotu neuspeha i nalet 50 prijava;
- izuzeće health/session provera i uklanjanje dodatnog NAT limita
  u Better Auth-u;
- postojeće auth regresije za privilegije, deaktivaciju i opoziv sesija.

Testovi ne menjaju poslovne podatke u bazi.

# OPS-005 / OPS-002 — jutarnje prijave i prekid health SQL-a

## Prijavljivanje radnika

`createLoginLimiter` sada podrazumevano koristi 150 zahteva / 5 minuta po IP
adresi. `skipSuccessfulRequests` ostaje uključen. Paralelni uspešni zahtevi
privremeno zauzimaju korpu dok se ne završe; zato raniji limit od 60 nije
pokrivao nalet od 100 zahteva, iako sekvencijalne uspešne prijave jesu prolazile.

Odvojeni `createAccountLoginLimiter` dozvoljava 5 neuspešnih pokušaja / 15
minuta za isti normalizovani email. Pokušaj posle pet promašaja dobija 429
i Retry-After. Normalizacija uklanja rubne razmake i ne razlikuje velika i
mala slova, a promena IP adrese ne resetuje nalog. Ključ sadrži SHA-256
email-a, ne njegovu čitljivu vrednost. Drugi nalozi sa iste IP adrese imaju
odvojene korpe. Neispravni zahtevi bez email-a koriste zaseban IPv4/IPv6 IP ključ.

Šira IP korpa i dalje ograničava pokušaje raspoređene na više email adresa.
Obe korpe dele sign-in i sign-up putanje; javna registracija u produkcionom
Better Auth podešavanju ostaje isključena. Get-session i postojeći limiter
prijavljenih korisnika nisu promenjeni.

IP limiter se izvršava pre parsiranja. Samo sign-in/sign-up rute imaju
ograničen JSON/urlencoded parser od 16 KB radi određivanja email ključa.
Instalirani Better Call Node adapter podržava prosleđivanje parsiranog
`req.body`; stvarni HTTP test sa Better Auth-om to potvrđuje. Ostale auth
rute zadržavaju sopstveno parsiranje.

Limiti važe u okviru podešenog store-a. Podrazumevani MemoryStore je lokalni
procesu, kao i ranije; više server procesa zahteva zajednički store.

## Health provera

Raniji Promise.race je ograničavao vreme HTTP odgovora, ali nije prekidao
SQL u PostgreSQL-u. Novi `runDatabaseProbe` koristi postojeći Prisma pool i
kratku transakciju sa `maxWait` i `timeout` od 2000 ms. Ne otvara novu pulu.

U transakciji se postavlja lokalni `statement_timeout` prema preostalom
budžetu i izvršava SELECT 1. PostgreSQL otkazuje spor upit; vrednost ne
ostaje uključena za poslovne upite nakon završetka transakcije. Ako čekanje
na konekciju ili podešavanje već potroši budžet, SELECT 1 se ne pokreće.

HTTP provera i dalje ima dvosekundni rok, vraća 503 pri timeout-u ili grešci,
ne otkriva interne greške i ostaje nedostupna tokom gašenja. Preklopljene
provere dele jednu SQL operaciju; dok se ona završava/otkazuje ne stvaraju
neograničen red novih upita.

## Verifikacija

Uz `TEST_ASSIGNMENT_DB=1` pokrenuto je:

`node --test --test-force-exit tests/rate-limiting.test.js tests/server-lifecycle.test.js tests/database-pool.test.js`

Svih 24 testa prolazi, bez preskakanja. Provereno je:

- 100 i 150 paralelnih uspešnih login zahteva sa iste IP adrese;
- tačno 150 mesta u korpi i 429 za 151. istovremeni zahtev, uz petominutni rok;
- pet pogrešnih lozinki, blokada istog email-a i posle promene IP/case-a,
  i uspešna prijava kolege sa iste mreže;
- više od pet uzastopnih uspešnih prijava i ispravno prosleđivanje tela kroz
  stvarni Better Auth Node handler;
- HTTP timeout, deljenje probe, preskakanje zakasnelog SQL-a i gašenje servera;
- stvarni PostgreSQL `pg_sleep(10)` otkazan posle oko dve sekunde sa kodom
  57014, odsustvo nastavka tog SQL-a i sledeća uspešna health provera;
- postojeća veličina zajedničke pule i oporavak posle iscrpljenih konekcija.

Širi pokušaj uključio je i `tests/auth-role.test.js`, gde četiri postojeće
provere ne prolaze zbog zastarelih fixture-a: javni signup je u produkciji
isključen, a provisioniranje korisnika sada direktno koristi transakcijske
`tx.user.create` i `tx.account.create`, koje stari mock ne sadrži. Ti testovi
i produkciono provisioniranje nisu menjani ovim zadatkom. Ne tvrdi se da
ceo backend test skup prolazi.

Referentna dokumentacija:
[express-rate-limit konfiguracija](https://github.com/express-rate-limit/express-rate-limit)
i [PostgreSQL statement_timeout](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-STATEMENT-TIMEOUT).

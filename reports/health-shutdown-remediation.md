# Provera baze i uredno gašenje servera — 31.10.2026.

## Nalaz i izmena

Health ruta je vraćala samo timestamp. Osnovno rukovanje `SIGTERM` i
`SIGINT` već je postojalo u `lib/shutdown.js`; ono je dopunjeno i
provereno kroz stvarni HTTP server.

`GET /api/health` sada koristi `SELECT 1` kroz zajednički Prisma pool:

| Uslov | HTTP | Odgovor |
| --- | --- | --- |
| Baza odgovara | 200 | `status: "ok", database: "up"` |
| Greška baze | 503 | `status: "unavailable", database: "down"` |
| Provera traje duže od 2 s | 503 | `status: "unavailable", database: "timeout"` |
| Gašenje je počelo | 503 | `status: "shutting_down"` |

Timestamp ostaje u svim health odgovorima. Odgovori imaju
`Cache-Control: no-store`, ne otkrivaju interne greške ili kredencijale
i ne zavise od globalne kvote aplikacionog rate limitera. Ovo je provera
spremnosti aplikacije za rad sa bazom, a ne samo života Node procesa.

Paralelne provere dele jedan nezavršen DB upit. HTTP timeout ne otkazuje
Prisma upit koji već čeka/radi; sledeće provere ga ponovo koriste dok se
ne završi, sprečavajući gomilanje DB zahteva tokom prekida. Uspešan oporavak
ponovo omogućava status 200. Ako gašenje počne tokom provere, ona više
ne može da vrati spremnost 200.

## Redosled gašenja

Na prvi `SIGTERM` ili `SIGINT` server:

1. Označi da gašenje traje i zaustavi zakazivanje storage monitora.
2. Zaustavi prihvatanje novih konekcija. Novi aplikacioni zahtevi koji
   ipak stignu postojećom konekcijom dobijaju 503 i `Connection: close`.
3. Sačeka aktivne HTTP odgovore; zatvara idle keep-alive konekcije, kao
   i konekcije koje postanu idle posle završetka odgovora.
4. Tek nakon HTTP drain-a pozove `prisma.$disconnect()`, pa izađe kodom 0.

Ponovljeni signali ne pokreću novo gašenje niti uklanjaju zaštitu od
podrazumevanog prekida procesa. Greška zatvaranja daje izlazni kod 1.
Ako HTTP zahtevi ili zatvaranje baze ne završe na vreme, server zatvara
preostale HTTP konekcije i prinudno izlazi kodom 1.

Podrazumevani ukupni rok je **30.000 ms**, podesiv pozitivnim celim
brojem kroz `SHUTDOWN_TIMEOUT_MS`. Rok obuhvata i zatvaranje baze.
Procesni menadžer/kontejner treba da dozvoli duži rok od ovog pre svog
prinudnog gašenja. `SIGKILL`, pad sistema i istek roka ne mogu da garantuju
završetak aktivnih zahteva.

`package.json` dobija produkcioni `start` (`node index.js`) i
`test:lifecycle`. Za produkciju koristiti procesni menadžer koji šalje
signal Node procesu i prati HTTP status health rute.

## Provera

`npm.cmd run test:lifecycle` proverava ispravan SQL, prekid i timeout baze,
objedinjavanje paralelnih provera, stanje gašenja, odbijanje novog rada,
redosled završetka stvarnog HTTP zahteva pre disconnect-a, ponovljene
signale, grešku disconnect-a i krajnji rok za zaglavljene zahteve/pool.

`$env:TEST_ASSIGNMENT_DB = '1'; npm.cmd run test:lifecycle` dodatno
proverava `SELECT 1` kroz stvarni Prisma pool i postojeći test oporavka
iscrpljenog PostgreSQL pool-a. Ove DB provere ne menjaju poslovne podatke.

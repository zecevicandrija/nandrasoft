# Zajednički pool i broj backend procesa — 30.10.2026.

`routes/auth.js` više ne pravi zaseban Prisma klijent/pool. Better Auth i
poslovne rute koriste jedan `prisma` iz `lib/prisma.js`. Instalirani
`@prisma/adapter-pg` poseduje pool i zatvara ga pri `$disconnect()`.

## Podešavanje

`lib/databaseConfig.js` daje sledeće vrednosti:

- `max: 8` po procesu, promenljivo preko `DB_POOL_MAX` od 1 do 10.
- `connectionTimeoutMillis: 5000`: konačno čekanje na otvaranje ili dobijanje
  konekcije iz zauzetog pool-a.
- `idleTimeoutMillis: 10000`: otpuštanje neaktivnih konekcija.
- `application_name: nandra-backend-<pid>` za identifikaciju u PostgreSQL-u.
- Prisma transakcije imaju `maxWait: 5000`; pojedini poslovni tokovi već
  definišu sopstveno trajanje transakcije.

Pool konekcije otvara po potrebi: 8 je gornja granica, ne stalni broj.
Timeout dobijanja konekcije ne ograničava vreme već pokrenutog SQL upita.
Neispravna konfiguracija ne pokreće aplikaciju sa neograničenim pool-om.
Greške neaktivnih konekcija beleže se bez connection string-a ili lozinke.

Prvobitni predlog `12` nije izabran jer dva procesa sa po 12 mogu zauzeti 24
od navedenih 25 konekcija, ostavljajući samo jednu, umesto najmanje pet.
Gornja dozvoljena vrednost 10 ostavlja pet pri dva ukupno aktivna procesa.
Za tri ili više procesa mora se dodatno smanjiti pool.

## VPS: početna preporuka je jedna instanca

Za VPS sa 2 vCPU, 4 GB RAM i SSD diskom, početna preporuka je jedan backend
proces sa `DB_POOL_MAX=8`, uz nadzor i automatski restart. Frontend u produkciji
služiti kao izgrađene statičke fajlove, ne kroz razvojni Vite server.
Ovo je početna procena bez merenja stvarnog vršnog saobraćaja, ne tvrdnja o
garantovanom broju korisnika.

Drugi proces ima smisla ako merenja pokažu zagušenje jednog procesa/CPU-a ili
ako je potreban deploy sa preklapanjem procesa. Ne udvostručuje automatski
kapacitet baze. Zajedničke transakcione brave i dalje serijalizuju povezane
mutacije između svih procesa. Dve instance na istom VPS-u ne štite od pada
samog VPS-a.

| Postavka | Istovremeni backend procesi | Pool po procesu | Maksimum aplikacije | Preostalo od 25 |
| --- | ---: | ---: | ---: | ---: |
| Jedna instanca, redovan rad | 1 | 8 | 8 | 17 |
| Jedna instanca, stari i novi proces pri deploy-u | 2 | 8 | 16 | 9 |
| Dve instance, redovan rad | 2 | 6 | 12 | 13 |
| Dve instance, zamena jedne po jedne | 3 | 6 | 18 | 7 |
| Dve instance, ceo stari i novi par istovremeno | 4 | 5 | 20 | 5 |

Račun pretpostavlja navedeni limit od 25 i ne uključuje druge klijente.
Planirati sve procese povezane na istu bazu: lokalni razvoj, skripte, migracije,
administrativne alate i druge aplikacije. Najmanje pet konekcija treba da ostane
van budžeta aplikacije; ne treba ih sve redovno trošiti drugim servisom.
Limit kod provajdera nije menjan niti nezavisno potvrđivan ovom izmenom.

Pratiti vremena odgovora u jutarnjem vrhu, čekanje na bazu i timeout greške,
broj konekcija, CPU, RAM i event-loop kašnjenje. Na dve instance preći na osnovu
tih merenja; ako je baza usko grlo, prvo ispitati upite i trajanje transakcija.

## Gašenje pri deploy-u

`SIGTERM`/`SIGINT` prvo zaustavlja prihvatanje novih HTTP zahteva i čeka
postojeće, pa zatvara zajednički pool. Krajnji rok je 30 sekundi; nakon toga
proces prinudno izlazi sa greškom. Ako se koristi process manager, njegov rok
za gašenje mora biti duži, npr. 35 sekundi. Bez toga process manager može
prekinuti proces pre završetka njegovog urednog gašenja.

Nije potrebna migracija. U produkciji treba pokrenuti novi kod sa odgovarajućim
`DB_POOL_MAX`. VPS/process manager nije menjan iz ovog radnog okruženja.

## Provere i izvori

Testovi proveravaju stvarni instalirani adapter, njegovu konfiguraciju, da
Better Auth izvršava upit kroz isti Prisma delegate i redosled gašenja.
Opcioni PostgreSQL test drži jedinu konekciju u testnom pool-u, proverava da
drugi zahtev odustaje za približno pet sekundi, pa oslobađa konekciju i potvrđuje
da novi upit uspeva. Koristi samo `SELECT 1`, bez promene poslovnih podataka.

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
npm.cmd run test:database
Remove-Item Env:TEST_ASSIGNMENT_DB
```

Izvori: [node-postgres Pool API](https://node-postgres.com/apis/pool) za
konfiguraciju, čekanje i zatvaranje; [Pool sizing](https://node-postgres.com/guides/pool-sizing)
za zbirni budžet svih procesa i rezervu. Ponašanje vlasništva pool-a dodatno
je provereno u lokalno instaliranom `@prisma/adapter-pg` 7.10.0.

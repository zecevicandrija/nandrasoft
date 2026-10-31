# Analitički indeksi i prostor baze — 31.10.2026.

## Nalaz i izmena

U Prisma šemi i povezanoj lokalnoj bazi potvrđen je nedostatak indeksa:

- `fuel_entry_workerId_date_idx` na `fuel_entry (workerId, date)`;
- `maintenance_issue_machineId_dateReported_idx` na
  `maintenance_issue (machineId, dateReported)`.

Dodati su Prisma `@@index` zapisi i dve odvojene migracije:
`20261031005000_fuel_worker_date_index` i
`20261031006000_maintenance_machine_date_index`. Svaka izvršava jedan
`CREATE INDEX CONCURRENTLY`, van transakcionog bloka. Tako se izbegava
blokiranje redovnih upisa tokom izgradnje, uz ograničenja tog postupka
opisana u [PostgreSQL dokumentaciji](https://www.postgresql.org/docs/current/sql-createindex.html).

Nisu menjani analitički rezultati ni API. Redosled kolona prati jednakost
po radniku/mašini pa raspon datuma. Postojeći indeksi nisu uklanjani jer
podržavaju druge upite.

Nedostatak ovih indeksa ne znači da PostgreSQL uvek mora da skenira celu
tabelu: može koristiti postojeći parcijalno koristan indeks. Takođe,
sekvencijalni scan je često najjeftiniji na veoma maloj tabeli. To je
očekivano ponašanje planera, prema
[dokumentaciji za EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html).
Nisu korišćena podešavanja koja prisiljavaju izbor indeksa.

## Merenje povezane lokalne baze

Limit korisnika je **6 GB prostora nezavisno hostovane baze**, a ne RAM
VPS-a. Merenja ispod odnose se na lokalnu bazu `nandrasoft` na
`localhost:5432`, šema `public`, ne na zasebnu hostovanu bazu.

Obe migracije su primenjene lokalno; oba indeksa su `valid` i `ready`.
Prisma klijent je regenerisan i svih 11 migracija je primenjeno.

| Mera | Izmereno |
| --- | ---: |
| Broj unosa goriva | 5 |
| Broj zapisa održavanja | 13 |
| Novi indeks goriva | 16.384 B = 16 KiB |
| Novi indeks održavanja | 16.384 B = 16 KiB |
| Oba nova indeksa ukupno | 32.768 B = 32 KiB |
| Svi indeksi `public` šeme | 1.605.632 B |
| Cela lokalna baza | 13.317.811 B, približno 13,32 MB |
| Udeo te lokalne baze u 6.000.000.000 B | 0,222% |

Na ovih 5/13 redova planer i dalje bira Seq Scan: oba upita čitaju samo
jedan blok. Jedno merenje pre/posle iznosilo je približno 0,032/0,024 ms
za gorivo i 0,025/0,019 ms za održavanje. Ove male razlike nisu dokaz
ubrzanja na produkciji i mogu predstavljati običan šum merenja.

Veličina indeksa je izmerena preko `pg_relation_size`, a veličina baze
preko `pg_database_size`; to su mere zauzeća diska, prema
[PostgreSQL dokumentaciji](https://www.postgresql.org/docs/current/functions-admin.html).
Provider može u kvotu uključivati i WAL, backup-e ili druge baze, što ova
SQL mera sama ne obuhvata. Merenje lokalne baze ne garantuje slobodan
prostor na hostovanoj bazi.

## Sintetička provera većeg obima

Test koristi po 100.000 sintetičkih redova u svakoj tabeli, tekstualne
ključeve dužine 25 znakova, 1.000 radnika/mašina i datume raspoređene kroz
730 dana. Poslovni podaci se ne menjaju: koristi se nasumična izolovana
šema koja se po završetku briše. Pre novih indeksa postoje relevantne
alternative: indeks datuma goriva i indeks mašine/statusa održavanja.

Upit računa SUM(totalCost) i COUNT za jedan identitet i mesečni raspon.
Izvršava se sedam puta, prvi prolaz se odbacuje, a beleži se medijana
preostalih šest merenja nad zagrejanim kešom. Planer sam bira novi indeks.
Rezultati agregata pre i posle moraju biti identični.

| Tabela | Medijana pre | Medijana posle | Blokovi pre/posle | Veličina novog indeksa |
| --- | ---: | ---: | ---: | ---: |
| Gorivo | 0,435 ms | 0,035 ms | 295 / 7 | 4.816.896 B, oko 4,59 MiB |
| Održavanje | 0,053 ms | 0,028 ms | 102 / 7 | 4.816.896 B, oko 4,59 MiB |

Ovo je test konkretnog selektivnog obrasca upita na lokalnom PostgreSQL-u,
ne simulacija ukupnog produkcijskog opterećenja. Buduće zauzeće zavisi od
broja redova, stvarnih ključeva, distribucije podataka i fragmentacije.

## Provera hostovane baze i deployment

U okruženju koje koristi DATABASE_URL hostovane baze pokrenuti redovni
`npm run db:deploy`, zatim `npm run db:audit-analytics`. Skripta je read-only:
prikazuje veličinu cele povezane baze, svih indeksa šeme, dva nova indeksa,
njihovu validnost, plan uzorka upita i preostali prostor prema konzervativnoj
kvoti od 6.000.000.000 B. Ne ispisuje URL, kredencijale ili identifikatore
radnika. Ne dodaje test podatke niti prisiljava plan. Svaki SQL upit ima
timeout od 15 sekundi; COUNT/GROUP BY/EXPLAIN ipak imaju cenu na velikoj bazi.

Prilikom deploy-a drugih instalacija pregledati sve pending migracije,
ne samo ove dve. Ako konkurentna izgradnja indeksa bude prekinuta,
proveriti `pg_index.indisvalid` i Prisma status pre ponovnog deploy-a;
ne preskakati nevalidan indeks samo zato što postoji objekat istog imena.

Prošla su dva ciljana PostgreSQL testa: sintetička provera planova i
kompletan deploy od prazne šeme, ponovljeni deploy i poređenje sa Prisma
šemom. Nije izvršeno merenje zasebne hostovane baze jer trenutna konekcija
vodi na localhost.

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
npm.cmd run test:analytics-indexes
npm.cmd run db:audit-analytics
```

# Kompletne migracije i katalog komora — 30.10.2026.

## Izmene

Originalna migracija `20260915182258_init_auth` sačuvana je bez izmene.
Dodata je `20261030000000_agricultural_domain`, koja kreira ostatak agrarne
šeme pre već dodatih migracija za aktivno zaduženje i potvrde zahteva.
`prisma/baselines/auth.prisma` je zamrznuti opis originalne auth šeme korišćen
za generisanje razlike; nije zamena za aplikativnu `schema.prisma`.

Redosled migracija sada je:

1. `20260915182258_init_auth`
2. `20261030000000_agricultural_domain`
3. `20261030120000_one_active_machine_assignment`
4. `20261030230000_mutation_receipts`
5. `20261030235000_onion_chambers`

Model `OnionChamber` mapira postojeću `onion_chambers` tabelu i njene snake_case
kolone. `storage_type` ostaje PostgreSQL TEXT, uz validaciju dozvoljenih
vrednosti kroz API, da se postojeća tabela usvoji bez konverzije podataka.
Kapacitet podrazumevane komore je 720 × 1.100 = **792.000 kg**, kao pri
dosadašnjem stvarnom upisu; uklonjen je rezervni katalog koji je prikazivao
drugačiju vrednost kada čitanje baze ne uspe.

Nova migracija komora kreira tabelu ako nedostaje. Šest standardnih komora
upisuje **samo ako je katalog prazan**. Ne dopisuje standardne komore u
korisnički prilagođen katalog, ne prepisuje postojeće kapacitete i ne kreira
LOT-ove, zalihe, korisnike ili druge demo poslovne podatke.

GET komora, statistike i ostala čitanja koriste Prisma model. Nedostajuća
tabela ili druga greška baze vraća grešku, umesto lažnog uspeha sa rezervnim
podacima. CRUD komora takođe koristi model i postojeće transakcije. Čitanje
komora tokom mutacije koristi njen transakcioni klijent. U `routes/onion.js`
više nema DDL-a, `$queryRawUnsafe` ni `$executeRawUnsafe`.

## Nova, prazna baza

Iz `backend` direktorijuma, sa `DATABASE_URL` postavljenim na namenjenu bazu:

```powershell
npm.cmd ci
npm.cmd run db:deploy
npm.cmd run db:generate
npm.cmd run db:status
```

U Linux okruženju koriste se iste npm komande bez `.cmd`. `db:deploy` poziva
`prisma migrate deploy`. Poseban migracioni korisnik treba da ima DDL prava;
aplikativnom korisniku katalog komora više ne zahteva CREATE prava. Postojeće
uloge i privilegije nisu automatski menjane.

Za buduće razvojne izmene koristiti `npm.cmd run db:migrate -- --name naziv`
u razvojnoj bazi sa odgovarajućom shadow bazom. SQL migracije se pregledaju i
verzionišu, a produkcija koristi `db:deploy`. Prethodna skripta `db:push`
zamenjena je ovim tokom.

## Postojeća baza održavana kroz db push

Ne izvršavati domensku CREATE migraciju nad već popunjenom šemom. Potrebno je
jednokratno uskladiti istoriju pomoću Prisma baselining postupka.

U ovoj povezanoj bazi je to završeno: provera šeme nije pronašla razliku,
checksum originalne auth migracije odgovara fajlu u repozitorijumu, a
parcijalni UNIQUE indeks zaduženja posebno je potvrđen kao važeći. Zatim su
domenska migracija i ranije ručno izvršene migracije zaduženja i potvrda
označene kao primenjene. Migracija komora izvršena je kroz `migrate deploy`.
Svih **7 postojećih komora** sačuvano je. Nije izvršavan reset ni demo seed.

Za drugo postojeće okruženje postupak se određuje prema njegovom stvarnom
stanju i istoriji, uz prethodno napravljen backup:

1. Pregledati `prisma migrate status`, `_prisma_migrations` i checksume već
   primenjenih migracija. Primena originalne auth migracije ne sme se menjati.
2. Ako katalog komora još ne postoji, njegovu novu SQL migraciju izvršiti
   migracionim korisnikom; ona je prilagođena usvajanju postojećeg kataloga.
3. Proveriti poklapanje šeme komandom ispod. Bilo kakvu razliku pregledati i
   uskladiti pre označavanja migracija. Posebno proveriti parcijalni indeks,
   jer nije deklarisan kao običan Prisma indeks u modelu.
4. Samo za strukture koje su provereno već prisutne koristiti
   `prisma migrate resolve --applied IME_MIGRACIJE`. Za strukture koje nedostaju
   primeniti odgovarajući SQL nakon provere; ne označavati ih naslepo.
5. Kada su postojeće strukture pravilno evidentirane, pokrenuti `db:deploy`,
   `db:generate` i `db:status`.

```powershell
npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Kod uspešnog poređenja izlazni kod je 0, za razliku 2, a za grešku 1.
`migrate resolve` menja evidenciju primene i ne izvršava SQL te migracije.
Provere i koraci ovog okruženja ne treba automatski da se kopiraju na bazu
koja ima drugačiju šemu. [Zvanični opis baselining postupka](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining).

## Provera

Prošlo je svih **82 backend testa**, uključujući PostgreSQL provere.
`tests/migrations.test.js` pravi zasebnu, nasumično imenovanu testnu šemu,
pokreće stvarni `prisma migrate deploy` dva puta, pa proverava:

- Sve tabele iz Prisma šeme postoje i poređenje šeme nema razliku.
- Parcijalni UNIQUE indeks aktivnih zaduženja postoji.
- Svih pet migracija je evidentirano.
- Prazna instalacija ima šest standardnih komora.
- Ponovljena migracija komora čuva postojeći prilagođeni katalog.

Test zatim uklanja samo tu testnu šemu; ne koristi poslovne tabele u `public`.
Testovi ruta proveravaju čitanje bez upisa, grešku pri nedostajućoj tabeli,
prazan katalog bez podrazumevanih izmišljenih komora, validaciju, duplikate
naziva, rollback preimenovanja i zabranu brisanja zauzete komore.

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
npm.cmd run test:migrations
Remove-Item Env:TEST_ASSIGNMENT_DB
```

Postojeća povezana baza na kraju prijavljuje `Database schema is up to date!`,
a završno poređenje sa `schema.prisma` nema razliku. Provera na VPS-u nije
izvršena iz ovog radnog okruženja.

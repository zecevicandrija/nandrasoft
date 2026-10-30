# Jedno aktivno zaduženje po mašini — 30.10.2026.

Dopuna: zaduživanja sada koriste i zajedničku transakcionu bravu pre provera
dostupnosti, zajedno sa radionicom i radnim nalozima. Detalji su u
`machine-maintenance-remediation.md`. Opis ranijih testova ispod odnosi se na
prvobitnu proveru indeksa; trenutni testovi kontrolera proveravaju serijalizaciju
pod zajedničkom bravom.

Stvarna tabela je `machine_assignment`, a aktivni status `ZADUZENA`.
Migracija `prisma/migrations/20261030120000_one_active_machine_assignment/migration.sql`
kreira indeks:

```sql
CREATE UNIQUE INDEX "machine_assignment_one_active_per_machine"
  ON "machine_assignment" ("machineId") WHERE "status" = 'ZADUZENA';
```

Baza odbija drugi aktivni zapis za istu mašinu iz bilo kog izvora upisa.
Istorijska zaduženja i novo zaduženje nakon razduženja ostaju dozvoljeni.
Rute `POST /checkout` i `POST /:id/accept` prepoznaju Prisma `P2002`
za ovaj ključ i vraćaju HTTP 409. Njihove postojeće transakcije poništavaju
neuspešno zaduženje zajedno sa promenama mašine i radnog naloga.
Provere pre transakcije služe za raniju povratnu informaciju; indeks je
zaštita od istovremenih upisa između različitih backend procesa.

SQL uzima bravu koja blokira upise tokom provere duplikata i kreiranja indeksa.
Postojeći aktivni duplikati prekidaju migraciju bez automatskog zatvaranja ili
brisanja evidencije. Čekanje brave ograničeno je na 10 s, a naredbe na 60 s.

## Primena

U povezanoj bazi nije bilo aktivnih duplikata. SQL je primenjen komandom
ispod; poslovni zapisi nisu menjani. `prisma db execute` ne beleži migraciju
u `_prisma_migrations`.

Za postojeće instalacije čija je šema proširivana kroz `db push`, nakon
provere da indeks već ne postoji, iz `backend` direktorijuma pokrenuti:

```powershell
npx.cmd prisma db execute --file prisma/migrations/20261030120000_one_active_machine_assignment/migration.sql
```

Instalacije sa usklađenom istorijom migracija mogu koristiti redovni tok
Prisma migracija. Parcijalni indeks je definisan kroz SQL, uz komentar u
Prisma šemi; sam `db push` nije zamena za ovu migraciju. Posle promena šeme
proveriti da indeks postoji:

```sql
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'machine_assignment_one_active_per_machine';
```

## Provera

`npm.cmd run test:assignments` proverava dva direktna zahteva, prihvatanje
dva naloga i međusobni sudar oba toka, uz namerno uspešne provere dostupnosti
pre transakcije. Kontrolisani model transakcije emulira UNIQUE ograničenje;
proverava jedan uspeh, jedan HTTP 409 i odsustvo promena gubitničkog zahteva.
Nepovezane greške ostaju HTTP 500.

Za proveru samog SQL-a na stvarnom PostgreSQL serveru:

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
npm.cmd run test:assignments
Remove-Item Env:TEST_ASSIGNMENT_DB
```

Taj test koristi samo privremenu tabelu sesije: proverava odbijanje postojećih
duplikata bez gubitka zapisa, odbijanje drugog aktivnog zaduženja, istorijske
zapise i ponovno zaduženje nakon razduženja. Ne menja poslovne tabele.
Svih 7 testova prošlo je i sa uključenom PostgreSQL proverom.

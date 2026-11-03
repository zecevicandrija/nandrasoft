# Održavanje sesija i push outbox evidencije — DB-004

Backend pri pokretanju i zatim jednom u 24 sata pokreće `startTechnicalCleanup`. Održavanje je nezavisno od konfiguracije push slanja. Može se isključiti promenljivom `TECHNICAL_CLEANUP_ENABLED=0` kada se koristi eksterni raspored.

Pravila su fiksirana na 30 dana:

- Sesija se briše samo ako je `expiresAt` strogo pre trenutka izvršavanja minus 30 × 24 sata. Ne gleda se starost prijave niti `createdAt`. Sesija koja je aktivna, produžena ili je istekla pre manje od 30 dana ostaje. Uklanjanje već isteklog zapisa ne odjavljuje aktivnog korisnika.
- Push zapis se briše samo kada ima status `SENT` i `completedAt` stariji od 30 dana. Neposlato, obrada, neuspešno, preskočeno i zapisi bez datuma završetka ostaju.
- Korisnici, radni nalozi, push pretplate, audit, poslovne evidencije i potvrde ponovljenih zahteva nisu obuhvaćeni.

Svako izvršavanje obrađuje najviše 10 kratkih transakcija. Svaka briše do 500 sesija i 500 poslatih push zapisa. Zaključavanje `pg_try_advisory_xact_lock` sprečava preklapanje održavanja između procesa; `FOR UPDATE SKIP LOCKED` preskače zauzete redove, a uslovi isteka/statusa proveravaju se i pri brisanju. Neuspešan paket se u celini poništava, a naredni dnevni pokušaj nastavlja posao. Prethodno završeni paketi ostaju završeni.

Posao ne pokreće paralelno novo izvršavanje u istom procesu. Gašenje servera zaustavlja raspored i čeka tekući paket pre zatvaranja database pool-a. Loguje se samo zbir obrisanih zapisa ili bezbedna oznaka greške, bez tokena i detalja sesija.

## Ručno održavanje / cron

Iz direktorijuma `backend`:

```text
npm run db:cleanup-technical
npm run db:cleanup-technical -- --apply
```

Prva komanda je isključivo read-only pregled kandidata. Druga primenjuje iste ograničene pakete. Za spoljni dnevni cron koristiti drugu komandu i isključiti ugrađeni raspored. Veliki zaostatak može zahtevati više izvršavanja.

Migracija `20261101000000_session_expiry_cleanup_index` dodaje indeks `session(expiresAt, id)` za izbor malih paketa. Primenjena je na lokalnu bazu `nandrasoft` kroz `npm run db:deploy`, zajedno sa migracijom arhiviranja komora. Na drugim bazama primenjuje se istom komandom. Postojeći indeks po `push_outbox.completedAt` već podržava izbor završenih poruka.

Postojeći monitor baze proverava popunjenost svakih šest sati i upozorava na 80% i 90% podešene kvote, podrazumevano 6 GB. DELETE oslobađa prostor za ponovnu upotrebu posle PostgreSQL autovacuum-a; ne garantuje trenutno smanjenje fizičkih fajlova ili prostora koji provajder računa za WAL/backupe. Ovaj posao ne pokreće blokirajući `VACUUM FULL`.

## Provera

`npm run test:cleanup` proverava rokove, granicu od tačno 30 dana, aktivne sesije, sve push statuse, ograničenja paketa, rollback, ponavljanje, konkurentni posao, dnevni raspored i gašenje. `TEST_CLEANUP_DB=1 node --test tests/technical-cleanup.test.js` dodatno proverava pravi SQL i idempotentni indeks nad sesijskim privremenim tabelama, bez promena stvarnih podataka.

Uz testove životnog ciklusa, pool-a i push slanja prošlo je 27 testova, uz 5 preskočenih opcionih integracionih testova. Prisma šema je validirana. Popravljen je datum testnog push posla u testu rasporeda da test ne zavisi od kalendarskog dana; poslovna pravila isteka push poruka ostaju ista.

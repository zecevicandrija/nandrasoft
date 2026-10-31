# Precizan novac i očuvanje audita — 31.10.2026.

## Novčana polja

Svih 22 novčana polja prebačeno je sa `Float` na PostgreSQL NUMERIC kroz
Prisma `Decimal`. Iznosi imaju `Decimal(15, 2)`, a jedinične cene/satnice
`Decimal(15, 4)`. Obuhvaćeni su radnici, sezonske dnevnice, gorivo i prijem
goriva, servisni troškovi, putarine/ENP saldo, đubrivo i otpremnice luka.
Fizičke količine, površine, radni sati i procenti ostaju Float.

`lib/money.js` koristi Prisma Decimal za obračun, sabiranje, oduzimanje,
množenje količine cenom i deljenje iznosa količinom. Iznosi se zaokružuju
na dve, a jedinične cene na četiri decimale pravilom HALF_UP. Na primer,
1.005 postaje 1.01, a 0.1 + 0.2 daje 0.30. Delovi i rad servisa se
pojedinačno zaokružuju pre sabiranja, u skladu sa njihovim DB kolonama.

Prilagođeni su obračuni unosa i izmene goriva, prijema, otpremnica,
servisa, đubriva, zbirnih dnevnica i finansijske analitike. ENP inkrementi
i dekrementi sada rade nad tačnim NUMERIC kolonama u PostgreSQL-u.

Postojeći API ugovor ostaje numerički: Prisma query extension pretvara
pročitane Decimal vrednosti u JS brojeve tek nakon provere da decimalne
cifre neće biti izgubljene. Isto važi u transakcijama i agregatima.
Finansijske operacije u kontrolerima koriste Decimal helper-e, umesto
nativnog JS sabiranja ili množenja. Iznos koji nije moguće preneti kroz
postojeći numerički API bez gubitka cifara izaziva grešku; ne zaokružuje se
tiho. Ovo ne menja ograničenja floating-point tipa na klijentu: buduće
finansijske obračune treba izvršavati na serveru ovim helper-ima.

## Audit

Uklonjena je kaskadna FK veza `audit_log.userId -> user.id`. `userId`
ostaje obavezni istorijski identifikator izvršioca, uz postojeće snapshot
kolone `userName` i `userRole`. Brisanje korisnika zato ne briše audit i
ne uklanja originalni identitet izvršioca. Audit API po potrebi jednim
batched upitom dodaje podatke o nalogu koji još postoji; obrisan nalog
vraća `user: null`, uz očuvane istorijske kolone.

Unos goriva sada prvo kreira `FuelEntry`, sačeka njegov stvarni ID, pa
upisuje `AuditLog.entityId = entry.id`. Unos, rezervoar, audit i potvrda
idempotencije ostaju u istoj transakciji. Greška audita poništava sve
upise. Stari audit zapisi sa `entityId = 'new-entry'` nisu nagađanjem
povezivani sa unosima; već obrisanu audit istoriju nije moguće vratiti
ovom migracijom.

## Migracija i lokalna primena

`20261031004000_decimal_money_audit_retention` konvertuje kolone koristeći
PostgreSQL `round(...::numeric, scale)`, dodaje zabranu NaN novčanih vrednosti
i uklanja audit FK. Tipovi ograničene preciznosti odbijaju beskonačnosti i
iznose izvan opsega. DDL je u jednoj transakciji; neuspeh poništava ceo paket.

Pre lokalne primene proverene su sve 22 postojeće kolone: nije bilo
nevalidnih vrednosti, prekoračenja opsega niti vrednosti koje bi promenilo
zaokruživanje na ciljnu skalu. Migracija je primenjena na lokalnu bazu
`nandrasoft` (`localhost:5432`, šema `public`), a Prisma klijent ponovo
generisan. Status potvrđuje da je svih devet migracija primenjeno.

Za druge instalacije proveriti stare iznose i zaustaviti stare backend
procese pre migracije, zatim pokrenuti `npm run db:deploy` i
`npm run db:generate`, pa restartovati backend sa novim kodom. Konverzija
postojećih iznosa sa više decimala u drugim bazama može promeniti njihov
zapis prema navedenom pravilu zaokruživanja.

## Provera

Prošlo je 85 relevantnih backend testova sa uključenim PostgreSQL
proverama, bez preskočenih testova. Dodatno prolazi devet auth/pool testova;
njihov opcioni test zasićenja pool-a nije pokretan. Testovi pokrivaju
decimalne granične slučajeve, zbir ponovljenih para, numerički API,
gorivo/audit ID i rollback, kao i regresije zaliha, profila, naloga i
idempotencije.

Migration test podiže šemu od nule, proverava svih 22 NUMERIC kolona,
zaokruživanje 1.005/12.12345, tačan inkrement i NaN zabranu. Zatim stvarno
briše test korisnika i potvrđuje da audit zadržava ID, ime, rolu i entity ID.
Sve se radi u izolovanoj test šemi koja se briše po završetku.

Posle lokalne primene kontroleri za onion lookup/dashboard, fuel
stats/entries/supplies, seasonal summary, analytics financial i audit
vraćaju 200 na stvarnim podacima. Direktno je potvrđeno i da Prisma
odgovori i transakcioni agregati ostaju numerički.

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
node --test tests/migrations.test.js tests/money-audit.test.js tests/financial-idempotency.test.js tests/inventory-concurrency.test.js tests/machine-maintenance.test.js tests/worker-sync-transaction.test.js tests/worker-identity.test.js tests/work-order-access.test.js
```

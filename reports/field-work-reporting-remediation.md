# Statistika radova bez kvadratne obrade — 31.10.2026.

Nalaz je saniran za `GET /field-work/stats` i
`GET /field-work/unassigned-warnings`.

## Implementacija

`lib/fieldWorkReporting.js` izvršava agregaciju u PostgreSQL-u. Provera da
mašina nema zaduženje koristi parametrizovani `NOT EXISTS` sa uslovom po
mašini i rasponu datuma. Novi indeks
`machine_assignment_machineId_assignedAt_idx` pokriva oba uslova.
Kolona `assignedAt` nije kastovana u WHERE uslovu, kako bi indeks mogao da
se koristi za pretragu raspona. Više zaduženja istog dana ne umnožava radove.

Statistika vraća pet sažetih agregata i grupisani pregled vrsta rada, bez
učitavanja svih poslovnih zapisa u Node.js. Ukupni istorijski brojevi i
pregled po vrstama rada zadržani su; računaju se u bazi. Radnik je ograničen
na svoj `workerId` pre agregacije, dok rukovodilac/direktor vidi zbirni pregled.
Stornirani radovi ostaju isključeni.

Detalji neusklađenosti prvo računaju broj i ID-eve tražene stranice u SQL-u,
pa učitavaju samo te radove sa povezanim imenima. Podrazumevano se vraća
50 stavki, najviše 100. Odgovor zadržava `count`, `period` i `items`, uz
`page`, `limit` i `totalPages`. Frontend ima kontrole za promenu stranice.
Sortiranje po datumu i ID-u daje stabilan redosled kada više radova ima isti
datum. Datumi i parametri stranice validiraju se pre upita.

Izveštaj se čita u `RepeatableRead` / `READ ONLY` transakciji, da broj i
stavke budu međusobno usklađeni. Pojedinačni SQL upit ima timeout 5 s,
transakcija 15 s, a čekanje na transakciju najviše 5 s. Ako upit prekorači
ograničenje, ruta vraća grešku umesto nepotpunog uspešnog rezultata.

Dani se računaju eksplicitno u `Europe/Belgrade`, nezavisno od vremenske
zone servera. Prisma TIMESTAMP vrednosti tretiraju se kao UTC. Rasponi su
od početka dana uključivo do početka sledećeg dana isključivo, uključujući
dan sa promenom letnjeg/zimskog vremena. Sačuvana je postojeća poslovna
definicija: zaduženje za istu mašinu istog kalendarskog dana pokriva rad;
ne dodaje se novi uslov radnika ili vremena pre početka rada.

## Baza i primena

Migracija `20261031001000_assignment_reporting_index` primenjena je na
povezanu bazu. Istorija sada sadrži šest migracija i prijavljuje ažurno stanje.
Poređenje baze sa Prisma šemom ne nalazi razliku. Poslovni podaci nisu menjani.
Za druge instalacije primena ide redovno kroz `npm run db:deploy`.

## Provere

Prošlo je svih **88 backend testova**, uključujući PostgreSQL provere, i
frontend `npm run build`. Bundler i dalje daje upozorenje o veličini paketa.

Novi testovi proveravaju:

- Agregate, izostavljanje storna i sprečavanje višestrukog brojanja rada.
- Izolaciju radnika, prazan rezultat i prilagođene vremenske raspone.
- Ponoć u Beogradu, različite UTC datume i dan promene sata.
- Tačan broj upozorenja i nepoklapajuće, ograničene stranice.
- **10.000 radova i 10.000 zaduženja**, bez učitavanja detaljnih radova za
  statistiku. `EXPLAIN ANALYZE` potvrđuje korišćenje indeksa zaduženja.

SQL obračun u lokalnim proverama trajao je približno **50–80 ms** za taj
sintetički skup. To je vreme izvršenja SQL-a na lokalnoj bazi, ne garantovano
vreme celog HTTP zahteva niti test sa 50 istovremenih korisnika na VPS-u.
Sa rastom istorije posao baze i dalje raste, ali uklonjena je JavaScript
petlja reda radovi × zaduženja i veliki prenos kompletne istorije u aplikaciju.

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
npm.cmd run test:reporting
Remove-Item Env:TEST_ASSIGNMENT_DB
```

Testovi koriste privremene tabele svoje PostgreSQL sesije i ne čitaju niti
menjaju poslovne tabele. Direktni `pg` test koristi isto UTC tumačenje
TIMESTAMP vrednosti kao Prisma adapter, da rezultat ne zavisi od zone hosta.

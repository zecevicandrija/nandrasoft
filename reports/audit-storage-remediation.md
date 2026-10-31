# Audit: manji budući zapisi i nadzor prostora

Implementirano 31.10.2026. Polazno istraživanje: `audit-storage-investigation.md`.

## Sačuvana istorija

Migracija `20261031007000_audit_format_version` dodaje `formatVersion`
(podrazumevano 1) i opcionu kolonu `context`. Postojeći JSON i metapodaci nisu
prepisivani. Lokalno je pre i posle migracije ostalo 107 zapisa verzije 1.
Kontrolni otisak svih originalnih kolona, sortiranih po ID-ju, identičan je:
`5e07540ef70274348da33910409f9b3c`.

Nema brisanja, automatskog čišćenja niti slanja arhive. Zajednički aplikacioni
Prisma klijent odbija izmene i brisanje audita. To je zaštita kroz aplikaciju,
ne zabrana direktnog SQL pristupa administratora baze.

## Budući događaji

`lib/audit.js` kroz zajednički Prisma klijent priprema nove zapise verzije 2:

- Izmene čuvaju prethodnu i novu vrednost promenjenih prosleđenih polja.
  Odsustvo polja u delimičnom zahtevu ne tumači se kao brisanje; eksplicitno
  `null` ostaje zabeleženo.
- Kreiranje i brisanje čuvaju skalarne podatke dokumenta. Povezani objekti se
  svode na ID i istorijske nazive/oznake, bez kopiranja njihovih celih profila.
- Stavke otpremnice i članovi grupe imaju posebne male projekcije. Lozinke,
  tokeni i tehnički `updatedAt` se ne čuvaju u novim snapshot-ima.
- Nove eksplicitne evidencije u radnicima, sezoncima i modulu luka koriste
  isti ID operacije i istu transakciju kao poslovna promena. Grupni unos
  dnevnica ima zaseban audit za svaki nastali obračun; ponovljen idempotentan
  zahtev ne pravi dodatni audit.

Dodati su događaji za kreiranje/izmenu/brisanje radnika i sezonaca,
deaktivaciju sezonca, grupe i rad/dnevnice, komore, kupce luka, dovoz,
skladištenje, sortiranje, pakovanje, otpremnicu i kalo. Izvedene promene
zaliha ne kopiraju se kao dodatni puni snapshot-i celog LOT-a. Ranije
neevidentirane radnje ne mogu se naknadno pouzdano rekonstruisati.

Diff nije samostalni backup niti obećanje rekonstrukcije svakog stanja cele
baze. Nova poslovna pokrivenost znači i više audit događaja nego ranije, pa
manji pojedinačni događaj ne garantuje isti procenat uštede godišnjeg prostora.

## Prikaz i nadzor

Lista audita vraća metapodatke. Zaseban zaštićeni endpoint za detalje vraća
jedan događaj, uključujući stariji format. Frontend prikazuje prethodne i nove
vrednosti i mali kontekst. Pristup ostaje direktoru i rukovodiocu.

`lib/storageUsage.js` meri celu PostgreSQL bazu, `audit_log` i
`mutation_receipt`. Podrazumevana kvota je 6.000.000.000 bajtova. Podešava se
promenljivom `DB_STORAGE_QUOTA_BYTES`; ako provajder računa 6 GiB umesto 6 GB,
postaviti stvarnu kvotu u bajtovima.

Na 80% (4,8 GB) pojavljuje se upozorenje, na 90% (5,4 GB) kritično upozorenje
u revizorskom prikazu. Backend proverava prostor pri pokretanju i na šest
sati, uz oznaku `DATABASE_STORAGE_ALERT` u serverskom logu. Prikaz proverava
zauzeće jednom u minuti dok je otvoren. Ovo ne šalje email/SMS: za obaveštenje
van aplikacije treba povezati nadzor provajdera ili serverskih logova.

PostgreSQL veličina baze ne mora odgovarati celoj kvoti provajdera ako on
računa i WAL, backup ili druge stavke. I provajderov prikaz prostora treba
pratiti. Neuspešno merenje je vidljivo i ne prikazuje se kao 0%.

Ručna provera, bez izmene podataka, iz backend direktorijuma:

```powershell
npm.cmd run db:audit-storage
```

Koristi trenutno podešen `DATABASE_URL`. Izlazni kodovi: 0 normalno,
1 upozorenje, 2 kritično, 3 neuspešno merenje.

## Lokalna merenja i provere

Posle migracije: baza 13.285.043 B (0,22% podešene kvote), audit 229.376 B
(224 KiB), potvrde idempotencije 16.384 B. Ovo nisu produkcijski podaci;
veličina baze se menja i zbog testnih transakcija i PostgreSQL metapodataka.

Simulacija serijalizacije istih 107 događaja u memoriji, bez upisa: 106.591 B
u sadašnjem obliku sa novim kolonama naspram 75.784 B u novom formatu, oko
28,9% manje. Radni nalozi: 56.933 → 33.352 B; promet đubriva: 13.159 → 7.033 B.
Mali događaji mogu biti nešto veći zbog konteksta. Ovo poredi JSON
serijalizaciju, ne fizičke PostgreSQL stranice ili produkcijski rast.

Provere:

- Ciljane provere audita, dnevnica, radnika, komora, lagera, novca, održavanja
  i naloga: 88 prolaza, 4 testa sa bazom preskočena u tom pokretanju.
- Odvojeno sa `TEST_ASSIGNMENT_DB=1`: svih 7 provera audita i migracija prolazi.
  Obuhvaćena je stvarna Prisma transakcija sa namernim rollback-om audit upisa
  i migracija cele šeme od prazne baze, ponovljeni deploy i poređenje šeme.
- Provereni su rollback pri neuspehu audita radnika, grupnih dnevnica, goriva
  i otpremnice; ponavljanje zahteva bez duplih događaja; delimični diff,
  istorijski identiteti, stavke otpremnice, dozvole i pragovi zauzeća.
- Frontend TypeScript i produkcijski build prolaze. Ostaje upozorenje o
  veličini JavaScript paketa. Ručni pregled interfejsa u browseru i
  produkcijsko opterećenje nisu provereni.

## Uvođenje na server i arhiviranje

Lokalna migracija je primenjena. Za udaljenu bazu i backend u uobičajenom
deployment-u primeniti migracije, generisati Prisma klijent i restartovati
novu verziju backenda; frontend objaviti zajedno sa njim:

```powershell
npm.cmd run db:deploy
npm.cmd run db:generate
npm.cmd run db:audit-storage
```

Komande izvršiti iz backend direktorijuma sa konekcijom za ciljnu bazu.
Udaljeni deploy nije izvršen u ovoj izmeni.

Automatsko arhiviranje i premeštanje istorije nisu uključeni. Za taj korak
potrebno je prvo obezbediti privatno skladište, format paketa, checksum i
manifest, nezavisan backup, proveru potpunog vraćanja i pregled arhive.
Do tada sva istorija ostaje u PostgreSQL-u. Nema selektivnog odbacivanja
pojedinih vrsta događaja.

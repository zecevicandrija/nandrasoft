# Evidencija korišćenja više mašina

## Pravila

- Direktor/rukovodilac menjaju planiranu mašinu kroz „Izmeni” dok nalog nije prihvaćen i nema istoriju korišćenja.
- Prihvatanje kreira zaduženje na dodeljenog radnika. Završetak rada razdužuje sve aktivne mašine i povezuje njihove segmente sa jednim radom. Izvršilac akcije ostaje u revizorskom tragu, uključujući postupak u ime radnika.
- Generički PUT/PATCH ne može da preskoči prihvatanje, unos rada ili kontrolisanu promenu mašine. Zaključane su i neposredne promene radnika, parcele i vrste rada nakon prihvatanja.
- „Korišćene mašine” nudi pogrešan izbor (CORRECT), stvarnu zamenu (REPLACE) i dodatnu mašinu (ADD). Pogrešan izbor se poništava uz razlog i istoriju; stvarno korišćenje zadržava početne/završne sate, gorivo i učinak.
- Na završenom radu unose se zatvoreni istorijski segmenti. Nalog se ne otvara ponovo i ne nastaje aktivno zaduženje. Isto važi za obavljeni deo naloga čiji je ostatak otkazan.
- Operater ispravlja svoje unose istog kalendarskog dana u zoni Europe/Belgrade. Direktor/rukovodilac mogu naknadno.
- Hektari segmenata daju ukupne hektare jednog rada; radni sati radnika ostaju odvojeni od sati mašina. Mašina bez hektara može imati stvarne sate i potrošnju.
- Otkazivanje ostatka kroz unos rada čuva obavljeni deo i zatvara mašine. STORNO isključuje rad iz radnih izveštaja, ali ne briše stvarnu upotrebu, točenje goriva ili prijavljeni kvar.

## Integritet i stari podaci

Promene koriste postojeće transakcije, zaključavanje mašina, verzije podataka i idempotentne zahteve. Greška bilo kog koraka poništava celu promenu. Preklopljena zaduženja se odbijaju. Istorijska korekcija ne prepisuje novija očitavanja.

Migracija automatski povezuje samo jednoznačnu postojeću vezu preko naloga. Za ostale stare radove korisnik bira provereno postojeće zaduženje ili unosi proverenu istoriju. Sistem ne povezuje zapise samo zato što su istog dana. Kada nema snimka stanja pre greške, traži se potvrđeno trenutno brojilo i gorivo stare mašine.

Korekcija pogrešnog izbora sa točenjem goriva ili oznakom vraćanja sa kvarom namerno se odbija radi razrešenja povezanih evidencija. Kvar se ne prenosi automatski na drugu mašinu; trenutno nema objedinjene korekcije mašine i prijave kvara.

## Isporuka i provera

Primeniti migracije pre pokretanja novog backend koda:

```powershell
npx prisma migrate deploy
npx prisma generate
npm run db:verify-machine-usage
```

Migracije `20261109085000_machine_fuel_type` i `20261109090000_machine_usage` dodaju nedostajuće kolone, veze i pogled `field_work_machine_usage`. Druga migracija otklanja P2022 za `machine_assignment.fieldWorkId`. Obe su primenjene na lokalnu razvojnu bazu 9.11.2026; produkcija nije menjana.

```powershell
node --test tests/machine-usage.test.js tests/work-order-access.test.js tests/machine-fuel-concurrency.test.js
$env:TEST_ASSIGNMENT_DB='1'
node --test tests/machine-usage-postgres.test.js tests/migrations.test.js tests/field-work-reporting.test.js tests/analytics-batch.test.js
$env:TEST_FUEL_DB='1'
node --test tests/fuel-efficiency-pagination.test.js
# Iz frontend direktorijuma:
npm run build
```

PostgreSQL testovi migracija koriste nasumične izolovane šeme; izveštajni testovi privremene tabele. Testovi pokrivaju korekciju greške, stvarnu zamenu, dodatnu mašinu, završene i stare radove, otkazivanje ostatka, prava pristupa, ponovno slanje, zastarele verzije, preklapanja i rollback.

Build i navedene ciljane provere prolaze. Završno pokretanje kompletnog backend skupa: 315 prolazi, 9 neuspešnih (uključujući roditeljske grupe), 23 preskočena. Neuspešni testovi su u `auth-role.test.js`, `master-workers-privacy.test.js` i `worker-sync-transaction.test.js`, u neizmenjenim delovima, pa nije potvrđeno da ceo projekat prolazi. Dodatnih 20 frontend testova upita i ponovnog slanja prolazi. Vizuelna provera u browseru nije izvršena jer automatizacija browsera nije bila dostupna.

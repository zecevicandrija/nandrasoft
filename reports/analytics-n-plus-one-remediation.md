# Grupna analitika mašina i radnika — 31.10.2026.

## Nalaz i izmena

Rute `/api/analytics/machines` i `/api/analytics/workers` izvršavale su
9, odnosno 11 Prisma poziva po prikazanom entitetu, uz još dva poziva
za broj rezultata i stranicu. Za 10 mašina to je bilo 92 poziva, a za
10 radnika 112.

`lib/analyticsBatch.js` sada učitava agregate grupisane po `machineId`,
`workerId`, odnosno `reportedById`, za sve ID-jeve iz odabrane stranice.
Detaljni preseci koriste složene ključeve (npr. `machineId, workerId`).
Nazivi povezanih entiteta učitavaju se jednom po tipu, samo za potrebne
ID-jeve. Petlje koje formiraju API odgovor više ne pristupaju bazi.

Broj poziva za nepraznu stranicu sada je najviše **11 za mašine** i
**13 za radnike**, nezavisno od broja prikazanih entiteta. Prazna stranica
izvršava samo dva osnovna poziva. Prazne liste povezanih ID-jeva ne
izazivaju dodatne upite za nazive.

Zadržani su API format, paginacija, aktivni entiteti, pretraga, direktni
ID filter, UTC datumske granice, status završenih radova, nulte vrednosti
i postojeće računanje novca. Limiti se primenjuju zasebno po entitetu:
5 radnika po mašini, 10 mašina i 10 parcela po radniku. Poredak po
površini ostaje opadajući; kao ranije, redosled jednakih površina nije
definisan.

Poslednjih 10 popravki po mašini dobija se jednim parametrizovanim SQL
upitom sa `LATERAL` i `LIMIT 10` unutar podupita. Tako se cela istorija
popravki ne prenosi u aplikaciju. Ovaj pregled i dalje ignoriše datum
agregata, kao ranije. Za iste datume dodat je stabilan poredak po ID-ju.

Nisu potrebne migracije. Postojeći indeks održavanja po
`(machineId, dateReported)` podržava dohvat poslednjih popravki.

## Verifikacija

`npm run test:analytics` proverava API odgovore i broj poziva za 1, 10
i 100 entiteta, paginaciju, isključenje storniranih i starijih radova,
uključive datumske granice, iznose, prazne rezultate i limite po entitetu.
Ovi testovi koriste memorijske delegate i ne predstavljaju merenje
produkcijskog vremena odziva.

`$env:TEST_ASSIGNMENT_DB = '1'; npm run test:analytics` uključuje i
proveru stvarnog SQL upita na PostgreSQL-u. Test kreira privremenu tabelu
na zasebnoj konekciji, proverava 10 popravki za svaku od dve mašine,
istorijske datume i bezbedno vezivanje ID-jeva. Ne menja poslovne tabele.
Lokalno su prošla sva četiri testa, uključujući PostgreSQL proveru.

Grupisani preseci prenose zbirne redove, ne pojedinačne radove. Njihov
broj i dalje zavisi od broja različitih parova entiteta u izabranom
periodu; opcija `all=true` zadržava postojeću semantiku svih rezultata.

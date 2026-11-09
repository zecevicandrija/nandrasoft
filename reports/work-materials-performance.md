# Materijali na nalozima i radovima — 04.11.2026.

Posebni šifarnici `chemical_product` i `seed_product`; đubriva koriste postojeći
`fertilizer_product`. `work_type.materialKind` određuje koji šifarnik operacija
koristi. `materialRequired` je opciono podešavanje obaveznosti izbora.
Migracija povezuje postojeće operacije bacanja veštaka, precizne setve luka i
prskanja. Dalje preimenovanje operacije ne menja ovu vezu.

## Pretraga i upiti

- Obrazac šalje zahtev od dva slova/broja, nakon 300 ms bez kucanja, uz `limit=10`.
- Server čita 11 redova da utvrdi `hasMore`; nema `COUNT(*)`, učitavanja cele
  liste ili dodatnog upita za svaki rezultat.
- Reči se normalizuju za srpsku latinicu i pretražuju po prefiksu svake reči
  (`:*`). Npr. `span hib` pronalazi `Španski hibrid`. Pretraga po sredini reči
  nije podržana. Specijalni znaci ne postaju SQL ili tsquery operatori.
- Tri parcijalna GIN indeksa nad aktivnim proizvodima podržavaju pretragu i
  dvokarakternih prefiksa. Nisu potrebne PostgreSQL ekstenzije.
- Šifarnici hemije i semena vraćaju 25 redova, uz sledeći kursor `(code, id)`.
  Indeksi `(isActive, code, id)` omogućavaju navigaciju bez velikih `OFFSET` upita.
- Upiti koriste parametre; nazivi tabela i izrazi dolaze iz fiksne serverske mape.
- Klijent odvojeno kešira vrstu i tekst pretrage pet minuta, prosleđuje abort
  signal i ne prikazuje rezultat za prethodni tekst tokom čekanja nove pretrage.
  Izmene artikla poništavaju odgovarajuće keševe.

## Čuvanje i istorija

- Najviše 20 artikala po nalogu/radu; jedan upit za podešavanje operacije i
  najviše jedan `IN` upit za sve nove artikle. Više redova se upisuje `createMany`.
- `work_material` čuva naziv, šifru i jedinicu kao istorijski snimak. Pregledi
  koriste te podatke bez spajanja sa tri šifarnika proizvoda.
- Materijali sa naloga se kopiraju u rad. Promena stvarne doze ne menja plan.
  Preimenovanje i arhiviranje artikla ne brišu istoriju.
- FK veze i indeksi pokrivaju oba vlasnika i sva tri tipa proizvoda. Kompozitni
  jedinstveni indeksi istovremeno pokrivaju dohvat po vlasniku i sprečavaju
  duplikate. CHECK ograničenja zahtevaju jednog vlasnika, odgovarajuću vezu sa
  proizvodom i pozitivnu konačnu dozu. Svi redovi se menjaju u istoj transakciji
  kao nalog/rad. Izdavanje naloga ne menja magacinske zalihe.

## Provera

`TEST_MATERIAL_DB=1 npm run test:materials` u backend direktorijumu proverava
stvarne API upise i prenos kroz PostgreSQL, sa vraćanjem test podataka rollbackom.
Planovi su provereni u izolovanoj šemi sa po 20.000 sintetičkih artikala u sva
tri šifarnika i normalnim podešavanjima planera. PostgreSQL je sam odabrao GIN
Bitmap Index Scan; selektivne pretrage su u lokalnim proverama trajale približno
1–3 ms. To su lokalna merenja, ne garancija vremena odziva na produkciji.
Provereni su i kursor, arhivirani artikli, dozvole, validacija i očuvanje planiranih
i stvarnih doza. Čista primena svih migracija i Prisma diff uspešno prolaze.

Frontend: `npm run test:materials`, `npm run test:submissions`, `npm run build`.
Vizuelna provera kroz kontrolisani pregledač nije bila dostupna u ovoj sesiji.

PostgreSQL dokumentacija: [prefiksni upiti](https://www.postgresql.org/docs/current/datatype-textsearch.html),
[GIN indeksi za tekstualnu pretragu](https://www.postgresql.org/docs/16/textsearch-indexes.html).

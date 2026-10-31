# Validacija kala i sezonskog rada — 31.10.2026.

## Otpis luka

`POST /api/onion/waste` proverava pozitivnu konačnu količinu i trenutno
sirovo stanje LOT-a pre bilo kakvog umanjenja ili knjiženja gubitka.
Ako je izabrana lokacija, proverava se i pripadnost LOT-u i njeno fizičko
stanje. Uklonjena je tolerancija koja je dozvoljavala prekoračenje lokacije
do 0,01 kg. Nedovoljno stanje vraća HTTP 400 bez promene lagera ili otpisa.

Bez izabrane lokacije zadržan je FIFO po postojećim lokacijama. Model
dozvoljava i sirovi luk koji još nije raspoređen: preostali deo otpisa može
doći iz tog neraspoređenog stanja, ali ukupan otpis nikada ne prelazi
`rawStockKg`. Zato LOT bez skladišnih zapisa nije automatski blokiran.
Ako zbir lokacija premašuje ukupno sirovo stanje LOT-a, otpis se odbija do
usklađivanja lagera (uz toleranciju 1e-7 kg samo za float zbir).

Umanjenja više ne koriste `Math.max(0, ...)` da bi prikrila prekoračenje.
Postojeća onion transakciona advisory brava obuhvata čitanje stanja,
provere, sve FIFO promene i zapis otpisa. Dva istovremena zahteva ne mogu
oba potrošiti istu zalihu. Greška vraća sve promene transakcije.

## Sezonci

`lib/seasonalWorkValidation.js` koristi Zod za validaciju pojedinačnog,
grupnog i izmenjenog zapisa rada. Proveravaju se i eksplicitne vrednosti i
izračunati sati odnosno dnevnice preuzete iz šifarnika.

- Sati moraju biti konačni, veći od nule i najviše 24 po radnom danu.
- Navedena dnevnica mora biti konačna i veća od nule. Nenavedena dnevnica
  može ostati `null`; prazna polja zadržavaju postojeći postupak preuzimanja
  radnikove podrazumevane dnevnice. Legacy nulta podrazumevana dnevnica se,
  kao i ranije, tretira kao nenavedena.
- Pauza je ceo nenegativan broj minuta do 1440. Kada se sati računaju iz
  vremena, pauza ne sme ostaviti nula ili negativno radno vreme.
- Vreme mora imati format `HH:mm` i važeće sate/minute. Noćna smena je
  podržana. Konačni numerički stringovi iz obrazaca ostaju podržani;
  booleans, nizovi, objekti, NaN i beskonačnosti se ne pretvaraju u brojeve.

U grupnom unosu validiraju se efektivne dnevnice svih radnika pre
pokretanja upisa. Izmena beleške bez promene vremena čuva postojeće sate i
pauzu. Neispravan unos daje HTTP 400 i ne ostavlja potvrdu idempotencije.
Šifarnik sezonaca takođe odbija nulte, negativne i beskonačne dnevnice;
`null` ostaje dozvoljen za nenavedenu dnevnicu. U njegovim error handlerima
ispravljeno je korišćenje Zod 4 `issues`, kako bi validacija vratila 400.

## Provera

Svih 56 pokrenutih testova prolazi, bez preskočenih testova:

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
node --test tests/financial-idempotency.test.js tests/inventory-concurrency.test.js tests/mutation-receipt.test.js tests/onion-chambers.test.js tests/worker-identity.test.js
```

Testovi uključuju 1000 kg otpisa na lageru od 100 kg, prekoračenje izabrane
lokacije, pripadnost lokacije, tačno pražnjenje FIFO lagera, neraspoređen
luk, neusaglašeno stanje, konkurentne otpise i rollback nakon greške.
Za sezonke se proveravaju negativni, nulti i nekonačni sati/dnevnice,
neispravni tipovi, vremena i pauze, obračun noćne smene, negativna dnevna
tarifa drugog radnika u grupi i očuvanje vremena pri izmeni beleške.

Migracija nije potrebna. Postojeći pogrešni istorijski zapisi nisu
automatski prepravljani; izmena sprečava nove neispravne unose.

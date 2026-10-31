# Odloženo učitavanje ruta i izvoza — 31.10.2026.

## Izmena

`frontend/src/App.tsx` sada koristi `React.lazy` za svih 15 sekundarnih
stranica. Početni ekran ostaje neposredno dostupan. `Suspense` prikazuje
poruku „Učitavanje stranice…” sa `role="status"` dok se preuzima ruta.
Postojeće putanje, preusmerenja i provere pristupa u komponentama ostaju
sačuvani.

Biblioteke `jspdf` i `jspdf-autotable` učitavaju se dinamički unutar PDF
handlera za analitiku, radove, sezonce i luk. `xlsx` se učitava tek pri
pokretanju Excel izvoza analitike. Njihov kod zato nije potreban ni za
otvaranje ovih stranica, sve dok korisnik ne pokrene izvoz. Postojeći
indikatori izvoza i obrada grešaka obuhvataju i učitavanje biblioteka.

Vite automatski generiše zasebne fajlove ruta, njihov CSS i zajedničke
zavisnosti. Nisu uvedena ručna pravila koja bi sve biblioteke ponovo
objedinila u jedan zajednički paket. Uključen je build manifest radi
provere stvarnog grafa zavisnosti.

## Merenje produkcionog builda

Pre izmene glavni JavaScript fajl imao je približno **1.855,58 kB**,
odnosno **507,00 kB gzip**. Posle izmene ima **363,99 kB**, odnosno
**114,93 kB gzip**: približno **80% manje nekompresovanog koda**.

Kompletni statički JavaScript skupovi, uključujući deljene zavisnosti
i početni paket, izmereni su iz build manifesta bez dvostrukog brojanja:

| Stranica | JS bajtovi | Gzip bajtovi |
| --- | ---: | ---: |
| Početni ekran | 364.713 | 114.301 |
| Zaduživanje mašina | 448.674 | 138.811 |
| Brzi unos rada | 424.474 | 135.154 |
| Evidencija radova, bez izvoza | 429.558 | 135.969 |

Ove veličine nisu ukupna veličina cele aplikacije niti merenje vremena
otvaranja na mobilnoj mreži. Ne uključuju CSS, fontove i API podatke.
Gzip je izračunat lokalno; stvarni prenos zavisi od kompresije i keša
HTTP servera. Nakon prvog učitavanja zajednički fajlovi mogu se ponovo
koristiti iz keša pri navigaciji.

## Provera

`npm.cmd run test:bundle` izvršava TypeScript proveru, produkcioni build
i tri testa. Sva tri prolaze:

- Početna stranica i operativne forme nemaju statičke zavisnosti od
  PDF/Excel biblioteka niti upravljačkih modula. Njihovi ukupni statički
  JS skupovi imaju regresionu granicu od 600.000 bajtova.
- Svih 15 sekundarnih ruta imaju dinamičke build ulaze. Izvozne
  biblioteke ostaju dinamičke i na stranicama koje nude izvoz.
- Dinamički uvezene biblioteke generišu PDF sa validnim zaglavljem i
  Excel datoteku čiji se podaci uspešno ponovo učitavaju.

Testovi proveravaju build i izvozne API-je; ne simuliraju mobilnu mrežu
niti predstavljaju ručnu proveru svih ekrana u pregledaču.

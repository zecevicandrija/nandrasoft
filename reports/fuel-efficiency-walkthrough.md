# Prenos normativa goriva u direktorsku analitiku — 31.10.2026.

## Dopuna: dizajn, zajednički filteri i paginacija

Tab sada ima zaseban prilagodljiv dizajn, KPI kartice, traku obuhvata,
statusne oznake, jasna prazna stanja i sklopivo objašnjenje obračuna.
Datum, mašina, radnik, parcela i pretraga sa vrha stranice primenjuju se na
novi endpoint. Promena filtera vraća obe tabele na prvu stranicu, dok svaka
tabela ima nezavisnu paginaciju od tačno 10 redova.

Produkcioni loader više ne učitava sve radove/zaduženja/točenja u Node.js.
`lib/fuelEfficiencyQuery.js` izvršava parametrizovan SQL: bira ciljane radove,
pronalazi njihova zaduženja, računa pune intervale i raspodelu u bazi, zatim
vraća samo ukupne pokazatelje i dve stranice sa `LIMIT 10 OFFSET`.
Operacije bez radova u izabranom skupu nisu prikazane. Brojevi i ukupni
pokazatelji obuhvataju sve filtrirane rezultate, nezavisno od stranice.

Parametri su `dateFrom`, `dateTo`, `machineId`, `workerId`, `parcelId`,
`search`, `operationsPage`, `criticalPage`, `limit=10`. Neispravni parametri
vraćaju 400. Jedan odgovor koristi read-only RepeatableRead transakciju
sa ograničenim vremenom izvršavanja. Ukupni pokazatelji zahtevaju da baza
obradi odgovarajuće zapise; paginacija ograničava prenos redova, a ne
tačnost ili obuhvat zbirova.

Točenja se filtriraju po mašini i točiocu. Ako je izabrana parcela ili
pretraga rada, u trošak ulaze točenja tokom povezanih zaduženja. Taj iznos
predstavlja račun za točenje, ne direktno izmeren trošak parcele.

Ostali tabovi ne šalju svoje upite dok je otvoren tab goriva. Pretraga
goriva čeka 300 ms nakon kucanja, zahtevi podržavaju otkazivanje, a
kratak keš sprečava nepotrebno ponovno učitavanje iste stranice.
PDF i Excel prolaze sve filtrirane stranice tek na zahtev za izvoz.

Provereno: 44 backend testa i osam frontend testova prolaze; jedan
nepovezan PostgreSQL test je preskočen. Novi PostgreSQL test je izvršen
nad privremenim tabelama sa 25 operacija i radova: potvrđene su stranice
10/10/5, filteri, stabilni zbirni pokazatelji, prazni rezultati i raspodela
koja uključuje radove van izabranog perioda/parcele. Produkcioni build i
lint novih frontend fajlova prolaze. Vizuelna provera u pregledaču ostaje
neizvršena zbog nedostupnog browser hosta u ovoj sesiji.

Sledeći odeljci opisuju početnu implementaciju pre ove dopune.

Evidencija goriva sada služi za točenja, račune i cisternu. Uklonjeni su
obračun L/ha po pojedinačnom točenju, automatsko nagađanje rada i alarm za
jutarnje točenje bez prethodno unetog rada. Ostaju zabrana prekoračenja
kapaciteta rezervoara, kontrola zalihe cisterne i zahtev za cenom ili računom
kod radnika na pumpi. Postojeći istorijski zapisi i audit trag nisu menjani.

POST i PUT proveravaju svaki prosleđeni fieldWorkId: rad mora postojati i
pripadati mašini. Radnik mora biti vlasnik rada i datum mora odgovarati
datumu točenja u Europe/Belgrade. Rukovodioci mogu povezati rad drugog
radnika/datuma, ali nikada druge mašine. Null uklanja opcionu vezu.

Direktor otvara `/analitika?tab=gorivo`. Novi endpoint
`GET /api/analytics/fuel-efficiency` prihvata dateFrom/dateTo (YYYY-MM-DD),
proverava period i dozvoljava pristup samo direktoru. Stari endpointi
`/api/fuel/analytics/l-per-ha` i `/api/fuel/anomalies` vraćaju 410 sa adresom
novog endpointa. Uklonjeni su njihovi tabovi, KPI i filteri iz evidencije.
Raniji količnik sipanih litara i hektara uklonjen je i iz postojećih pregleda
mašina/radnika (`avgLPerHa` ostaje null radi kompatibilnosti). Pregled mašina
upućuje na novi tab, a izvozi više ne predstavljaju taj količnik kao potrošnju.

## Obračun i tumačenje

- Izvor je završeno zaduženje sa poznatim početnim i završnim litrima:
  početno stanje + točenja tokom zaduženja − završno stanje.
- Dopune pripadaju intervalu [assignedAt, returnedAt). Računa se ceo interval,
  uključujući radove van izabranog perioda, pa se tek onda bira period izveštaja.
- Potrošnja se raspodeljuje završenim radovima iste mašine/radnika i parcele
  kada je parcela navedena na zaduženju, u kalendarskim danima zaduženja.
  Raspodela koristi sate ako su pozitivni za sve radove, inače hektare.
  Pošto FieldWork nema obavezan precizan vremenski interval, ovo je procena
  po radu, a ne direktno izmerena potrošnja pojedinačne operacije.
- Više mogućih zaduženja istog dana, preklopljena zaduženja mašine, nulta
  površina, negativan bilans i nedostajuće stanje ne generišu zaključak o normi.
- L/ha koristi samo hektare obuhvaćene obračunom. Ukupni hektari i broj
  radova bez obračuna prikazani su zasebno. Bez podataka rezultat je prazan,
  a ne nulta ili optimalna potrošnja. Stvarno nulta potrošnja ostaje nula.
- Norme su trenutne vrednosti šifarnika, uključujući neaktivne operacije koje
  imaju radove u periodu. Do +10% je optimalno, preko +10% upozorenje,
  preko +25% prekoračenje. Odstupanja raspodele traže proveru i nisu dokaz krađe.
- Ukupni trošak označava evidentirana točenja u periodu. To nije cena
  potrošenog goriva: nema pouzdane nabavne cene početnog stanja rezervoara.
  Računi bez unete cene nisu uračunati.
- Namerno nema zamene nedostajućeg bilansa agregiranim sipanjima: to bi
  ponovo poistovetilo sipano i potrošeno gorivo. Obuhvat je vidljiv direktoru.

PDF sadrži operacije, obuhvat, potrošnju, trošak točenja i kritične radove.
Excel ima listove „Gorivo normativi” i „Gorivo odstupanja”. Oba izvoza ponovo
učitavaju izveštaj za izabrane datume, nezavisno od otvorenog taba.

## Verifikacija

- `npm.cmd run build` u frontend: TypeScript i Vite prolaze.
- Backend: `node --test --test-force-exit tests/fuel-validation.test.js tests/analytics-fuel-efficiency.test.js tests/inventory-concurrency.test.js tests/analytics-batch.test.js`:
  42 testa prolaze, jedan PostgreSQL test je preskočen.
- `npm.cmd run test:fuel`: pet testova prolazi.
- ESLint za nove fajlove FuelEfficiency.tsx i fuelEfficiencyReport.ts prolazi.
  Postojeći dashboard fajlovi i dalje imaju ranije any tipove i setState u efektima;
  zato se ne tvrdi da ceo projekat prolazi lint.
- UI pregled i klik na izvoz nisu provereni: browser access host i native pipe
  nisu dostupni u ovoj sesiji. Potrebna je vizuelna provera u prijavljenoj
  direktorskoj sesiji, za prazan period i period sa završenim zaduženjima.

Ovaj lokalni walkthrough je dostupan u projektu; spoljašnji Gemini walkthrough
iz plana nije menjan.

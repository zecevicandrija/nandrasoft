# Formule izveštaja i status LOT-a — FPA-008

## Gorivo

Stari izveštaj specifične potrošnje iz `fuel.js` već je zamenjen direktorskom analitikom u `fuelEfficiency.js` i `fuelEfficiencyQuery.js`. Ona polazi od radova, pa isti rad od 10 ha ostaje 10 ha bez obzira na broj sipanja. Potrošnja je bilans početno gorivo + sipanja u periodu zaduženja − završno merenje; sipano gorivo se ne izjednačava automatski sa potrošnjom.

Dodate su regresije sa dva sipanja, 40 L i 60 L, uz početno i završno stanje 100 L na jednom radu od 10 ha: potrošnja 100 L, površina 10 ha, specifična potrošnja 10 L/ha. Proveren je i stvarni SQL izveštaj, preko lokalnih privremenih tabela koje ne menjaju poslovne podatke.

`PUT /fuel/entries/:id` više ne postavlja `hasAnomaly=false` i ne briše `anomalyReason`. Istorijska oznaka ostaje sačuvana pri izmeni napomene ili drugih polja; nova procena potrošnje pripada analitici završenih zaduženja.

## Đubrivo

Na parceli je neto izdato/utrošeno = izdavanje − povrat. To su obrnuti znakovi od skladišnog bilansa, gde izdavanje smanjuje, a povrat povećava stanje. Prijem u magacin ne predstavlja primenu na parceli i zato se ne dodaje utrošku parcele.

Izveštaj po parceli učitava kretanja hronološki, zadržava datum i kulturu poslednjeg kretanja i sabira potpisane količine i troškove bez svođenja međuzbira na nulu. Isto važi za mesečni KPI neto izdavanja. Izlaz 100 kg pa povrat 20 kg daje 80 kg bez obzira na ulazni redosled. Količine se zaokružuju tek nakon agregacije.

Povrat u periodu u kojem originalno izdavanje nije obuhvaćeno može dati negativan neto iznos. On se ne skriva nulom; i razrada po proizvodima zadržava negativne stavke. Provereni su pretvaranje tona, decimalni troškovi i odsustvo cena iz pogleda radnika.

## LOT i ture luka

Isporuka zatvara konkretnu turu, a ne nužno ceo LOT. Kod primera sa 5.000 kg, posle sortiranja/pakovanja/otpreme 4.000 kg prva tura je isporučena, a LOT je `U_OBRADI` zbog preostalih 1.000 kg sirovog luka. Posle obrade i otpreme drugih 1.000 kg obe ture su isporučene i LOT može postati `ISPORUCEN`.

Pri otpremi se iz zapisa svih pakovanja sabiraju istorijska ukupna i preostala masa. Preostala I klasa je kumulativno sortirana I klasa minus ukupno ikada spakovano, uključujući već otpremljeno. LOT se zatvara samo kada nema sirovog luka, neupakovane I klase, sitnog luka i preostalih pakovanja. Već evidentirani otpad ne predstavlja preostalu robu. Mala stvarna preostala masa ili negativno neslaganje ne prikrivaju se starom tolerancijom od 0,1 kg.

Status isporučene ture usklađen je sa postojećim frontend poređenjima: `ISPORUCEN`, umesto ranijeg API stringa `ISPORUCENO`. Praćenje po turama, delimična otprema i prikaz preostalog pakovanja ostaju odvojeni od zbirnog LOT statusa.

## Provera

- `tests/analytics-fuel-efficiency.test.js` i `tests/fuel-efficiency-pagination.test.js`: dva sipanja / jedan rad i pravi SQL.
- `tests/machine-fuel-concurrency.test.js`: izmena napomene ne briše anomaliju i ne menja litre.
- `tests/fertilizer-reporting.test.js`: neto količine, cene, redosled, povrat prethodnog perioda i preciznost.
- `tests/onion-shipment-status.test.js`: obe ture kroz sortiranje, pakovanje, otpremu i sledljivost; sve faze preostalog lagera, delimična otprema i rollback.

Ciljano je prošlo 117 backend i 18 frontend testova; jedan nepovezani opcioni test zaključavanja nije uključen. Poslovni podaci i ranije upisani LOT statusi nisu automatski menjani.

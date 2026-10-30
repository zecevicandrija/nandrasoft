# Zaštita i pregled stanja — 30.10.2026.

## Zaštita konkurentnih izmjena

Mutacije u modulima đubriva, goriva, luka i putarina prolaze kroz `inventoryMutation` u `lib/inventoryTransaction.js`. Jedna PostgreSQL transakcija uzima zajedničku transakcionu bravu modula **prije prvog čitanja stanja**. Obuhvaćeni su prijem, izdavanje, povrat, pakovanje, isporuka, izmjena i storniranje zapisa, kao i inicijalizacija kataloga đubriva.

Brava je u bazi, pa zaštita važi između različitih backend procesa. Izmjene unutar istog modula čekaju jedna drugu; različiti moduli imaju različite ključeve. To je namjerna zamjena dijela paralelizma za dosljednost zbirnih obračuna. Implementacija koristi [PostgreSQL transaction-level advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS), koje se oslobađaju pri završetku transakcije. Svaka buduća ruta koja mijenja te zalihe mora koristiti istu bravu. Ručni SQL i druge aplikacije nisu automatski obuhvaćeni.

Postojeće unutrašnje transakcione grupe koriste isti transakcioni klijent. Odgovor o uspjehu šalje se tek nakon potvrđenog commita. Odgovor greške iz kontrolera vraća cijelu operaciju unazad, uključujući stanje, evidenciju i revizorski zapis. Čekanje brave i trajanje transakcije su ograničeni; konflikt vraća grešku, bez automatskog ponavljanja zahtjeva.

ENP promjene koriste i atomske `increment`/`decrement` upise. Točenje provjerava ukupan nivo u rezervoaru, a izmjena izvora goriva provjerava cijeli dodatni utrošak cisterne. Brisanje prijema cisterne i povrata đubriva ne dozvoljava prikrivanje nedostajućih zaliha.

## Provjera

- Regresioni testovi pozivaju stvarne Express kontrolere sa kontrolisanom transakcionom bazom u memoriji: istovremeno izdavanje 70 + 70 od zalihe 100, prijemi/povrati, pakovanje, isporuka istih pakovanja, ponovno uređivanje i dvostruko storniranje, ENP plaćanja/dopuna, gorivo, neuspješan revizorski upis i greška pri commitu.
- Stvarna PostgreSQL brava dodatno je provjerena kroz dvije paralelne transakcije: druga operacija ušla je u kontroler tek nakon završetka prve. Ta provjera nije mijenjala poslovne podatke.
- Testovi kontrolera ne zamjenjuju provjeru fizičkog lagera niti test opterećenja produkcije.

## Pregled postojećih podataka

`npm.cmd run inventory:audit` radi poređenje u transakciji `READ ONLY` / `RepeatableRead` i piše `reports/inventory-review.json`. Skripta nema opciju za primjenu korekcija.

Prvi pregled: 6 artikala đubriva (5 sa neevidentiranim početnim saldom ili razlikom), 8 LOT-ova luka (1 razlika), 38 vozila (1 ENP saldo bez odgovarajućeg neto zbira dopuna i plaćanja). Knjigovodstveno stanje cisterne: 11.000 L prijema − 260 L izdavanja = 10.740 L. Fizičko stanje cisterne i potrošnja u mašinama nisu time potvrđeni.

Razlike đubriva odgovaraju početnim količinama iz starog podrazumijevanog kataloga: UREA 3.200 kg, YaraMila 2.500 kg, Kristalon 180 kg, KAN 650 kg i početni NPK 4.500 kg (trenutno 200 kg nakon 4.300 kg neto izdavanja). To ukazuje na nedostajuću početnu evidenciju, ne dokazuje fizički manjak. ENP vozila GAZ ima 4.000 RSD bez odgovarajućeg neto iznosa u evidenciji. Ova stanja nisu prepisivana niti su kreirani izmišljeni prijemi/dopune.

## Jednokratna korekcija testnog LOT-a

Korisnik je potvrdio da je `LOT-20261029-P01-01` testni podatak i odobrio njegovu korekciju ovog puta. Samo `rawStockKg` tog LOT-a usklađen je sa postojećom evidencijom: **819.000 → 800.000 kg**. Izmjena je izvršena pod istom transakcionom bravom, uz provjeru očekivanog prethodnog stanja, i naknadno provjerena.

Revizorski zapis: `cmvvj02jj0000ugu8vfid7nrs`. Izvršilac je označen kao `Codex (user-confirmed test-data maintenance)` / `SYSTEM_MAINTENANCE`; `userId` je tehnička referenca na postojeći nalog koju zahtijeva šema, a ne tvrdnja o autentifikovanom ljudskom izvršiocu. Ostala stanja i izvorni poslovni zapisi nisu mijenjani.

Za produkciju je potrebno potvrditi početne količine i fizički popis te ENP saldo sa izvodom operatera prije eventualnih korekcija. Samo poređenje evidencije ne može utvrditi fizičko stanje.

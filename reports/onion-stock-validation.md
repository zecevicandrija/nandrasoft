# Validacija izmena lagera luka

## Pravila

- `PUT /packaging/:id` validira dozvoljena polja i računa granicu nove mase kao ukupno sortirano I klase minus ukupna masa svih drugih pakovanja istog LOT-a. Otpremljena masa ostaje potrošena sirovina. Promena mase ne sme preći tu granicu.
- Posle delimične ili potpune otpreme nisu dozvoljene promene tipa i jedinične težine niti smanjenje broja komada ispod otpremljenog. Broj paleta se pri promeni mase računa kao masa / 1.000 kg; tekstualnu oznaku paleta korisnik proverava zasebno.
- `PUT /storage/:id` menja raspored već evidentiranog sirovog luka, bez povećanja ili smanjenja `OnionLot.rawStockKg` i bez prepisivanja `OnionStorageEntry.quantityKg`. Granica količine na lokaciji je sirovi lager LOT-a minus količine na ostalim lokacijama tog LOT-a.
- Smanjenje količine na lokaciji oslobađa neraspoređeni sirovi luk; nije otpis. Novi ulaz se knjiži kroz dovoz, a fizički gubitak kroz otpis.
- Promena količine zahteva `correctionReason`. Audit `KOREKCIJA` čuva autora, vreme, pre/posle, razlog, razliku i LOT. Upis audita i poslovnih podataka je jedna transakcija pod postojećim zaključavanjem.
- Kapacitet komore iz šifarnika proverava se zbirno kroz sve LOT-ove, uključujući stare zapise bez ID-a komore. Proveravaju se kg i broj boksova; za nenaveden broj boksova koristi se zaokruživanje mase / 1.100 naviše. Provera važi i pri kreiranju skladišnog unosa i automatskom skladištenju pri dovozu.
- Postojeća prekoračenja ne blokiraju napomene i smanjenja, ali se ne smeju povećavati niti preneti u drugu komoru preko njenog kapaciteta. Nema automatskog popravljanja istorijskih podataka.

## Regresioni testovi

`npm run test:inventory` uključuje `tests/onion-stock-validation.test.js`:

- Primer LOT-a sa 18.000 kg I klase, 14.000 kg pakovanja od 10 kg (od toga otpremljeno 8.000 kg) i 4.000 kg pakovanja od 5 kg: povećanje 800 na 1.000 džakova se odbija.
- Kada postoji dodatnih 1.000 kg I klase, ista izmena prolazi i broj paleta postaje 5 čak i ako klijent pošalje staru vrednost 4.
- Testovi pokrivaju tačne granice, oslobađanje sirovine smanjenjem pakovanja, delimične/potpune otpreme, neispravne ulaze i promene mase od 0,01 kg.
- Povećanje 800.000 na 805.000 kg uz samo 800.000 kg sirovog lagera se odbija. Dozvoljena korekcija rasporeda ostavlja prvobitni ulaz i ukupan lager netaknutim i pravi audit.
- Proveravaju se zauzetost kroz više LOT-ova, stari nazivi bez ID-a, promena komore, kapacitet pri novom dovozu, konkurentni zahtevi i rollback kada audit zakaže.

## Ručna provera

Na testnim podacima proveriti izmene pakovanja, zaključan tip posle otpreme i ažuriran broj paleta. U izmeni komore broj boksova više ne prepisuje izmerenu količinu. Promena količine zahteva razlog; u Reviziji se može filtrirati akcija Korekcija i otvoriti zapis sa starim i novim stanjem.

## Postojeći podaci

Ova izmena ne izvršava migraciju ni korekciju poslovnih podataka. Ranije evidentiranih 19.000 kg pakovanja uz 18.000 kg I klase i sirovih 805.000 kg uz dokumentovanih 800.000 kg ostaju predmet zasebnog usaglašavanja sa evidencijom i fizičkim stanjem. Kapacitet Komore 1 ostaje vrednost iz šifarnika; kod ga ne menja.

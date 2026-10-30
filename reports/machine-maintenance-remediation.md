# Dostupnost mašine tokom kvara i remonta — 30.10.2026.

Naknadna dopuna za bezbedno ponavljanje zahteva i nacrte obrazaca opisana je u
`durable-submission-remediation.md`; ta dopuna dodaje zasebnu tabelu potvrda.

## Pravila

- Operatersko zaduživanje i prihvatanje naloga za rad dozvoljeni su samo za
  slobodnu, aktivnu mašinu, bez otvorenog kvara ili servisnog naloga.
- Aktivni kvarovi su `OTVOREN`, `U_RADU` i `CEKA_DELOVE`. Aktivni remontni
  nalozi su `PLANIRAN`, `DODELJEN` i `U_TOKU`. Provera zapisa blokira korišćenje
  i kada je status mašine greškom ostao `SLOBODNA`.
- Prihvatanje `REMONT_SERVIS` prebacuje povezani servis u `U_RADU` i nalog u
  `U_TOKU`. Ne kreira `MachineAssignment` i ne menja gorivo ni moto-sate.
  Gorivo nije obavezno za ovaj zahtev. Nalog bez povezanog servisa odbija se
  uz uputstvo da se otvori u radionici, gde postoji sinhronizacija starih naloga.
- Završetak ili otkazivanje jednog servisa ne oslobađa mašinu dok postoji
  drugi otvoreni kvar ili remontni nalog. Otvoreni terenski kvar daje `U_KVARU`,
  ostali aktivni servisni zapisi `SERVIS`. Bez njih, postojeće operatersko
  zaduženje zadržava `ZADUZENA`; tek bez svih prepreka mašina postaje `SLOBODNA`.
- Završetak servisa i ponovno otvaranje završene popravke obavljaju se u
  radionici. Opšta izmena naloga ne dozvoljava zaobilaženje tih prelaza niti
  promenu mašine/vrste servisnog naloga koja bi prekinula vezu sa servisom.
- Razduživanje ispravne mašine takođe proverava druge aktivne servisne zapise.
  Ručno označavanje mašine kao slobodne kroz šifarnik odbija se dok postoje
  servis ili zaduženje. Unos rada na njivi sa ID-em naloga ne zaobilazi blokadu.

## Transakcije

`lib/machineAvailability.js` koristi postojeći transakcioni mehanizam sa
posebnim PostgreSQL advisory ključem za mašine. Zaduživanja, radionica,
mutacije radnih naloga i radova na njivi, kao i izmena mašine u šifarniku,
uzimaju istu bravu pre prvog poslovnog čitanja. Sinhronizacija pri listanju
starih remontnih naloga takođe je obuhvaćena.

Brava je zajednička za sve mašine i backend procese. To serijalizuje ove
operacije, uz ograničeno čekanje i trajanje transakcije. Unutrašnje transakcije
pridružuju se spoljašnjoj `ReadCommitted` transakciji. Greška kontrolera ili
commita vraća celu operaciju, uključujući nalog, kvar, mašinu i revizorski zapis.
Push obaveštenja čekaju uspešan commit. Parcijalni UNIQUE indeks ostaje dodatna
zaštita od dvostrukog aktivnog zaduženja. Direktni SQL i drugi programi koji
ne koriste ovu bravu nisu obuhvaćeni pravilima dostupnosti.

Početni ekran za remontni nalog vodi u radionicu, umesto na operatersko
zaduživanje ili prijavu rada na njivi.

## Provera

Prošlo je svih **65 backend testova**, uključujući PostgreSQL provere:

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
node --test tests/*.test.js
Remove-Item Env:TEST_ASSIGNMENT_DB
```

Novi testovi pokrivaju vraćanje oštećene mašine, preuzimanje popravke, čekanje
delova, završetak i ponovno otvaranje, više kvarova/remonta, preostalo zaduženje,
blokadu preko oba toka zaduživanja, unos rada sa nalogom, ručnu izmenu statusa,
konkurentno otvaranje servisa i zaduživanje, kao i rollback pri grešci.
Poseban test potvrđuje da druga stvarna PostgreSQL transakcija čeka advisory
bravu pre ulaska u kontroler. Test indeksa koristi privremenu tabelu sesije.
Poslovni podaci nisu menjani ovim proverama.

Frontend `npm.cmd run build` prolazi. Ostaje upozorenje bundlera o veličini
izlaznog JavaScript paketa.

Ova izmena ne zahteva novu migraciju. Potrebno je pokrenuti backend i frontend
sa izmenjenim kodom; ranije kreiran UNIQUE indeks treba da ostane primenjen.
Postojeći poslovni zapisi nisu automatski prepravljani.

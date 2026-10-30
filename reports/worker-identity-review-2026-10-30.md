# Pregled veza korisnika i radnika — 30.10.2026.

Pregled je izvršen nad bazom koju koristi trenutna backend konfiguracija. Prvobitni pregled nije mijenjao podatke; naknadna potvrđena korekcija opisana je na kraju izvještaja.

## Obuhvat

- 6 korisničkih naloga i 16 profila radnika.
- 5 naloga ima povezan profil; direktor nema povezan profil.
- 11 profila radnika nema korisnički nalog. To samo po sebi nije greška: radnik ne mora imati pristup aplikaciji.
- Pregledano je 27 radova, 31 zaduženje, 5 zapisa goriva i 3 putarine. Nije pronađen zapis čiji je kreator običan korisnik, a radnik nije povezan s njegovim korisničkim ID-jem. Menadžeri legitimno mogu kreirati zapise za druge radnike.
- Baza sadrži i 19 radnih naloga. Postojeća dodjela sama po sebi ne dokazuje da je pripisana pravoj osobi.

## Veza koja zahtijeva potvrdu identiteta

| Podatak | Vrijednost |
| --- | --- |
| Korisnički nalog | magacin@nandra.rs |
| Ime naloga | Bojan Ćorović |
| User ID | nAFi3Ey5qhNQqaTIFxyMiNXzYPgetWuD |
| Trenutni Worker | Jovan Magacin |
| Trenutni Worker ID | cmvqwu2050000fgu81mhz1w45 |
| Kandidat za ispravnu vezu | Bojan Ćorović |
| Kandidat Worker ID | cmvtzs7as000jrku8oo7lu6iq |

Razlika imena je signal za provjeru, a ne dokaz identiteta. U bazi postoji zaseban aktivan i nepovezan profil Bojana Ćorovića.

Provjereni su svi brojači relacija oba profila: Jovanov profil nema povezanih poslovnih zapisa. Bojanov profil ima 6 prijema luka (`onionHarvestArrivals`); ostali brojači su 0. Nalog ima 1 sesiju u trenutku pregleda.

## Konkretna predložena korekcija

Nakon potvrde da nalog pripada Bojanu: u jednoj transakciji odvezati navedeni User ID od Jovanovog Worker ID-ja, povezati isti User ID sa Bojanovim Worker ID-jem i obrisati sve sesije tog naloga. Prije izmjene ponovo provjeriti da su obje veze u očekivanom stanju. Sačuvati revizorski trag izmjene.

Ne brisati profile, ne prepisivati imena i ne premještati poslovne zapise. Šest prijema luka ostaje na Bojanovom postojećem Worker ID-ju. Korekcija veze omogućava tom nalogu pristup podacima tog profila, u okviru ovlašćenja njegove uloge.

## Ograničenja nalaza

Poklapanje imena drugih povezanih profila i odsustvo navedenih nepodudaranja ne dokazuju identitet osoba niti ispravnost cjelokupne poslovne istorije. Automatsko utvrđivanje identiteta iz imena nije korišćeno za izmjene.

## Izvršena potvrđena korekcija

Korisnik je eksplicitno potvrdio povezivanje naloga sa postojećim Bojanovim profilom. Korekcija je izvršena 30.10.2026. u 22:55:31 po vremenu Europe/Belgrade (21:55:31 UTC).

- U jednoj transakciji nivoa `Serializable` provjereno je očekivano stanje obje veze, odvezan Jovanov profil, povezan Bojanov profil i opozvane sve sesije naloga.
- Opozvana je 1 sesija; naknadnom provjerom potvrđeno je 0 preostalih sesija.
- Potvrđeno je da nalog sada pokazuje na Worker ID `cmvtzs7as000jrku8oo7lu6iq`, a prethodni profil ima `userId: null`.
- Brojači svih poslovnih relacija oba profila ostali su nepromijenjeni. Bojanovih 6 prijema luka ostalo je na njegovom profilu. Nijedan profil niti poslovni zapis nije obrisan ili premješten.
- Revizorski zapis: `cmvvigtg20000l0u8gyxsamm5` (`UserWorkerLink`, `IZMENA`). Izvršilac je označen kao `Codex (user-confirmed maintenance)` / `SYSTEM_MAINTENANCE`. Polje `userId` u ovom zapisu označava pogođeni nalog, a ne identitet autentifikovanog ljudskog izvršioca; to je izričito navedeno u opisu i metapodacima zapisa.

Status: potvrđena korekcija izvršena i naknadno provjerena. Ostale veze nisu mijenjane.

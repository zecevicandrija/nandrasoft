# Arhiviranje mašina i komora — DATA-004

## Ponašanje

`DELETE /master/machines/:id` sada u transakciji zaključava mašinu i postavlja `isActive=false`. Ne poziva fizičko brisanje. Istorija putarina, ENP dopuna, goriva, radova, naloga i ostalih veza zadržava isti ID mašine. Ponovljeno arhiviranje vraća uspeh bez dodatnog audit događaja.

Pre arhiviranja proveravaju se aktivno zaduženje, stanje `ZADUZENA`, otvoreni radni nalozi (i upotreba kao priključak) i servisi. Te obaveze moraju se prvo zatvoriti ili otkazati. PUT sa `isActive=false` koristi iste provere. Arhiviranje i ponovno aktiviranje beleže audit u istoj transakciji; greška audita poništava promenu statusa.

`DELETE /onion/chambers/:id` postavlja `isActive=false` umesto brisanja komore i svih njenih skladišnih zapisa. Komora sa preostalim lukom ne može da se arhivira. Provera obuhvata i legacy zapise bez `chamberId`, povezane nazivom komore. Novim skladišnim unosima nije dozvoljen izbor arhivirane komore; istorijski zapisi i LOT sledljivost ostaju sačuvani.

Operativni spiskovi i kapaciteti prikazuju aktivne stavke. Prazni istorijski zapisi arhiviranih komora ne stvaraju ponovo lažne aktivne lokacije u dashboardu. Frontend nema rezervni fiksni spisak komora kada je stvarni aktivni spisak prazan. Stare mašine/komore ostaju u istorijskim relacijama i ne uklanjaju se iz izveštaja.

Backend dodatno odbija arhivirane mašine za novo zaduživanje, direktno zaduženje, rad na njivi, novo točenje, novi nalog, novi servis, prolazak kroz naplatnu rampu, ENP dopunu i vozilo novog dovoza. Izmene koje menjaju izabranu mašinu/priključak takođe ne mogu izabrati arhiviranu stavku. Postojeći istorijski podaci mogu se čitati i dozvoljeno korigovati bez fizičkog uklanjanja mašine.

## Aktiviranje i pregled arhive

Mašina se može ponovo aktivirati preko menadžerskog `PUT /master/machines/:id` sa `{"isActive":true}`. Komora ima isti oblik promene preko `PUT /onion/chambers/:id`. Ponovno aktiviranje čuva identitet i istoriju.

Menadžerski `GET /master/machines?includeInactive=true` može prikazati ceo šifarnik; podrazumevani i radnički izbori prikazuju aktivne mašine. Komore podržavaju `GET /onion/chambers?includeInactive=true`. U ovom koraku nije dodata posebna UI stranica za upravljanje arhivom.

## Migracija

Pre pokretanja novog backenda, iz `backend` izvršiti:

```text
npm run db:deploy
```

Migracija `20261101001000_archive_machines_and_chambers` dodaje `onion_chambers.is_active` sa podrazumevanim `true`, tako da postojeće komore ostaju aktivne. Veze `toll_entry.machineId` i `toll_top_up.machineId` menjaju se sa kaskadnog na restriktivno brisanje: PostgreSQL odbija fizičko brisanje mašine koja ima takvu istoriju. Veza skladišnog zapisa sa komorom već je restriktivna.

Migracija ne arhivira i ne briše postojeće poslovne podatke. Primenjena je na lokalnu bazu `nandrasoft` tokom ispravke greške nedostajućeg `is_active` polja. Svih 7 postojećih komora ostalo je aktivno; broj poslovnih zapisa pre i posle migracije je isti. `npm run db:status` potvrđuje da je baza usklađena. Na drugim bazama i dalje treba izvršiti `npm run db:deploy` pre pokretanja novog backenda.

## Provera

Prošlo je 154 ciljanih backend testova i 19 frontend testova, uz uspešan build i 3 preskočena opciona integraciona testa. Novi PostgreSQL test radi nad privremenim tabelama: proverava očuvanje istorije tokom arhiviranja, podrazumevani aktivan status starih komora i odbijanje fizičkog brisanja roditelja sa istorijom.

Regresije obuhvataju ponovljeno arhiviranje, ponovno aktiviranje, blokiranje otvorenih obaveza, zabranu PUT zaobilaženja, konkurentno zaduživanje/arhiviranje, rollback audita, stare skladišne veze po nazivu i sakrivanje prazne arhive iz aktivnog dashboarda. Pokretanje: `npm run test:archival`; pravi PostgreSQL test uključuje se sa `TEST_ARCHIVE_DB=1`.

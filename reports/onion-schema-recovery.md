# Oporavak učitavanja modula luk

Uzrok Prisma greške P2022 bila je neprimenjena migracija `20261101001000_archive_machines_and_chambers`: novi kod je čitao `onion_chambers.is_active`, a kolona još nije postojala. Lookup, dashboard i drugi upiti zato nisu mogli da vrate podatke. Frontend nije prikazivao grešku i koristio je prazne nizove i fiksne kapacitete kao rezervne vrednosti.

## Primenjena ispravka

`npm run db:deploy` primenio je obe preostale migracije na lokalnu bazu `nandrasoft`: indeks isteka sesija i arhiviranje mašina/komora. Svih 7 komora ostalo je aktivno. Provera svih 37 Prisma modela prema PostgreSQL metapodacima nije našla druge nedostajuće tabele ili kolone. Status svih 15 migracija je usklađen.

Broj zapisa pre i posle migracija ostao je isti: 38 mašina, 7 komora, 8 skladišnih zapisa, 3 putarine, 2 ENP dopune, 4 pakovanja i 3 isporuke. Nisu menjane poslovne količine niti brisani poslovni zapisi.

Svih 10 čitanja u modulu luk sada koristi zajedničku obradu HTTP/mrežnih grešaka, proveru oblika odgovora i prekid zastarelih zahteva. Zajednički podaci i svaki tab prikazuju obaveštenje i ponovni pokušaj. Neuspešno prvo učitavanje ne prikazuje prazan lager; neuspešno osvežavanje uz postojeće podatke prikazuje upozorenje da su podaci od prethodnog učitavanja. Uklonjeni su fiksni rezervni kapaciteti i broj komora.

## Provera

Direktno su provereni stvarni GET upiti rutera uz vezu sa bazom u PostgreSQL režimu `default_transaction_read_only=on`. Autentikacija je zamenjena samo u procesu provere; stvarni korisnici i sesije nisu menjani. Ukupno 30 postojećih ruta vratilo je HTTP 200: svi tokovi luka i odabrana čitanja šifarnika, goriva, putarina, održavanja, radova na njivi, radnih naloga, đubriva i sezonaca. Ovo je provera API-ja, ne automatizovana provera prikaza u pregledaču.

Frontend regresije pokrivaju grešku svakog resursa, ponovni pokušaj sa istim filterima, stvarno prazan uspešan rezultat, nepotpun odgovor, očuvanje keširanih podataka pri grešci osvežavanja i kasni odgovor otkazanog zahteva. Ciljani frontend testovi: 16 prošlo. Backend arhiviranje/komore/gorivo: 32 prošlo, 3 opciona PostgreSQL testa preskočena. Produkcioni frontend build prolazi.

Na drugim instalacijama pokrenuti `npm run db:deploy` pre pokretanja novog koda. Za osvežavanje otvorene aplikacije učitati stranicu ponovo.

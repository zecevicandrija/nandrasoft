# Atomska sinhronizacija radnika i identitet komora — 31.10.2026.

## Radnici

Kreiranje, izmena i brisanje radnika kroz šifarnik i modul Sezonci sada
koriste zajednički transakcioni okvir i istu PostgreSQL advisory bravu
za izmene profila. Poslovne provere i povezani upisi izvršavaju se nad
istim Prisma transakcionim klijentom.

Greška sinhronizacije više se ne ignoriše preko `.catch(console.error)`.
Ako ažuriranje korisničke role, radnika, sezonskog profila ili commit
ne uspe, ceo zahtev se poništava i vraća grešku. Odgovor se šalje tek
posle uspešnog commita. U izmeni običnog radnika korisnički nalog se
ažurira pre vraćanja radnika sa relacijom `user`, tako da odgovor sadrži
i novu rolu korisnika. Novi nedostajući sezonski profil preuzima podatke
iz ažuriranog radnika, uključujući nepromenjene kontakt podatke.

Postojeći način pronalaženja odgovarajućeg sezonskog profila po imenu nije
ovom izmenom zamenjen novim identitetom; transakcija obezbeđuje atomske
upise. Ova izmena ne povezuje korisničke naloge automatski po imenu.

## Komore i zalihe

Ruta za preimenovanje komore već je bila unutar `inventoryMutation("onion")`,
pa opis delimičnog commita komore nije važio za trenutno stanje koda.
Tekstualna veza sa skladišnim zapisima ipak je zamenjena opcionim
`OnionStorageEntry.chamberId` stranim ključem ka `OnionChamber.id`.
Korišćeni su postojeći stabilni tekstualni ID-jevi; prebacivanje njihovog
tipa na numerički ne bi povećalo referencijalnu sigurnost i zahtevalo bi
nepotrebnu promenu postojećih identifikatora.

Za komore iz šifarnika, dovoz sa automatskim skladištenjem, ručno
skladištenje i premeštanje zapisa čuvaju `chamberId`. Klijent šalje taj ID.
Server njime određuje komoru i njen važeći naziv čak i kada je naziv iz
otvorenog obrasca zastareo. Nepostojeći ID se odbija; nema prebacivanja na
drugu komoru sa sličnim imenom. Naziv ostaje polje za prikaz i kompatibilnost.
Stari klijenti sa važećim nazivom komore i dalje rade: server jednom razreši
naziv i upiše stabilni ID. Novi nepoznati nazivi hladnjača se odbijaju.
Slobodne tekstualne lokacije magacina ostaju podržane bez veze sa katalogom.

Preimenovanje i promene tipa/opreme propagiraju se po `chamberId`, zajedno
sa izmenom kataloga u jednoj transakciji. Statistika grupiše povezane zalihe
po ID-ju. Provera zauzetosti i brisanje prazne komore takođe koriste ID;
strani ključ sa `ON DELETE RESTRICT` dodatno sprečava brisanje komore dok
postoje povezani skladišni zapisi. Ruta zadržava dosadašnji postupak
brisanja praznih skladišnih redova pre brisanja komore.

## Migracija i deployment

`20261031003000_storage_chamber_identity` dodaje kolonu, indeks i strani
ključ. Postojeće zapise povezuje poređenjem naziva bez razlike velikih i
malih slova i spoljašnjih razmaka. Dvosmisleni nazivi komora zaustavljaju
migraciju; ne bira se proizvoljan ID. Neprepoznate stare lokacije ostaju
sa `chamberId = null`, uz očuvanje podataka. Njih treba razvrstati ručno
ako predstavljaju komore koje nedostaju u šifarniku.

Migracija je prvo proverena u izolovanoj test šemi. Dana 31.10.2026.
primenjena je i na lokalnu bazu `nandrasoft` (`localhost:5432`, šema `public`)
nakon prijavljene greške P2022 zbog nedostajuće kolone `chamberId`.
`prisma migrate status` potvrđuje usklađenu šemu, a Prisma klijent je
ponovo generisan. Za deployment drugih instalacija zaustaviti stare procese koji menjaju katalog/zalihe,
pokrenuti `npm run db:deploy` i `npm run db:generate`, pa pustiti novi
backend i frontend. Stari procesi ne treba da nastavljaju upise bez FK
veze nakon migracije.

## Provera

Svih 56 pokrenutih backend testova prolazi, bez preskočenih provera;
frontend build takođe prolazi. Pokriveni su rollback pri grešci korisnika,
radnika, sezonskog profila i commita, oba smera sinhronizacije, zaštita
uloga, preimenovanje komore sa zastarelim prikaznim nazivima, čuvanje i
izmena skladišnog zapisa po ID-ju, kompatibilnost starih zahteva i odbijanje
nepoznatog ID-ja. PostgreSQL test proverava backfill, dvosmislene nazive,
FK zabrane i rollback neuspelog preimenovanja. Deploy test proverava
kompletan skup migracija i usklađenost sa Prisma šemom.

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
node --test tests/worker-sync-transaction.test.js tests/onion-chambers.test.js tests/migrations.test.js tests/financial-idempotency.test.js tests/inventory-concurrency.test.js tests/master-workers-privacy.test.js
```

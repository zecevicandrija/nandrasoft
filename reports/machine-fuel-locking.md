# Zaključavanje i verzionisanje goriva mašina

## Ponašanje

Transakcioni klijent zaključava red `machine` preko parametrizovanog `SELECT id ... FOR UPDATE` pre čitanja konkretne mašine. Kada ruta učitava mašinu kroz `fuelEntry`, `machineAssignment`, `workOrder` ili `fieldWork`, prvo se učita samo `machineId`, zatim zaključa mašina, pa tek onda učita odnos sa aktuelnim stanjem. Isti red tako koordinira različite domenske advisory ključeve.

Postojeći domenski ključevi ostaju: npr. sve promene cisterne i dalje su serijalizovane ključem `fuel`, a tokovi zaduživanja ključem `machines`. Ovo nije potpuno uklanjanje serijalizacije unutar pojedinačnog domena. PostgreSQL zaključavanje reda dodatno povezuje njihove upise u istu mašinu.

Sipanje koristi Prisma `increment`. Izmena točenja dodaje razliku nove i stare količine, a storno oduzima evidentiranu količinu. Kapacitet i negativno stanje proveravaju se pod istim zaključavanjem. Nepoznat stari nivo (`NULL`) inicijalizuje se prepoznatom razlikom umesto SQL sabiranja sa `NULL`. Količina se više ne svodi tiho na nulu pri prevelikom oduzimanju.

Svaka apsolutna izmena nivoa goriva zahteva `expectedMachineUpdatedAt`, verziju mašine koju je forma koristila pri unosu. To obuhvata razduživanje, rad na njivi, zaduživanje, direktno zaduživanje/razduživanje, preuzimanje naloga i izmenu mašine kroz šifarnik. Provera ne zahteva novu kolonu ni migraciju. Verzija je postojeći `Machine.updatedAt`, pa i druga izmena mašine može konzervativno zahtevati ponovno potvrđivanje merenja.

Zastarela, neispravna ili nedostajuća verzija daje `409 MACHINE_STATE_CHANGED` pre upisa poslovnih podataka. Timeout zaključavanja daje `409 INVENTORY_BUSY`, čak i kada ga kontroler uhvati. Verzija svih upisa kroz zajednički klijent monotono raste za najmanje milisekundu, uključujući naknadnu sinhronizaciju statusa.

Forme za razduživanje i rad na njivi čuvaju verziju uz nacrt; automatsko osvežavanje upita ne menja je tiho. Eksplicitno osvežavanje prikazuje poslednji nivo i briše polje merenja da korisnik ponovo proveri i unese stvarno stanje. Ponovljeno slanje posle izgubljenog odgovora zadržava istu verziju i idempotency ključ; potvrđen zahtev vraća sačuvan uspeh bez ponovne primene.

## Primeri

- Stanje 50 L; prvo se sačuva merenje 40 L, zatim sipa 20 L: rezultat 60 L.
- Stanje 50 L; prvo se sipa 20 L, zatim stigne merenje 40 L iz stare forme: sipanje ostaje sačuvano, stanje je 70 L, merenje dobija 409 i ne zatvara zaduženje. Korisnik mora proveriti novo stanje pre ponovne potvrde.
- Dva sipanja po 20 L na početnih 50 L: rezultat 90 L ako kapacitet to dozvoljava.

## Provera

`tests/machine-fuel-concurrency.test.js` proverava oba redosleda konkurentnih upita za sipanje/izmenu/storno i razduživanje, rad na njivi, obavezan i svež vremenski žig, verzije unutar iste milisekunde, atomske razlike, kapacitet, negativno stanje, NULL nivo, rollback i replay zahteva.

`TEST_FUEL_LOCK_DB=1 node --test tests/machine-fuel-concurrency.test.js` uključuje pravi PostgreSQL test. On čita dve postojeće mašine, dokazuje blokiranje istog reda između domena `fuel` i `machines`, kao i da drugi red može da se čita. Koristi samo SELECT/SET i transakcije; ne kreira, menja niti briše poslovne ili šemske podatke.

Validacija ove izmene: 162 backend testa prošla, 5 nepovezanih opcionih integracionih testova preskočeno; 25 frontend testova i produkcioni build prošli. Širi backend paket nije potpuno zelen: auth-role, master-workers-privacy, worker-sync-transaction i push-outbox imaju ukupno 10 prijavljenih padova uključujući roditeljske testove. Ti padovi reprodukovani su i bez novog ponašanja zaključavanja, zamenom isključivo transakcionog modula u memoriji test procesa; izvori nisu privremeno prepisivani.

Poslovni podaci i ranija stanja goriva nisu automatski popravljani.

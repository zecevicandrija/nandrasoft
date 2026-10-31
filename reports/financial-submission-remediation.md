# Idempotencija dnevnica i točenja goriva — 31.10.2026.

Zaštićeni su `POST /api/seasonal/logs/group`, pojedinačni
`POST /api/seasonal/logs` i `POST /api/fuel/entries`. Proširen je postojeći
mehanizam `mutation_receipt`, koji se već koristi za druge poslovne unose.

## Server

Kontroleri koriste `inventoryMutation` sa uključenom idempotencijom.
Autentifikacija i postojeća middleware ograničenja prethode proveri potvrde.
Korisnikov ID i `Idempotency-Key` identifikuju zahtev. Potvrda čuva rutu,
SHA-256 otisak tela, HTTP status i JSON odgovor.

Transakcija prvo uzima domensku advisory bravu, a zatim bravu za korisnika
i ključ. Druga brava pokriva i istovremeno korišćenje istog ključa na
različitim podržanim domenima. Ako potvrda postoji i odgovara zahtevu,
server vraća prethodni odgovor pre poslovnih provera i upisa. Ista operacija
se zato može potvrditi i ako je gorivo iz prvog pokušaja već podiglo nivo
rezervoara ili su podaci o dnevnicama naknadno promenjeni.

Drugo telo ili druga ruta sa istim ključem daje 409 i
`IDEMPOTENCY_MISMATCH`. Različiti korisnici imaju odvojene ključeve.
Ključ se validira pre pokretanja transakcije.

Svi grupni radni zapisi, kao i potvrda odgovora, pripadaju jednoj
transakciji. Za gorivo ista transakcija obuhvata unos, promenu nivoa goriva,
audit i potvrdu. Greška poslovnog upisa, upisa potvrde ili commita poništava
celu operaciju. Poslovno odbijanje ne ostavlja potvrdu. Postojeći klijenti
bez zaglavlja ostaju kompatibilni i nemaju zaštitu od ponovnog slanja.

Potvrde se ne brišu posle kratkog vremenskog prozora: zakašnjeli zahtev sa
istim ključem i dalje vraća prvi rezultat. Novi ključ označava namerno novu
operaciju; isti poslovni podaci sa novim ključem nisu automatski zabranjeni.

## Klijent

Obrasci za točenje, pojedinačne i grupne dnevnice koriste postojeći
`useDurableSubmission`/`sendDurably`. Pre mrežnog zahteva lokalno se čuvaju
UUID, URL i tačno telo zahteva, odvojeno po korisniku i vrsti unosa. Ovo
uključuje originalni timestamp goriva: retry ne generiše novi datum.

Kod gubitka veze, nečitljivog odgovora ili serverske greške prethodni
zahtev ostaje sačuvan. Dugme **Ponovi prethodno slanje** ponavlja isti
payload i ključ, čak i posle osvežavanja stranice ili zatvaranja modala.
Novi unos je blokiran dok se prethodni ne potvrdi. Oporavak je dostupan
i izvan zatvorenog modala. Tek potvrđen uspeh uklanja lokalni zahtev.
Validaciona greška bez upisa omogućava ispravku i novi ključ. Ako lokalna
memorija ne može da sačuva zahtev, mrežno slanje se ne pokreće.

Ova izmena čuva poslati zahtev, ne sva polja pre prvog slanja. Ključevi i
nepotvrđeni zahtevi ne prenose se između uređaja, a brisanje podataka
pregledača uklanja ih. Obični radnik pri unosu goriva ne mora da dobije
tuđe `userId` veze iz javne liste: server određuje njegov `workerId` iz
autentifikovanog naloga.

## Baza i provera

Nova migracija nije potrebna. Instalacija mora imati postojeću migraciju
`20261030230000_mutation_receipts`. Backend i frontend sa ovim izmenama
treba pustiti zajedno. Poslovni zapisi nisu naknadno deduplikovani.

Prošlo je 66 backend testova sa `TEST_ASSIGNMENT_DB=1`, bez preskočenih
testova, i pet klijentskih testova. Frontend build takođe prolazi.

Obuhvaćeni su paralelni unosi i replay stvarnih Express kontrolera,
izostanak duplih dnevnica/troškova/stanja/audita, delimičan neuspeh grupe,
rollback pri grešci potvrde ili commita, promenjen zahtev, drugi korisnik,
novi namerni unos i kompatibilnost postojećih poslovnih provera.
PostgreSQL test koristi nasumičnu izolovanu šemu i nezavisne konekcije:
šest istovremenih zahteva daje jedan poslovni upis, a korišćenje istog
ključa u dva domena daje jedan uspeh i jedan 409. Test šema se uklanja po
završetku; poslovni podaci se ne menjaju. Klijentski test potvrđuje
očuvanje ključa i payload-a za sva tri obrasca posle prekida i ponavljanja.

```powershell
# backend
$env:TEST_ASSIGNMENT_DB = '1'
node --test tests/financial-idempotency.test.js tests/mutation-receipt.test.js tests/inventory-concurrency.test.js tests/worker-identity.test.js tests/work-order-access.test.js tests/machine-maintenance.test.js

# frontend
npm.cmd run test:submissions
npm.cmd run build
```

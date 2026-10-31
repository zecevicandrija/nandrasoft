# Numeracija naloga i otpremnica — 31.10.2026.

Radni i servisni nalozi koriste isti godišnji brojač `RN-GGGG-`, a
otpremnice zaseban `OTP-GGGG-`. Format ostaje sa najmanje četiri cifre;
posle `9999` sledi `10000` bez tekstualnog sortiranja i traženja rupa.

`lib/documentNumbers.js` dodeljuje broj jednim parametrizovanim PostgreSQL
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` upitom nad tabelom
`document_counter`. Upsert zaključava red za odgovarajući prefiks do kraja
transakcije i bezbedan je i pri prvom upisu za novu godinu. Dodela i
kreiranje dokumenta koriste istog transakcionog klijenta; neuspeh vraća i
brojač i poslovne promene. Uspešno iskorišćen broj se ne vraća brisanjem
dokumenta. Postojeći unique indeksi ostaju dodatna zaštita.

Obuhvaćeni su `routes/workOrders.js`, `routes/maintenance.js` i
`routes/onion.js`. Postojeće domenske advisory brave su zadržane; one su
već serijalizovale ove rute. Novi brojač uklanja zavisnost numeracije od
skeniranja postojećih dokumenata i tekstualnog maksimuma. LOT numeracija
nije menjana.

Ručno uneti brojevi otpremnica ostaju podržani. Broj u obliku
`OTP-GGGG-cifre` podiže brojač te godine na najmanje unetu vrednost, u
istoj transakciji. Niža vrednost ga ne vraća unazad. Prilagođeni brojevi,
npr. `CUSTOM/123`, ne ulaze u automatski brojač. Ručni duplikat i dalje
odbija unique ograničenje, uz rollback zaliha i brojača.

## Migracija i puštanje u rad

`20261031002000_document_counters` kreira tabelu i inicijalizuje svaki
postojeći prefiks numeričkim maksimumom iz `work_order` i `onion_shipment`.
Dok čita postojeće brojeve, migracija blokira izmene tih tabela. Postojeći
dokumenti i njihovi brojevi ostaju nepromenjeni.

Za deployment zaustaviti stare backend procese koji izdaju dokumente,
pokrenuti `npm run db:deploy` i `npm run db:generate`, pa pokrenuti novu
verziju. Stara i nova implementacija numeracije ne treba da istovremeno
izdaju dokumente jer stara ne ažurira brojače. Migracija je testirana u
izolovanim šemama, a 31.10.2026. primenjena je i na lokalnu bazu
`nandrasoft` (`localhost:5432`, šema `public`). Postojeći dokumenti nisu
prenumerisani; brojači su inicijalizovani postojećim maksimumima.

## Provera

Testovi pokrivaju inicijalizaciju iz postojećih brojeva, novu godinu,
prelazak 9999/10000, ručne brojeve, brisanje poslednjeg dokumenta, rollback
i zajedničku numeraciju običnih i servisnih naloga. PostgreSQL test koristi
šest nezavisnih konekcija i 24 konkurentne transakcije u nasumičnoj
izolovanoj šemi, koja se po završetku briše. Ne menja poslovne dokumente.

Pokretanje cele relevantne grupe sa PostgreSQL proverama (PowerShell):

```powershell
$env:TEST_ASSIGNMENT_DB = '1'
node --test tests/document-numbers.test.js tests/migrations.test.js tests/machine-maintenance.test.js tests/inventory-concurrency.test.js tests/work-order-access.test.js
```

Svih 45 testova prolazi, bez preskočenih PostgreSQL provera.
`prisma validate` i generisanje Prisma klijenta takođe prolaze. Deploy test
proverava migracije od prazne baze, ponovljeni deploy i odsustvo razlike
između migrirane šeme i `schema.prisma`.

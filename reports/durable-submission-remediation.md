# Bezbedno ponavljanje zahteva i čuvanje unosa — 30.10.2026.

Naknadno je istorija povezane baze usklađena sa kompletnim migracijama,
uključujući ovde opisanu migraciju potvrda. Aktuelni postupak primene opisan je
u `migrations-remediation.md`; ručni `db execute` koraci ispod predstavljaju
prvobitnu primenu pre tog usklađivanja.

## Ponašanje korisnika

Obuhvaćeni obrasci su brzi unos rada na njivi, razduživanje mašine i izdavanje
novog radnog naloga u dispečingu. Popunjena polja čuvaju se u lokalnoj memoriji
pregledača, odvojeno po korisniku i obrascu; rad po nalogu ima zaseban nacrt
za svaki ID naloga. Nacrti se vraćaju nakon osvežavanja stranice. Uspešno
potvrđeno slanje briše nacrt i lokalni zapis tog zahteva.

Pre slanja klijent trajno čuva UUID ključa, odredište i tačan poslati sadržaj.
Ako nema potvrde, dugme **Ponovi prethodno slanje** šalje isti zahtev istim
ključem. Dugme je dostupno i unutar modala. Radi i kada mašina više nije
među aktivnim zaduženjima jer je prvi pokušaj već uspeo.

Ako korisnik izmeni obrazac dok prethodni ishod nije potvrđen, aplikacija ne
pretvara prethodni pokušaj u novi zahtev. Dugme za oporavak izričito ponavlja
prethodno poslati sadržaj, bez slanja novih izmena. Posle potvrde korisnik može
započeti novu operaciju. Greške validacije i poslovni konflikti bez upisa
oslobađaju ključ za ispravljeni unos, uz očuvanje nacrta. Mrežne greške,
nečitljiv odgovor i serverske greške zadržavaju prethodni zahtev.

Ako lokalna memorija ne može da sačuva zahtev, slanje se ne pokreće. Gubitak
mreže ne označava rad kao završen: korisnik vidi da slanje nije potvrđeno i
može ručno ponoviti pokušaj kada veza proradi. Automatsko slanje u pozadini i
poseban postupak za rukovodioca nisu dodati ovom izmenom.

## Backend

`Idempotency-Key` je podržan za POST zahteve kroz `machineMutation`.
Autentifikacija i postojeća middleware ograničenja izvršavaju se pre pristupa
potvrdi. Ključ je vezan za ID korisnika; čuvaju se ruta i SHA-256 otisak tela
zahteva. Drugi sadržaj ili druga ruta sa istim ključem daju HTTP 409.

Posle zajedničke transakcione brave, server prvo traži ranije potvrđen odgovor.
Ako postoji, vraća isti status i telo, bez ponavljanja poslovnog kontrolera
ili push obaveštenja. Ako ne postoji, poslovni upisi i zapis odgovora u
`mutation_receipt` potvrđuju se **u istoj transakciji**. Greška pri upisu
potvrde ili commitu poništava i poslovne upise. Odbijeni zahtevi ne ostavljaju
potvrdu. JSON otisak ne zavisi od redosleda polja objekta.

Postojeći klijenti bez zaglavlja ostaju kompatibilni, ali nemaju ovu zaštitu.
Novi ključ znači novu operaciju; zaštita ne pokušava da prepozna da li su dva
namerno nova unosa sa istim poslovnim podacima zapravo duplikati.

Potvrde se trenutno ne brišu automatski. Njihovo brisanje bi omogućilo da
zakasneli zahtev sa starim ključem ponovo izvrši upise, pa eventualna politika
čuvanja mora obuhvatiti i rok u kome klijenti smeju da ponavljaju zahteve.
Nacrti važe za isti pregledač/origin i uređaj; ne prenose se na drugi telefon,
a ručno brisanje podataka pregledača uklanja i lokalni nacrt/ključ.

## Baza i primena

U povezanoj bazi primenjena je migracija
`prisma/migrations/20261030230000_mutation_receipts/migration.sql`, a Prisma
klijent ponovo je generisan. Migracija dodaje samo tabelu potvrda; postojeći
poslovni zapisi nisu prepravljani.

Za druge instalacije sa šemom održavanom kroz `db push`, proveriti da tabela
još ne postoji, pa iz `backend` direktorijuma izvršiti:

```powershell
npx.cmd prisma db execute --file prisma/migrations/20261030230000_mutation_receipts/migration.sql
npx.cmd prisma generate
```

`db execute` ne upisuje istoriju u `_prisma_migrations`. Instalacije sa
usklađenom istorijom migracija koriste svoj redovan postupak. Novi frontend
treba pustiti uz backend koji ima ovu podršku i primenjenu tabelu.

## Provera

- **73 backend testa prolaze**, sa `TEST_ASSIGNMENT_DB=1`: ponovljeni zahtev,
  konkurentni pokušaji, gubitak odgovora, promenjen sadržaj/ruta, drugi korisnik,
  rollback pri grešci upisa potvrde i commita, te regresije postojećih modula.
- Stvarni Express kontroleri provereni su za ponovljeni završetak rada posle
  zatvaranja naloga i ponovljeno razduženje već zatvorenog zaduženja.
- PostgreSQL test koristi privremene tabele i potvrđuje zajednički commit i
  rollback poslovnog zapisa i potvrde. Ne menja poslovne tabele.
- **4 klijentska testa prolaze** kroz `npm.cmd run test:submissions` u frontend
  direktorijumu: ponovno slanje nakon gubitka odgovora, očuvanje ključa i tela,
  odbijanje izmene nepotvrđenog zahteva, klasifikacija grešaka i neuspešno
  lokalno čuvanje. Testiraju mehanizam slanja, ne ceo prikaz obrazaca u pregledaču.
- Frontend `npm.cmd run build` prolazi; bundler upozorava na veličinu paketa.

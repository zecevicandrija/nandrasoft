# Pozadinsko slanje notifikacija radnih naloga — 31.10.2026.

## Ponašanje

Kreiranje naloga više ne čeka push provajdera. Rute radnih naloga i
servisnih naloga u istoj transakciji sa poslovnim upisima dodaju zapise
u PostgreSQL `push_outbox`. HTTP odgovor se vraća nakon commit-a.
Rollback uklanja i posao slanja, a ponavljanje zahteva sa postojećim
idempotency ključem ne izvršava handler ponovo.

Za svaki postojeći pretplaćeni uređaj eksplicitno povezanog, aktivnog
korisnika nastaje zaseban posao. Ako nema takvog naloga ili pretplate,
nema slanja. Ne koriste se imena radnika za povezivanje identiteta.
Uspešno dostavljen uređaj dobija terminalno stanje `SENT`, pa kvar
drugog uređaja ne izaziva ponovno slanje uspešnom uređaju.

Worker unutar backend procesa proverava red na svake dve sekunde i
preuzima do dva posla atomskim `FOR UPDATE SKIP LOCKED` upitom.
Slanje se obavlja izvan transakcije i HTTP toka. Najviše dva poziva
iz ovog workera po procesu rade istovremeno. Novi pokušaji posle
privremene greške čekaju **30 sekundi, zatim 2 minuta, zatim 10 minuta**
od prethodnog neuspeha, uz mali dodatak do sledećeg polling ciklusa.
Ukupno se pokušava četiri puta u uobičajenom toku.

## Provera da li je poruka još potrebna

Pre svakog spoljnog poziva, uključujući prvi i svaki retry, worker
ponovo čita aktuelni nalog. Slanje je dozvoljeno samo za `PLANIRAN` ili
`DODELJEN`, istom radniku i istom aktivnom korisniku. Prihvatanje u
postojećem kodu postavlja `U_TOKU`; takvi nalozi se preskaču, kao i
završeni, otkazani, obrisani i preusmereni nalozi. Samo otvaranje
aplikacije ne smatra se prihvatanjem.

Nova dodela/ponovno aktiviranje poništava starije poslove za taj nalog.
Proveravaju se i vlasništvo pretplate i vlasništvo nad lease-om posla.
Poruke starije od 24 sata se preskaču. Obaveštenje vodi na `/nalozi`
trenutnog web origin-a, a ne na localhost.

Između poslednje provere i spoljnog slanja ostaje kratak vremenski
prozor: prihvatanje tokom već započetog slanja ne može pouzdano da
povuče poruku. Push takođe nije potvrda da je radnik poruku video.

## Timeout, oporavak i čišćenje

`web-push` generiše šifrovano telo i VAPID zaglavlja. Slanje koristi
native `fetch` i `AbortSignal.timeout(3000)`, čime rok obuhvata DNS,
povezivanje i čekanje odziva, umesto samo socket inactivity timeout-a.
Preusmeravanje nije dozvoljeno. I postojeća direktna test slanja imaju
isti timeout i ograničenu paralelnost.

Greške transporta, HTTP 408/429 i 5xx se ponavljaju. HTTP 404/410
uklanja isteklu pretplatu i završava posao bez retry-ja. Ostale 4xx
greške i iscrpljeni pokušaji završavaju kao `FAILED`. U bazu i log
upisuje se klasifikacija greške, bez endpoint-a, auth ključeva ili tela
odziva provajdera.

Preuzet posao ima lease od 60 sekundi. Posle pada procesa drugi worker
može da preuzme posao po isteku lease-a. Slanje je **at-least-once**:
pad baš nakon prihvatanja poruke kod provajdera, a pre upisa `SENT`,
može izazvati duplikat pri oporavku. Postojeći service worker koristi
tag po ID-ju naloga, što grupiše obaveštenja, ali nije garancija
exactly-once isporuke.

Terminalni zapisi se brišu posle sedam dana, u ograničenim serijama
do 500 redova pri periodičnoj proveri na sat vremena. Bez podešenih
VAPID ključeva worker ne preuzima poslove. Pri SIGTERM/SIGINT prestaje
preuzimanje i čeka se tekuće slanje pre zatvaranja Prisma pool-a,
unutar postojećeg ukupnog roka gašenja.

Bunny upload nije povezan sa ovim redom i ostaje sa postojećim
timeout-om od 30 sekundi. Nisu dodati Redis niti drugi servisi.

## Migracija i provera

Dodati su Prisma model i migracija `20261031008000_push_outbox`.
Klijent je regenerisan. Migracija je primenjena na lokalni
`localhost:5432/nandrasoft`; produkciona baza nije menjana. Pri
postavljanju promene prvo izvršiti `npm run db:deploy`, pa pokrenuti
novi backend.

`TEST_ASSIGNMENT_DB=1 npm run test:push` prolazi sa 10 testova,
uključujući stvarni lokalni HTTP poziv koji se prekida nakon tri
sekunde, atomskost enqueue/rollback-a, nevidljivost necommitovanih
poslova, konkurentno preuzimanje i oporavak lease-a na PostgreSQL-u.
Testovi proveravaju prihvatanje između pokušaja, statuse, promenjenog
primaoca, rokove ponavljanja, pojedinačne uređaje i isteklu pretplatu.

Provera kompletnih migracija od prazne šeme prolazi. Prolaze i
regresije servisnih naloga, transakcionih receipt-a i graceful
shutdown-a. Testovi provajdera koriste lokalni simulirani servis;
stvarne notifikacije radnicima nisu slane.

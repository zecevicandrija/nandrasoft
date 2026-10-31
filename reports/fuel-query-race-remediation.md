# Redosled odziva i prikaz grešaka goriva — 31.10.2026.

## Nalaz i izmena

`frontend/src/Gorivo/GorivoDashboard.tsx` više ne učitava podatke kroz
ručne efekte i lokalne settere. Svi njegovi GET zahtevi sada koriste
TanStack `useQuery`: šifarnici, statistika, filtrirana evidencija,
prijemi cisterne, analitika, anomalije, današnja točenja i istorija radnika.
Storniranja koriste `useMutation` i zajedničku obradu neuspešnog odziva.

`frontend/src/Gorivo/fuelQueries.ts` definiše ključeve po korisniku,
resursu, filterima, opsegu i stranici. Query `AbortSignal` prosleđuje se
direktno u `fetch`. Promena filtera ili napuštanje taba otkazuje prethodni
upit ako više nema aktivnog posmatrača. Odgovor starog ključa ne upisuje se
u prikaz novog ključa ni kada transport ne ispoštuje otkazivanje.
Nije uključeno prenošenje rezultata prethodnog filtera kroz placeholder.

Upiti čekaju identitet prijavljenog korisnika. Menadžerske evidencije
učitavaju se na odgovarajućem tabu, a istorija radnika tek po otvaranju.
Promena filtera resetuje odgovarajuću paginaciju. Uspešan upis ili
storniranje invalidira podatke goriva tog korisnika; neaktivne istorije
čekaju sledeće otvaranje. Šifarnici imaju zaseban prefiks keša.

Zahtevi koriste relativni `/api` prefiks i uključuju kredencijale,
umesto fiksnog `localhost` URL-a u dashboardu. Postojeće javne putanje
API-ja nisu promenjene.

## Greške i oporavak

Neuspešan HTTP odgovor postaje Query greška. UI prikazuje jasnu poruku,
serversku poruku kada postoji i dugme „Pokušaj ponovo”. Neispravan HTML
odziv posrednika dobija HTTP status u poruci; mrežni prekid dobija poruku
za proveru veze. Abort ostaje otkazivanje i ne prikazuje se kao greška.

Greške evidencija ne prikazuju se kao uspešan prazan rezultat, a neuspešno
osveženi podaci te evidencije ne ostaju predstavljeni kao ažurni.
Filteri i ostatak ekrana ostaju dostupni za promenu i ponovni pokušaj.
Statistika, šifarnici i storniranja imaju zasebne poruke o neuspehu.

`QueryErrorNotice` je zajednička komponenta poruke sa `role="alert"`.
`AppErrorBoundary` u `main.tsx` pokriva greške renderovanja i odbijeno
učitavanje lazy ruta. Omogućava ponovni pokušaj uz reset grešaka keša
ili potpuno ponovno učitavanje aplikacije. Greške HTTP zahteva u gorivu
obrađuju se u samom prikazu: Error Boundary sam ne hvata asinhrone
greške mrežnih zahteva.

Opseg konverzije je dashboard goriva; zasebne forme/modali i drugi moduli
nisu globalno prepisivani.

## Provera

`npm.cmd run test:fuel`: svih 5 testova prolazi. Proveravaju:

- A počinje pre B, završava posle B, a prikaz ostaje B; signal A je
  otkazan, čak i kada simulirani transport ipak vrati odgovor;
- HTTP grešku i uspešan ponovni pokušaj sa istim filterima;
- otkazivanje pri uklanjanju posmatrača i razdvajanje korisnika,
  opsega, filtera i stranica;
- invalidaciju bez prevremenog učitavanja zatvorene istorije;
- razumljive mrežne/HTTP poruke i očuvanje AbortError semantike.

`npm.cmd run build` prolazi. Zajedničko izvršavanje testova za gorivo,
bundle splitting i modul luka prolazi sa **12/12 testova**. Testovi
koriste stvarne Query observere i simulirani fetch; nisu ručna provera
svih ekrana u pregledaču.

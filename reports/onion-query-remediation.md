# Učitavanje modula luka po aktivnom tabu — 31.10.2026.

## Izmena

`frontend/src/Luk/OnionDashboard.tsx` sada uključuje upite preko `enabled`
samo kada je otvoren odgovarajući tab. Dovoz koristi evidenciju dovoza i
LOT listu; skladište, sortiranje, pakovanje, isporuka i otpis koriste svoje
evidencije. Sledljivost zahteva otvoren tab i izabranu LOT oznaku.

KPI i šifarnici ostaju zajednički jer su kartice stalno vidljive, a forme
se mogu otvoriti iz zaglavlja nezavisno od taba. Početni tab zato pokreće
4 upita umesto prethodnih 9 bezuslovnih upita i naknadnog upita sledljivosti.
Brojevi označavaju porodice API zahteva pri uspešnom početnom učitavanju,
bez ponovljenih pokušaja usled greške.

`frontend/src/Luk/onionQueries.ts` definiše zavisnosti izmena. Umesto
`refreshAll`, svaka uspešna izmena invalidira svoje evidencije i povezano
stanje. Na primer, sortiranje utiče i na skladište, isporuka na raspoloživa
pakovanja, a dovoz na skladište samo kada je uključen automatski smeštaj.
Izmena naziva parcele invalidira i evidencije koje prikazuju taj naziv.
Kreiranje kupca ili parcele ne osvežava nepovezane istorijske evidencije.

Invalidacija obuhvata keširane stranice i filtere pogođene porodice.
Neaktivni tabovi ostaju označeni kao zastareli i učitavaju se kada se
otvore; samo omogućeni upiti odmah ponavljaju zahtev. Ručno dugme
„Osveži” obuhvata zajedničke podatke i trenutni tab.

Upiti koriste `staleTime: 30_000`, pa brz povratak na tab ponovo koristi
sveže podatke. Invalidacija nakon izmene i ručno osvežavanje važe odmah,
nezavisno od ovog intervala.

Početni LOT u modalima dolazi iz zajedničkih šifarnika. Izbor raspoloživih
pakovanja za isporuku takođe dolazi iz šifarnika, bez prepisivanja svežeg
stanja starom keširanom stranicom pakovanja.

## Provera

- `npm.cmd run test:onion`: sva 4 testa prolaze. Koriste stvarne TanStack
  Query observere i proveravaju početna 4 upita, promene svih tabova,
  ponovno korišćenje keša, povezane invalidacije, odloženo učitavanje
  neaktivnih tabova i ručno osvežavanje.
- `npm.cmd run build`: TypeScript i produkcioni Vite build prolaze.
  Vite prijavljuje upozorenje o veličini izlaznog paketa.

Ova izmena smanjuje broj frontend zahteva. Ne menja količinu podataka
koju postojeće backend rute dashboarda i šifarnika obrađuju po zahtevu.

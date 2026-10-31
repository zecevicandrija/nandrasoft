# REL-001 — greške i otkazivanje zahteva za naloge i radionicu

`frontend/src/Nalozi/RadniNaloziDashboard.tsx` i
`frontend/src/Masine/RadionicaKvarovi.tsx` koriste zajedničke query opcije
iz `frontend/src/lib/operationalQueries.ts` umesto ručnog učitavanja u efekte.

## Ponašanje

- Svaki GET proverava HTTP status pre korišćenja odgovora. Mrežne greške,
  neispravan JSON i neispravni spiskovi izazivaju Query error stanje.
- Liste naloga, kvarova, remonta i servisne istorije koriste
  `QueryErrorNotice`: jasnu poruku, detalj greške i dugme „Pokušaj ponovo“.
  Greška ima prednost nad praznim stanjem, uključujući neuspešno osvežavanje
  ranije uspešno učitanih podataka.
- Statistika radionice i šifernici imaju sopstvene prikaze grešaka i ponovno
  učitavanje. Šifernici prikazuju poruke i u otvorenim formama. KPI naloga
  se ne prikazuju kao nule kada učitavanje naloga nije uspelo.
- TanStack Query AbortSignal prolazi do fetch poziva i proverava se pre
  vraćanja podataka. Promena filtera, stranice ili korisnika, kao i odlazak
  sa stranice, otkazuju nepotrebne upite. Zakašnjeli odgovor ne menja novi prikaz.
- Samo aktivni tab radionice učitava svoju listu. Promena taba izričito
  otkazuje ostale liste: samo `enabled: false` nije dovoljna garancija da je
  zahtev koji je već počeo otkazan. Otkazivanje se ne prikazuje kao greška.
- Query ključevi sadrže identitet korisnika, ulogu, resurs i sve parametre,
  uključujući filtere i broj stranice. Ponovni pokušaj zadržava iste parametre.
- Promena filtera radionice odmah vraća efektivnu stranicu na 1, bez dodatnog
  zahteva za stari broj stranice. Postojeća pretraga sa odlaganjem je očuvana.
- Uspešne izmene invalidiraju odgovarajuće keširane podatke. Neaktivne liste
  ostaju označene za osvežavanje, a učitavaju se tek pri otvaranju taba.
  Push poruke osvežavaju naloge kroz invalidaciju istog korisničkog keša.
- Zahtevi za upis zadržavaju postojeće postupanje i poruke o greškama.
  Njih ne otkazujemo pri prelasku na drugi tab jer upis možda već traje na serveru.

## Provere

- `npm.cmd run build`: TypeScript i Vite prolaze.
- `node --test tests/operational-queries.test.ts tests/durable-submission.test.ts tests/fuel-queries.test.ts`:
  svih 16 testova prolazi.
- `npm.cmd run test:operational`: šest ciljnih testova za REL-001.
- ESLint za `src/lib/operationalQueries.ts` prolazi.

Testovi koriste QueryObserver i kontrolisane fetch odgovore: provereni su
HTTP error i retry za svih devet resursa, mrežni/neispravni odgovori,
izolacija filtera i korisnika, otkazivanje pri odlasku, promena taba dok
zahtev traje, zakašnjeli odgovori transporta koji ignoriše signal i neuspešno
osvežavanje kada keš već sadrži podatke.

Vizuelna provera u pregledaču nije izvedena; browser host nije dostupan u
ovoj sesiji. Provere mrežnih stanja izvedene su kroz automatizovane testove.

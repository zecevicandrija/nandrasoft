# RACE-004 — kritične forme i bezbedno ponavljanje slanja

Zaštićeni su:

- `POST /api/onion/shipment` — jedna otpremnica, jedan broj i jedno skidanje robe.
- `POST /api/fertilizer/issue` — jedno izdavanje, povrat ili otpis zaliha.
- `POST /api/tolls` — jedan zapis putarine i jedno umanjenje ENP kredita.
- `POST /api/tolls/top-up` — jedan zapis dopune i jedno uvećanje ENP kredita.

## Klijent

Forme koriste postojeći `useDurableSubmission` i odvojene opsege
`onion-shipment`, `fertilizer-issue`, `toll-entry` i `toll-top-up`.
Pre prvog POST zahteva originalni URL, payload i slučajni ključ trajno se
čuvaju u localStorage, odvojeno po korisniku i formi. Zahtevi šalju
`X-Idempotency-Key` i kompatibilni `Idempotency-Key` sa istom vrednošću.

Sinhroni ref sprečava dva submit handlera pre nego što React stigne da
onemogući dugme. Ako potvrda izostane, zahtev ostaje sačuvan, a ekran i
otvorena forma nude „Ponovi prethodno slanje“. To dugme šalje originalni
sačuvani payload, čak i kada je korisnik izmenio vidljive podatke ili je
prva operacija već iscrpela zalihu. Ne potvrđuje se novi zahtev na osnovu
trenutno izmenjenog obrasca dok prethodni nije razrešen.

Potvrđen zahtev se uklanja iz lokalne memorije; sledeći namerni unos dobija
novi ključ. Zatvaranje modala i reload ne brišu nepotvrđen zahtev. Forma za
novu putarinu odvojena je od forme za izmenu, tako da PUT nikada ne prepiše
payload sačuvanog POST zahteva. Izmena postojeće putarine ostaje PUT.

Mrežna greška, nečitljiv odgovor, JSON bez objekta potvrde, serverska greška
ili `INVENTORY_BUSY` zadržavaju ključ. Validacione greške bez upisa dopuštaju
ispravku obrasca. Neusaglašenost originalnog ključa i payload-a ostaje
blokirana kroz `IDEMPOTENCY_MISMATCH`.

## Server

Navedene rute sada uključuju `{ idempotent: true }` u `inventoryMutation`.
Pod domenskim i korisničkim zaključavanjem server proverava sačuvani receipt
pre poslovnih provera ili upisa. Originalni odgovor se vraća bez ponovnog
generisanja broja, izmene zalihe/kredita ili duplog audit zapisa.

Poslovni upis, brojač dokumenta i receipt se potvrđuju atomarno u jednoj
transakciji. Greška audita, čuvanja receipt-a ili commit-a poništava sve
pripadajuće promene. Isti ključ sa drugim payload-om ili rutom vraća 409;
drugi korisnik ima zaseban prostor ključeva.

`mutationReceipt` prihvata oba naziva zaglavlja. Ako su oba prisutna sa
različitim vrednostima, vraća 400 pre upisa. Postojeći klijenti bez ključa
ostaju kompatibilni; za ponavljanje njihovih POST zahteva nema garantovane
idempotentnosti. Nove navedene forme uvek šalju ključ.

Privremeni konflikt baze vraća `409 / INVENTORY_BUSY`, da klijent ne bi
generisao novi ključ dok prethodna kopija zahteva možda još radi na serveru.
Nema nove migracije: koristi se postojeća tabela iz migracije
`20261030230000_mutation_receipts`, koja mora biti primenjena pri deploy-u.

## Provere

- Frontend: `npm.cmd run test:submissions` — 11 testova prolazi.
- Frontend: `npm.cmd run build` — TypeScript i Vite prolaze.
- Backend, uz `TEST_ASSIGNMENT_DB=1`:
  `node --test --test-force-exit tests/critical-form-idempotency.test.js tests/mutation-receipt.test.js tests/inventory-concurrency.test.js tests/financial-idempotency.test.js`
  — 65 testova prolazi, bez preskočenih testova.

Novi testovi pozivaju stvarne Express rutere sa izolovanim transakcionim
modelima i proveravaju tri paralelna slanja plus kasniji replay, jedan
dokument/broj, jedno skidanje robe ili promenu kredita, jedan audit i receipt,
neusaglašen payload/rutu, oba naziva zaglavlja i izolaciju korisnika.
Provereno je i ponavljanje nakon potpunog iscrpljenja zalihe, kao i rollback
na greškama audita, receipt-a i commit-a.

PostgreSQL testovi potvrđuju atomski rollback receipt-a i poslovnog upisa
u privremenim tabelama i serijalizaciju paralelnih zahteva u izdvojenoj
test šemi koja se uklanja po završetku. Poslovni podaci nisu menjani.

Frontend testovi proveravaju iste ključeve i payload pri duplom slanju,
gubitku odgovora i reload-u za sve četiri forme, novi ključ za sledeći
namerni unos, zadržavanje ključa na privremenom konfliktu i neispravan JSON.
Ručni pregled kroz browser nije izveden jer browser host nije dostupan.

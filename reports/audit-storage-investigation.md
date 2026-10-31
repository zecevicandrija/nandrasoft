# Istraživanje audit istorije i prostora — 31.10.2026.

Naknadna implementacija, očuvanje istorije i provere opisani su u
`audit-storage-remediation.md`. Ispod ostaje izvorni izveštaj istraživanja.

Ovo je read-only istraživanje. Nisu menjani kontroleri, šema, podešavanja,
poslovni podaci ili audit zapisi. Nije kreirana arhiva sa ličnim podacima.
Sačuvan je samo ovaj zbirni izveštaj.

## Obuhvat i ograničenje

Izmerena je baza koju trenutni backend koristi: `nandrasoft`, PostgreSQL
na `localhost:5432`, šema `public`. To nije potvrđeno merenje zasebno
hostovane baze sa kvotom od 6 GB. Za produkcijsku odluku ista merenja treba
ponoviti nad tom bazom; sadašnji lokalni uzorak nije dokaz godišnjeg
produkcijskog rasta.

Svi SQL upiti izvršeni su u `BEGIN READ ONLY`, uz statement timeout od
15 sekundi, pa završenoj transakciji preko ROLLBACK-a. Pročitani su stvarni
zapisi radi analize strukture, ali vrednosti ličnih i finansijskih polja
nisu kopirane u izveštaj.

## Stvarno zauzeće

| Mera | Vrednost |
| --- | ---: |
| Audit zapisi | 107 |
| Najstariji datum, Europe/Belgrade | 17.09.2026. |
| Najnoviji datum, Europe/Belgrade | 30.10.2026. |
| Zapisi u septembru / oktobru | 9 / 98 |
| Heap tabele, `pg_relation_size` | 81.920 B = 80 KiB |
| Tabela sa pomoćnim skladištenjem, `pg_table_size` | 163.840 B = 160 KiB |
| Indeksi audita | 65.536 B = 64 KiB |
| Audit ukupno, `pg_total_relation_size` | 229.376 B = 224 KiB |
| Cela lokalna baza u trenutku merenja | 13.121.203 B, oko 13,12 MB |
| Udeo audita u toj bazi | oko 1,75% |
| Mutation receipts | 0 zapisa, 16 KiB alociranog prostora |

Audit ima četiri indeksa od po 16 KiB: primarni ključ, datum, izvršilac i
kombinacija vrste/ID-ja objekta. Oni odgovaraju pregledima i ne treba ih
uklanjati samo radi trenutne uštede od nekoliko desetina KiB.

`oldValues` i `newValues` zajedno imaju 66.993 B kada se mere kao PostgreSQL
JSON tekst. `pg_column_size` tih kolona zbirno daje 54.276 B. To nisu iste
mere kao alocirani fizički prostor tabele i indeksa. Kompaktan JSON
serijalizovan u Node-u ima 62.548 B jer izostavlja dodatne razmake.

Zauzeće je mereno PostgreSQL funkcijama čiji su obuhvati opisani u
[zvaničnoj dokumentaciji](https://www.postgresql.org/docs/current/functions-admin.html).
Ukupna potrošnja koju obračunava hosting provajder može uključivati i
druge stavke, npr. WAL ili backup-e, zavisno od ugovora.

## Ko pravi najveće zapise

| Vrsta i akcija | Broj | Prosečan JSON tekst | Najveći JSON tekst |
| --- | ---: | ---: | ---: |
| FertilizerMovement / IZMENA | 3 | 2.601 B | 2.815 B |
| WorkOrder / KREIRANJE | 17 | 1.834 B | 2.422 B |
| WorkOrder / IZMENA | 11 | 1.634 B | 4.843 B |
| FuelEntry / IZMENA | 1 | 1.504 B | 1.504 B |
| MaintenanceIssue / IZMENA | 36 | 24 B | 47 B |

Ukupno 28 WorkOrder događaja nosi oko 73,3% kompaktnog JSON sadržaja svih
107 audit zapisa. FertilizerMovement nosi dodatnih oko 15%. Ove dve vrste
zajedno daju približno 88% JSON sadržaja, iako predstavljaju 37 od 107
događaja. To određuje prioritet optimizacije načina upisa, a ne izbor
događaja za brisanje.

Ukupno 26 zapisa sadrži ugnježdene objekte ili nizove. Među njima su kopije
`worker`, `machine`, `parcel`, `workType`, `attachment`, `machineAssignments`,
`issuedBy`, `maintenance`, `product` i `supplier`. Njihove vrednosti,
bez dodatnog troška naziva ključeva i JSON omotača, imaju 33.673 B — oko
54% kompaktnog JSON sadržaja.

U kopijama postoje i podaci koji često nisu potrebni za događaj radnog
naloga: npr. telefon i satnica radnika u 26 JSON objekata, kao i kontakt
podaci dobavljača u pet objekata. To je dodatni razlog za namenski izbor
polja za buduće događaje. Ne predlaže se automatsko uklanjanje tih vrednosti
iz već zabeležene istorije.

## Dupliranje i smisao diff-a

17 događaja ima i stare i nove vrednosti. U njima su uporediva 184 ista
ključa najvišeg nivoa, od kojih 144 imaju identične vrednosti na obe strane
(oko 78%). Samo ponovljene vrednosti tih nepromenjenih ključeva imaju
15.622 B; ovo nije procena ukupnog oslobađanja fizičkog prostora.

Formati nisu ujednačeni: negde su obe strane kompletni objekti, a negde
je `oldValues` kompletan objekat i `newValues` samo skup odabranih polja.
Generička naknadna konverzija svih istorijskih redova u diff zato nije
bezbedna: polje koje nedostaje na novoj strani ne mora označavati brisanje
tog polja. Takođe, nepromenjeni istorijski naziv ili vrednost može biti
važna ako je izvorni poslovni objekat kasnije promenjen ili obrisan.

Preporuka je da postojeća istorija ostane neizmenjena, a da se novi događaji
pišu kroz verzionisan, namenski format: identitet događaja, izvršilac,
vreme, poslovni ID i odabrani istorijski kontekst, pa stare/nove vrednosti
za stvarno izmenjena polja. Kreiranje i brisanje traže namenski snapshot
bitnih poslovnih polja; ne mogu svi događaji biti samo diff.

## Pregled istorije i kvalitet pokrivenosti

`frontend/src/Administrator/AuditLogDashboard.tsx` trenutno prikazuje datum,
izvršioca, vrstu objekta, akciju i tekstualni `description`. Ne prikazuje
`oldValues` i `newValues`, iako ih API šalje za svaki red. Moguće je smanjiti
odgovor liste i omogućiti zaseban detaljan pregled bez gubitka podataka.
Samo promena API projekcije ne smanjuje zauzeće baze.

U postojećem auditu nađena su dva istorijska FuelEntry zapisa sa
`entityId = 'new-entry'`. Novi kod je ranije ispravljen, ali ovi stari
zapisi nisu automatski povezivani nagađanjem. Postoje i audit zapisi
kojima odgovarajući poslovni red više nije u tabeli, npr. četiri kretanja
đubriva, dva rada na njivi i četiri putarine. To nije razlog za brisanje
audita: istorija obrisanog događaja često je upravo razlog njegovog čuvanja.

Pregled izvornog koda pokazuje i nedostatak eksplicitnih audit upisa u
`routes/seasonalWorkers.js`, `routes/onion.js` i izmenama radnika u
`routes/masterData.js`. Zajednički `inventoryMutation` vodi transakciju i
idempotenciju, ali sam ne pravi audit događaje. Postojanje starog
OnionLot audita u bazi ne dokazuje da sve današnje operacije luka imaju
audit. Broj od 107 zato ne predstavlja potpun dnevnik svakog poslovnog
upisa i nije dobra osnova za tvrdnju da je sva istorija već pokrivena.

## Eksperiment kompresije bez gubitka događaja

Svih 107 pročitanih redova serijalizovano je u memoriji kao NDJSON,
uključujući metapodatke i obe JSON kolone. Isti sadržaj je komprimovan
gzip-om i dekomprimovan; dobijeni bajtovi bili su identični.

| Tekstualni izvoz | Gzip, nivo 6 | Smanjenje |
| ---: | ---: | ---: |
| 103.167 B | 13.478 B | 86,94% |

Nije kreiran fajl sa sadržajem istorije, nije izvršen upload niti je bilo
brisanja. Ovo potvrđuje kompresiju ovog uzorka bez gubitka bajtova, a ne
postojanje implementiranog arhiviranja ili uspešno testiran SQL restore.
Odnos kompresije nije garantovan za drugačije produkcijske podatke.

## Šta ovo znači za 250.000 događaja i 6 GB

Prosečan JSON tekst u ovom malom uzorku ima oko 626 B. Kada bi 250.000
audit događaja imalo potpuno istu raspodelu, samo JSON tekst bi iznosio
oko 156,5 MB. To ne uključuje ostale kolone, indekse, fizičko skladištenje,
osnovne poslovne tabele ili potvrde idempotencije. Nije prognoza za
produkciju. Kod drugačije raspodele događaja i više audit zapisa po jednoj
operaciji rezultat bi bio drugačiji.

Ne treba linearno množiti 224 KiB / 107 jer male PostgreSQL tabele imaju
značajan trošak delimično popunjenih stranica i minimalne veličine indeksa.
Nema izmerenog dokaza da će sadašnji audit brzo potrošiti 6 GB, ali postoje
jasni nepotrebni veliki snapshot-i i nepostojanje upravljanja rastom.

## Preporučeni redosled bez proizvoljnog brisanja

1. Zadržati sve postojeće audit događaje. Ne prepravljati ih automatski
   niti uklanjati određene vrste samo zato što su velike.
2. Definisati šta mora da postoji u istoriji za svaku važnu operaciju,
   uključujući dnevnice, otpremnice, kalo i izmene radnika. Obezbediti
   njihov audit u istoj transakciji sa poslovnom promenom.
3. Uvesti verzionisane male zapise za sve buduće događaje, sa diff-om
   tamo gde ima smisla i sa dovoljnim snapshot-om pri kreiranju/brisanju.
   Istorijske nazive/identitete ne oslanjati isključivo na današnje stanje.
4. Meriti produkcijsku bazu i rast periodično; upozoravati na 80% odnosno
   oko 4,8 GB i eskalirati pre kritičnog popunjavanja. Uključiti i veličinu
   `mutation_receipt`, koja trenutno ima nula lokalnih zapisa, ali na
   produkciji čuva pune odgovore zahteva.
5. Pripremiti privatnu komprimovanu arhivu svih događaja u zatvorenim
   vremenskim paketima, sa šemom formata, brojem zapisa, ID-jevima, rasponom
   datuma i checksum-om. Arhiva mora imati kontrolu pristupa i proveru
   ponovljenog slanja/izvoza, kao i nezavisan backup.
6. Tek posle provere celovitosti, testa vraćanja i implementiranog pregleda
   arhive razmatrati premeštanje starih paketa van primarne baze. To nije
   proizvoljno brisanje događaja: sva istorija ostaje sačuvana i dostupna.
   Ako se zahteva da svaki događaj stalno ostane baš u PostgreSQL-u, nema
   premeštanja — tada se smanjuju budući zapisi i po potrebi povećava prostor.

Trenutni prioritet je potpun i smislen budući audit uz nadzor zauzeća,
ne hitno čišćenje ove male lokalne istorije. Arhiviranje i alarmi u ovom
istraživanju nisu implementirani.

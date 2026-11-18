# Komunikacija direktora — početna verzija

Ruta: `/komunikacija`. Server proverava aktivnu sesiju i ulogu DIREKTOR na svim `/api/communication` rutama.

## Uključeno

- Svi aktivni radnici iz šifarnika, aktivna zaduženja, radovi i nalozi u toku. Planirani/dodeljeni nalozi su odvojeni od evidentirane lokacije. Više različitih aktivnih lokacija označava se za proveru. Vreme izvora ostaje odvojeno od vremena učitavanja.
- Pregled aktivnih mašina, uključujući slobodne, priključke, kvar i servis. Slobodna mašina nema pretpostavljenu lokaciju u bazi.
- Svi aktivni sezonci sa poslednjom dnevnom evidencijom, jasno označenom kao evidencija, ne potvrda trenutnog prisustva.
- Zajedničke trajne poruke direktora, komentari uz predlog i obaveštenja primaocima u komponenti. Otvaranje obaveštenja prvo učitava sadržaj pa evidentira čitanje. Autor ne dobija obaveštenje za sopstvenu akciju.
- Slanje predloga na pregled dodaje poruku u zajedničku prepisku sa nazivom, verzijom i vezom „Otvori predlog naloga”. Ponovno slanje nakon dorade dodaje novu poruku. Nacrt i samo čuvanje izmene ne dodaju poruku. Migracija `20261110140000_proposal_messages` uključuje i ranija slanja, uz originalno vreme i autora, bez novih notifikacija.
- Predlog: nacrt → pregled (izabrani direktor ili svi) → odobrenje / dorada. Autor može sam odobriti predlog. Samo autor može povući predlog. Svi direktori vide i mogu izmeniti predlog; izmene vraćaju status u nacrt i brišu odobrenje.
- Prikazana verzija sadržaja (`contentVersion`) raste samo kada se podaci predloga zaista promene. Slanje, odobravanje, dorada, povlačenje i komentari ne povećavaju prikazanu verziju. Čuvanje identičnog sadržaja ne menja status niti briše odobrenje. Interni `version` je odvojen brojač za konkurentne izmene i statusne odluke; uslovni UPDATE sprečava prepisivanje zastarelog stanja. Istorija sadrži autora, vreme, akciju i nepromenljiv snimak sadržaja. Migracija `20261110150000_proposal_content_versions` preračunava i raniju istoriju i oznake verzija u porukama.
- Poruke, predlozi i istorija imaju straničenje po 30 zapisa; obaveštenja prikazuju prvih 30 nepročitanih i ukupan broj.
- Osvežavanje aktivne sekcije na 30 sekundi i pri povratku na tab. Za teren postoji ručno osvežavanje. Prag oznake stare evidencije je privremeno 12 sati.

## Granice ove faze

Ne postoji ruta za konverziju niti poziv `WorkOrder.create`. Odobrenje ne rezerviše resurse i ne šalje nalog radniku. Materijali su tekst dogovora; strukturisani izbor materijala i validacija kompletnog radnog naloga dolaze sa konverzijom.

Nema novog GPS izvora, ručne prijave lokacije, SSE, Web Push dostave za komunikaciju niti globalnog zvonca. Radnik bez aktivne operativne evidencije ostaje vidljiv uz nepoznatu lokaciju. Poruke i obaveštenja se čuvaju u bazi, a učitavaju se tokom rada u modulu.

## Pokretanje

Iz `backend` direktorijuma, u odgovarajućem okruženju:

```text
npm run db:deploy
npm run db:generate
```

Restartovati backend i objaviti novi frontend build. `db:deploy` primenjuje sve migracije koje nedostaju, zato pre puštanja proveriti `npm run db:status`. Nova migracija je `20261110120000_director_communication`; ne menja postojeće poslovne tabele.

## Provera

```text
node --test tests/director-communication.test.js
```

Za PostgreSQL proveru uključiti `TEST_COMMUNICATION_DB=1` i pokrenuti `node --test tests/director-communication-postgres.test.js`. Test pravi izolovanu šemu unutar transakcije i sve vraća pomoću ROLLBACK.

Ručni prijemni scenario sa dva direktora:

1. Otvoriti teren, proveriti radnika bez evidencije i nalog koji je samo planiran.
2. Poslati zajedničku poruku; drugi direktor je vidi i otvara obaveštenje.
3. Kreirati nacrt, poslati drugom direktoru, komentarisati i vratiti na doradu sa razlogom.
4. Izmeniti sadržaj, ponovo poslati i odobriti. Proveriti snimak odobrene verzije u istoriji.
5. Izmeniti odobreni predlog: status se vraća u nacrt, odobrenje se briše. Komentar ne briše odobrenje.
6. Otvoriti izmenu iste verzije na dva uređaja; prvo čuvanje uspeva, drugo dobija konflikt bez gubitka svog teksta.
7. Proveriti da se ništa nije pojavilo među stvarnim radnim nalozima i da operater nema pristup komunikaciji.

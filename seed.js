import "dotenv/config";
import { auth } from "./routes/auth.js";
import { prisma } from "./lib/prisma.js";

/**
 * Seed skripta - kreira korisnike i kompletne šifarnike za firmu NANDRA
 * Pokreni sa: node seed.js
 */

const users = [
  {
    name: "Andrija Nandra",
    email: "direktor@nandra.rs",
    password: "nandra123",
    role: "DIREKTOR",
    phone: "+381 64 111 2233",
  },
  {
    name: "Milan Petrović",
    email: "rukovodilac@nandra.rs",
    password: "nandra123",
    role: "RUKOVODILAC",
    phone: "+381 64 222 3344",
  },
  {
    name: "Jovan Magacin",
    email: "magacin@nandra.rs",
    password: "nandra123",
    role: "MAGACIN",
    phone: "+381 64 333 4455",
  },
  {
    name: "Dragan Mehaničar",
    email: "mehanicar@nandra.rs",
    password: "nandra123",
    role: "MEHANICAR",
    phone: "+381 64 444 5566",
  },
  {
    name: "Marko Operater",
    email: "operater@nandra.rs",
    password: "nandra123",
    role: "OPERATER",
    phone: "+381 64 555 6677",
  },
];

const parcels = [
  {
    code: "P-01",
    name: "Mali Iđoš",
    areaHa: 45.0,
    location: "kat. br. 6076/1, 6075/1",
    notes: "Mali Iđoš",
  },
  {
    code: "P-02",
    name: "Crvenka 15",
    areaHa: 15.36,
    location: "kat. br. 8951",
    notes: "Crvenka 15",
  },
  {
    code: "P-03",
    name: "Crvenka 11",
    areaHa: 11.18,
    location: "kat. br. 9233/1",
    notes: "Crvenka 11",
  },
  {
    code: "P-04",
    name: "Crvenka 10",
    areaHa: 10.0,
    location: "kat. br. 350, 8013",
    notes: "Crvenka 10",
  },
  {
    code: "P-05",
    name: "Vrbas-107-vetrenjače",
    areaHa: 107.0,
    location: "kat. br. 39-49, 36-38, 35",
    notes: "Vrbas 107 ha kod vetrenjača",
  },
  {
    code: "P-06",
    name: "Vrbas-9 kod pruge",
    areaHa: 8.91,
    location: "kat. br. 55/1",
    notes: "Vrbas kod pruge",
  },
  {
    code: "P-07",
    name: "Vrbas-61.5 novi zalivni",
    areaHa: 62.0,
    location: "kat. br. 124, 125, 118-123",
    notes: "Novi zalivni sistem",
  },
  {
    code: "P-08",
    name: "Savino Selo male parcele",
    areaHa: 32.0,
    location: "Savino Selo",
    notes: "Male parcele Savino Selo",
  },
  {
    code: "P-09",
    name: "Ravno Selo-64",
    areaHa: 61.67,
    location: "kat. br. 3162, 4132, 3163",
    notes: "Ravno Selo",
  },
  {
    code: "P-10",
    name: "Zmajevo",
    areaHa: 37.84,
    location: "kat. br. 3878",
    notes: "Zmajevo parcela",
  },
  {
    code: "P-11",
    name: "Savino Selo - Mihajlović 25",
    areaHa: 25.0,
    location: "Savino Selo",
    notes: "Mihajlović 25 ha",
  },
  {
    code: "P-12",
    name: "Savino Selo - Mihajlović 35",
    areaHa: 35.0,
    location: "Savino Selo",
    notes: "Mihajlović 35 ha",
  },
  {
    code: "P-13",
    name: "Klas",
    areaHa: 2.0,
    location: "kat. br. 966/1",
    notes: "Klas",
  },
  {
    code: "P-14",
    name: "Šećerana 1.67",
    areaHa: 1.67,
    location: "kat. br. 987/22",
    notes: "Šećerana mala parcela",
  },
  {
    code: "P-15",
    name: "Kosančić - Stefan",
    areaHa: 7.5,
    location: "Kosančić",
    notes: "Stefan Kosančić",
  },
  {
    code: "P-16",
    name: "Srpska pravoslavna crkva (deo 1)",
    areaHa: 9.03,
    location: "kat. br. 1369, 1335",
    notes: "SPC zakup parcela 1",
  },
  {
    code: "P-17",
    name: "Srpska pravoslavna crkva (deo 2)",
    areaHa: 62.3,
    location: "SPC zakup",
    notes: "SPC zakup parcela 2",
  },
  {
    code: "P-18",
    name: "Jauković",
    areaHa: 70.0,
    location: "Jauković",
    notes: "Jauković parcela 70 ha",
  },
  {
    code: "P-19",
    name: "Savino Selo - Gale",
    areaHa: 41.9,
    location: "Savino Selo",
    notes: "Gale Savino Selo",
  },
];

const machines = [
  // 1. Traktori i samohodne poljoprivredne mašine
  {
    name: "John Deere (traktor)",
    type: "TRAKTOR",
    brandModel: "John Deere",
    status: "SLOBODNA",
    tankCapacityLiters: 325,
    notes: "Glavni John Deere traktor",
  },
  {
    name: "Claas Ares 657",
    type: "TRAKTOR",
    brandModel: "Claas Ares 657",
    status: "SLOBODNA",
    tankCapacityLiters: 250,
    notes: "Traktor Claas Ares 657",
  },
  {
    name: "Claas Ares 816",
    type: "TRAKTOR",
    brandModel: "Claas Ares 816",
    status: "SLOBODNA",
    tankCapacityLiters: 300,
    notes: "Traktor Claas Ares 816",
  },
  {
    name: "Claas Arion",
    type: "TRAKTOR",
    brandModel: "Claas Arion",
    status: "SLOBODNA",
    tankCapacityLiters: 280,
    notes: "Traktor Claas Arion",
  },
  {
    name: "Claas Arion Cebis",
    type: "TRAKTOR",
    brandModel: "Claas Arion Cebis",
    status: "SLOBODNA",
    tankCapacityLiters: 280,
    notes: "Traktor Claas Arion Cebis",
  },
  {
    name: "Claas Axion",
    type: "TRAKTOR",
    brandModel: "Claas Axion",
    status: "SLOBODNA",
    tankCapacityLiters: 400,
    notes: "Teški traktor Claas Axion",
  },
  {
    name: "Fendt",
    type: "TRAKTOR",
    brandModel: "Fendt traktor",
    status: "SLOBODNA",
    tankCapacityLiters: 350,
    notes: "Traktor Fendt",
  },
  {
    name: "Belarus / Rus",
    type: "TRAKTOR",
    brandModel: "Belarus MTZ (Rus)",
    status: "SLOBODNA",
    tankCapacityLiters: 130,
    notes: "Traktor Belarus / Rus",
  },
  {
    name: "Claas Lexion",
    type: "KOMBAJN",
    brandModel: "Claas Lexion kombajn",
    status: "SLOBODNA",
    tankCapacityLiters: 800,
    notes: "Kombajn Claas Lexion",
  },
  {
    name: "Claas Mega",
    type: "KOMBAJN",
    brandModel: "Claas Mega kombajn",
    status: "SLOBODNA",
    tankCapacityLiters: 500,
    notes: "Kombajn Claas Mega",
  },

  // 2. Viljuškar i radne mašine
  {
    name: "Viljuškar",
    type: "VILJUSKAR",
    brandModel: "Viljuškar radni",
    status: "SLOBODNA",
    tankCapacityLiters: 50,
    notes: "Viljuškar za utovar/istovar i rad u magacinu i hladnjači",
  },
  {
    name: "Bager",
    type: "OSTALO",
    brandModel: "Bager / Rovokopač",
    status: "SLOBODNA",
    tankCapacityLiters: 150,
    notes: "Bager rovokopač",
  },
  {
    name: "ULT utovarivač",
    type: "OSTALO",
    brandModel: "ULT utovarivač",
    status: "SLOBODNA",
    tankCapacityLiters: 180,
    notes: "ULT utovarivač za rasute terete",
  },

  // 3. Teretna i dostavna vozila
  {
    name: "GAZ",
    type: "KAMION",
    brandModel: "GAZ teretno vozilo",
    status: "SLOBODNA",
    tankCapacityLiters: 90,
  },
  {
    name: "Mercedes Sprinter",
    type: "KAMION",
    brandModel: "Mercedes-Benz Sprinter",
    status: "SLOBODNA",
    tankCapacityLiters: 75,
  },
  {
    name: "MAN kamion Stefan",
    type: "KAMION",
    brandModel: "MAN tegljač / kiper",
    status: "SLOBODNA",
    tankCapacityLiters: 400,
  },
  {
    name: "Kamion VS-051-CK",
    type: "KAMION",
    regNumber: "VS-051-CK",
    status: "SLOBODNA",
    tankCapacityLiters: 200,
  },
  {
    name: "Kamion VS-054-PB",
    type: "KAMION",
    regNumber: "VS-054-PB",
    status: "SLOBODNA",
    tankCapacityLiters: 200,
  },
  {
    name: "Kamion VS-053-CK",
    type: "KAMION",
    regNumber: "VS-053-CK",
    status: "SLOBODNA",
    tankCapacityLiters: 200,
  },

  // 4. Terenska i putnička vozila
  {
    name: "Dacia Duster KS",
    type: "OSTALO",
    brandModel: "Dacia Duster 4x4 KS",
    status: "SLOBODNA",
    tankCapacityLiters: 50,
  },
  {
    name: "Dacia Duster OL",
    type: "OSTALO",
    brandModel: "Dacia Duster 4x4 OL",
    status: "SLOBODNA",
    tankCapacityLiters: 50,
  },
  {
    name: "Toyota Hilux",
    type: "OSTALO",
    brandModel: "Toyota Hilux Pick-up",
    status: "SLOBODNA",
    tankCapacityLiters: 80,
  },
  {
    name: "VW Golf",
    type: "OSTALO",
    brandModel: "Volkswagen Golf",
    status: "SLOBODNA",
    tankCapacityLiters: 55,
  },
  {
    name: "Audi",
    type: "OSTALO",
    brandModel: "Audi putničko vozilo",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Ford",
    type: "OSTALO",
    brandModel: "Ford vozilo",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Vozilo VS-036-LI",
    type: "OSTALO",
    regNumber: "VS-036-LI",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Vozilo VS-023-UJ",
    type: "OSTALO",
    regNumber: "VS-023-UJ",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Vozilo Zlatko",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Vozilo Marko Visković",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Rukometni klub vozilo",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
  },
  {
    name: "Terensko vozilo",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 60,
    notes: "Terensko vozilo za obilazak parcela",
  },
  {
    name: "Putničko vozilo",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 55,
    notes: "Službeno putničko vozilo",
  },

  // 5. Priključci i oprema za navodnjavanje (bez sopstvenog rezervoara goriva)
  {
    name: "Agregati za luk",
    type: "PRIKLJUCAK",
    brandModel: "Agregati za navodnjavanje luka",
    status: "SLOBODNA",
    tankCapacityLiters: 0,
    notes: "Agregat i pumpe za luk",
  },
  {
    name: "Topovi za zalivanje",
    type: "PRIKLJUCAK",
    brandModel: "Tifoni i topovi za navodnjavanje",
    status: "SLOBODNA",
    tankCapacityLiters: 0,
    notes: "Topovi i tifoni za zalivanje",
  },
  {
    name: "Repa - zalivanje",
    type: "PRIKLJUCAK",
    brandModel: "Pumpa i oprema za zalivanje repe",
    status: "SLOBODNA",
    tankCapacityLiters: 0,
    notes: "Oprema za zalivanje šećerne repe",
  },

  // 6. Pomični agregati i stanice
  {
    name: "Feketić agregati",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 50,
    notes: "Agregati Feketić",
  },
  {
    name: "Pomični agregat",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 40,
    notes: "Pomični agregat struja/voda",
  },
  {
    name: "Šećerana agregat",
    type: "OSTALO",
    status: "SLOBODNA",
    tankCapacityLiters: 50,
    notes: "Postrojenje / agregat Šećerana",
  },
];


const workers = [
  {
    name: "Bojan Ćorović",
    type: "STALNI",
    role: "MAGACIN",
    phone: "+381 64 333 4455",
    hourlyRate: 600,
  },
  {
    name: "Marko Operater",
    type: "STALNI",
    phone: "+381 64 555 6677",
    hourlyRate: 550,
  },
  {
    name: "Nikola Savić",
    type: "STALNI",
    phone: "+381 65 333 9988",
    hourlyRate: 500,
  },
  {
    name: "Radovan Kovačević",
    type: "STALNI",
    phone: "+381 63 777 1122",
    hourlyRate: 520,
  },
  {
    name: "Grupa Sezonci 1 (Prebirači)",
    type: "SEZONAC",
    phone: "+381 62 888 4411",
    hourlyRate: 400,
  },
  {
    name: "Grupa Sezonci 2 (Berba/Vađenje)",
    type: "SEZONAC",
    phone: "+381 62 888 4422",
    hourlyRate: 450,
  },
  {
    name: "Zoran Milić",
    type: "STALNI",
    phone: "+381 61 234 5678",
    hourlyRate: 500,
  },
  {
    name: "Petar Jovanović",
    type: "SEZONAC",
    phone: "+381 60 987 6543",
    hourlyRate: 400,
  },
  {
    name: "Dejan Stanković",
    type: "SEZONAC",
    phone: "+381 64 345 6789",
    hourlyRate: 420,
  },
];

const workTypes = [
  { name: "Duboko oranje", category: "OBRADA", unit: "ha" },
  { name: "Predsetvena priprema (Tanjiranje / Setvospremač)", category: "OBRADA", unit: "ha" },
  { name: "Precizna setva luka", category: "SETVA", unit: "ha" },
  { name: "Prskanje zaštitom (Fungicidi / Herbicidi)", category: "ZASTITA", unit: "ha" },
  { name: "Međuredna kultivacija / Špartanje", category: "OBRADA", unit: "ha" },
  { name: "Mašinsko vađenje luka", category: "ZETVA_BERBA", unit: "ha" },
  { name: "Transport sa njive do hladnjače", category: "TRANSPORT", unit: "tura/km" },
  { name: "Zalivanje tifonom / kap po kap", category: "OSTALO", unit: "ha" },
];

const crops = [
  { name: "Luk žuti", variety: "Holandski žuti (Rijnsburger)", notes: "Standardna sorta za dugo čuvanje" },
  { name: "Luk crveni", variety: "Ptujski crveni", notes: "Ljubičasto-crvena ljuska, visoka cena" },
  { name: "Luk srebrenac", variety: "Beli srebrenac", notes: "Rana sorta za svežu potrošnju" },
  { name: "Pšenica", variety: "Apilco / Sofru", notes: "Ozima pšenica za plodored" },
  { name: "Kukuruz", variety: "Pioneer P9911 (FAO 410)", notes: "Kukuruz za zrno" },
];

const partners = [
  {
    name: "AgroHemija d.o.o. Sombor",
    type: "DOBAVLJAC",
    pib: "102345678",
    phone: "+381 25 411 222",
    email: "prodaja@agrohemija.rs",
    address: "Industrijska zona 14, Sombor",
    notes: "Glavni dobavljač đubriva YaraMila i semena luka",
  },
  {
    name: "Delta Agrar / Maxi Market",
    type: "KUPAC",
    pib: "100012345",
    phone: "+381 11 201 1100",
    email: "otkup@deltaagrar.rs",
    address: "Autoput za Novi Sad bb, Beograd",
    notes: "Kupac kalibrisanog luka u vrećama 5kg i 10kg",
  },
  {
    name: "AgroMehanika Servis Centar",
    type: "SERVIS",
    pib: "105678901",
    phone: "+381 21 888 999",
    email: "servis@agromehanika.rs",
    address: "Novosadski put 45, Bački Petrovac",
    notes: "Ovlašćeni servis za traktore i hidrauliku",
  },
  {
    name: "Veleprodaja Luk & Povrće Novi Sad",
    type: "KUPAC",
    pib: "107890123",
    phone: "+381 21 654 321",
    email: "veleprodaja@lukns.rs",
    address: "Kvantaska pijaca bb, Novi Sad",
    notes: "Otkup luka u rinfuzi (džambo vreće)",
  },
];

async function seed() {
  console.log("🌱 Pokretanje proširene seed skripte za NANDRA sistem...\n");

  // 1. KORISNICI
  console.log("1️⃣ Kreiranje sistemskih korisnika...");
  for (const user of users) {
    try {
      const result = await auth.api.signUpEmail({
        body: {
          name: user.name,
          email: user.email,
          password: user.password,
          phone: user.phone,
        },
      });
      // Trusted local provisioning: roles cannot be supplied to signUpEmail.
      await prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: result.user.id } });
        await tx.user.update({
          where: { id: result.user.id },
          data: { role: user.role },
        });
        await tx.worker.create({
          data: { name: user.name, type: "STALNI", phone: user.phone, isActive: true, userId: result.user.id },
        });
      });
      console.log(`  ✅ Korisnik: ${user.name} (${user.email}) [${user.role}]`);
    } catch (error) {
      if (error?.message?.includes("already") || error?.status === 422) {
        console.log(`  ⏭️  Postoji korisnik: ${user.email}`);
      } else {
        console.error(`  ❌ Greška:`, error?.message || error);
      }
    }
  }

  // 2. PARCELE
  console.log("\n2️⃣ Kreiranje šifarnika parcela...");
  for (const p of parcels) {
    await prisma.parcel.upsert({
      where: { code: p.code },
      update: p,
      create: p,
    });
    console.log(`  🌾 Parcela: [${p.code}] ${p.name} (${p.areaHa} ha)`);
  }

  // 3. MAŠINE
  console.log("\n3️⃣ Kreiranje šifarnika mašina...");
  for (const m of machines) {
    const existing = await prisma.machine.findFirst({ where: { name: m.name } });
    if (existing) {
      await prisma.machine.update({ where: { id: existing.id }, data: m });
    } else {
      await prisma.machine.create({ data: m });
    }
    console.log(`  🚜 Mašina: ${m.name} (${m.type}) - ${m.status}`);
  }

  // 4. RADNICI
  console.log("\n4️⃣ Kreiranje šifarnika radnika na njivi...");
  for (const w of workers) {
    const existing = await prisma.worker.findFirst({ where: { name: w.name } });
    if (existing) {
      await prisma.worker.update({ where: { id: existing.id }, data: w });
    } else {
      await prisma.worker.create({ data: w });
    }
    console.log(`  👥 Radnik: ${w.name} [${w.type}] - ${w.hourlyRate} RSD/h`);
  }

  // 5. RADNE OPERACIJE
  console.log("\n5️⃣ Kreiranje šifarnika radnih operacija...");
  for (const wt of workTypes) {
    await prisma.workType.upsert({
      where: { name: wt.name },
      update: wt,
      create: wt,
    });
    console.log(`  ⚙️ Operacija: ${wt.name} (${wt.category}) [${wt.unit}]`);
  }

  // 6. KULTURE
  console.log("\n6️⃣ Kreiranje šifarnika kultura i sorti...");
  for (const c of crops) {
    const existing = await prisma.crop.findFirst({ where: { name: c.name, variety: c.variety } });
    if (!existing) {
      await prisma.crop.create({ data: c });
    }
    console.log(`  🧅 Kultura: ${c.name} - ${c.variety}`);
  }

  // 7. PARTNERI
  console.log("\n7️⃣ Kreiranje šifarnika partnera...");
  for (const pt of partners) {
    const existing = await prisma.partner.findFirst({ where: { name: pt.name } });
    if (existing) {
      await prisma.partner.update({ where: { id: existing.id }, data: pt });
    } else {
      await prisma.partner.create({ data: pt });
    }
    console.log(`  🤝 Partner: ${pt.name} [${pt.type}]`);
  }

  // 8. FAZA 2: ZADUŽIVANJE MAŠINA & RADOVI NA NJIVI
  console.log("\n8️⃣ Kreiranje operativnih podataka za Fazu 2...");
  const adminUser = await prisma.user.findFirst({ where: { role: "DIREKTOR" } });
  const jdMachine = await prisma.machine.findFirst({ where: { name: { contains: "John Deere" } } });
  const pumaMachine =
    (await prisma.machine.findFirst({ where: { name: { contains: "Claas" } } })) || jdMachine;
  const imtMachine =
    (await prisma.machine.findFirst({ where: { name: { contains: "Fendt" } } })) || jdMachine;

  const markoWorker = await prisma.worker.findFirst({ where: { name: { contains: "Marko" } } });
  const radovanWorker = await prisma.worker.findFirst({ where: { name: { contains: "Radovan" } } });
  const nikolaWorker = await prisma.worker.findFirst({ where: { name: { contains: "Nikola" } } });

  const parcelP01 = await prisma.parcel.findUnique({ where: { code: "P-01" } });
  const parcelP02 = await prisma.parcel.findUnique({ where: { code: "P-02" } });
  const parcelP05 = await prisma.parcel.findUnique({ where: { code: "P-05" } });

  const workOranje = await prisma.workType.findFirst({ where: { name: { contains: "oranje" } } });
  const workPriprema = await prisma.workType.findFirst({ where: { name: { contains: "priprema" } } });
  const workPrskanje = await prisma.workType.findFirst({ where: { name: { contains: "Prskanje" } } });
  const workSetva = await prisma.workType.findFirst({ where: { name: { contains: "setva" } } });

  if (adminUser && jdMachine && markoWorker && parcelP01 && workOranje) {
    // 8.1. Zaduženja mašina
    const existingActiveAssignment = await prisma.machineAssignment.findFirst({
      where: { machineId: pumaMachine.id, status: "ZADUZENA" },
    });

    if (!existingActiveAssignment && pumaMachine && radovanWorker) {
      await prisma.machineAssignment.create({
        data: {
          machineId: pumaMachine.id,
          workerId: radovanWorker.id,
          parcelId: parcelP02?.id || null,
          startFuelLevel: 85,
          startHours: pumaMachine.currentHours,
          assignNotes: "Predsetvena priprema za luk",
          status: "ZADUZENA",
          createdById: adminUser.id,
          assignedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // pre 4 sata
        },
      });
      console.log(`  🚜 Aktivno zaduženje: ${pumaMachine.name} -> ${radovanWorker.name}`);
    }

    // 8.2. Radovi na njivi
    const existingWorks = await prisma.fieldWork.count();
    if (existingWorks === 0) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = new Date();

      await prisma.fieldWork.createMany({
        data: [
          {
            date: yesterday,
            shift: "PRVA",
            parcelId: parcelP01.id,
            machineId: jdMachine.id,
            workerId: markoWorker.id,
            workTypeId: workOranje.id,
            areaDoneHa: 14.5,
            startTime: "07:00",
            endTime: "16:00",
            workHours: 9.0,
            status: "ZAVRSENO",
            notes: "Odlična vlažnost zemljišta, oranje na 30cm",
            createdById: adminUser.id,
          },
          {
            date: yesterday,
            shift: "PRVA",
            parcelId: parcelP02.id,
            machineId: pumaMachine.id,
            workerId: radovanWorker.id,
            workTypeId: workPriprema.id,
            areaDoneHa: 10.0,
            startTime: "07:30",
            endTime: "15:30",
            workHours: 8.0,
            status: "ZAVRSENO",
            notes: "Priprema parcele za setvu",
            createdById: adminUser.id,
          },
          {
            date: today,
            shift: "PRVA",
            parcelId: parcelP01.id,
            machineId: jdMachine.id,
            workerId: markoWorker.id,
            workTypeId: workPrskanje.id,
            areaDoneHa: 16.0,
            startTime: "06:30",
            endTime: "11:30",
            workHours: 5.0,
            status: "ZAVRSENO",
            notes: "Tretman herbicidom pred nicanje",
            createdById: adminUser.id,
          },
          {
            date: today,
            shift: "PRVA",
            parcelId: parcelP05.id,
            machineId: imtMachine.id,
            workerId: nikolaWorker.id,
            workTypeId: workSetva.id,
            areaDoneHa: 6.5,
            startTime: "07:00",
            endTime: "14:30",
            workHours: 7.5,
            status: "ZAVRSENO",
            notes: "Setva semena luka srebrenca",
            createdById: adminUser.id,
          },
        ],
      });
      console.log(`  🌾 Kreirani početni operativni radovi na njivi (4 zapisa)`);
    }
  }

  // 9. FAZA 5: MODUL LUK & HLADNJAČA (6 komora x 720 boksova = 4.800t luka, Bojan Ćorović, Pakerica 4 žene, 10kg i 5kg džakovi)
  if (adminUser && parcelP01) {
    console.log("\n9️⃣ Ažuriranje podataka za Modul LUK prema stvarnom stanju hladnjače (6 komora / 4.800t)...");
    const magacinUser =
      (await prisma.user.findFirst({ where: { role: "MAGACIN" } })) || adminUser;

    // Postavi ime magacionera na Bojan Ćorović (zadužen za ulaz, izlaz i pakovanje luka)
    if (magacinUser && magacinUser.email === "magacin@nandra.rs" && magacinUser.name !== "Bojan Ćorović") {
      await prisma.user.update({
        where: { id: magacinUser.id },
        data: { name: "Bojan Ćorović" },
      });
    }

    const bojanWorker = await prisma.worker.findFirst({
      where: { name: { contains: "Bojan" } },
    });

    const buyerPartner =
      (await prisma.partner.findFirst({ where: { type: { in: ["KUPAC", "OBA"] } } })) ||
      (await prisma.partner.create({
        data: {
          name: "Delta Agrar / Maxi Market",
          type: "KUPAC",
          pib: "101699205",
          address: "Novi Beograd",
        },
      }));

    // Očisti prethodne demo podatke ako ih je bilo manje od 6 komora da bi se kreiralo tačnih 6 komora i 4.800t
    const currentStorageCount = await prisma.onionStorageEntry.count();
    if (currentStorageCount < 6) {
      await prisma.onionShipmentItem.deleteMany({});
      await prisma.onionShipment.deleteMany({});
      await prisma.onionPackaging.deleteMany({});
      await prisma.onionSorting.deleteMany({});
      await prisma.onionWaste.deleteMany({});
      await prisma.onionStorageEntry.deleteMany({});
      await prisma.onionHarvestArrival.deleteMany({});
      await prisma.onionLot.deleteMany({});

      const parcelP03 = (await prisma.parcel.findUnique({ where: { code: "P-03" } })) || parcelP01;
      const parcelP04 = (await prisma.parcel.findUnique({ where: { code: "P-04" } })) || parcelP01;
      const parcelP06 = (await prisma.parcel.findUnique({ where: { code: "P-06" } })) || parcelP01;

      // Kreiramo 6 komora po 720 boks paleta (dim 160x120x120 cm, 1100 kg u boks, 800 t po komori = 4.800 t ukupno u hladnjači)
      // + dodatnih 30 tona koje su prošle kroz sortiranje, pakericu (4 žene, 100 džakova po 10kg na paleti i 200 džakova po 5kg) i isporuku
      const chamberConfigs = [
        {
          lotNumber: "LOT-20261029-P01-01",
          chamberName: "Komora 1",
          hasEquipment: true,
          parcel: parcelP01,
          variety: "Žuti holandski (Rijnsburger)",
          boxCount: 720,
          currentStoKg: 800000, // 800 t trenutno u Komori 1
          extraSortedKg: 20000, // 20 t već sortirano i spakovano na pakerici
          temp: 1.5,
          hum: 72,
        },
        {
          lotNumber: "LOT-20261029-P02-01",
          chamberName: "Komora 2",
          hasEquipment: true,
          parcel: parcelP02 || parcelP01,
          variety: "Žuti holandski (Rijnsburger)",
          boxCount: 720,
          currentStoKg: 800000, // 800 t u Komori 2 (sa opremom)
          extraSortedKg: 0,
          temp: 1.5,
          hum: 72,
        },
        {
          lotNumber: "LOT-20261029-P03-01",
          chamberName: "Komora 3",
          hasEquipment: true,
          parcel: parcelP03,
          variety: "Žuti holandski (Rijnsburger)",
          boxCount: 720,
          currentStoKg: 800000, // 800 t u Komori 3 (sa opremom) -> Ukupno Komore 1-3 = 2.400 t
          extraSortedKg: 0,
          temp: 1.6,
          hum: 73,
        },
        {
          lotNumber: "LOT-20261029-P04-01",
          chamberName: "Komora 4",
          hasEquipment: false,
          parcel: parcelP04,
          variety: "Žuti holandski",
          boxCount: 720,
          currentStoKg: 800000, // 800 t u Komori 4 (bez opreme)
          extraSortedKg: 0,
          temp: 4.0,
          hum: 68,
        },
        {
          lotNumber: "LOT-20261029-P05-01",
          chamberName: "Komora 5",
          hasEquipment: false,
          parcel: parcelP05 || parcelP01,
          variety: "Crveni luk (Ptujski)",
          boxCount: 720,
          currentStoKg: 800000, // 800 t u Komori 5 (bez opreme)
          extraSortedKg: 0,
          temp: 4.2,
          hum: 68,
        },
        {
          lotNumber: "LOT-20261029-P06-01",
          chamberName: "Komora 6",
          hasEquipment: false,
          parcel: parcelP06,
          variety: "Žuti holandski",
          boxCount: 720,
          currentStoKg: 800000, // 800 t u Komori 6 (bez opreme) -> Ukupno Komore 4-6 = 2.400 t (Sve ukupno = 4.800 t!)
          extraSortedKg: 0,
          temp: 4.0,
          hum: 69,
        },
      ];

      for (const cfg of chamberConfigs) {
        const initialKg = cfg.currentStoKg + cfg.extraSortedKg;
        const isFirst = cfg.extraSortedKg > 0;

        const lot = await prisma.onionLot.create({
          data: {
            lotNumber: cfg.lotNumber,
            status: isFirst ? "U_OBRADI" : "NA_STANJU",
            parcelId: cfg.parcel.id,
            cropVariety: cfg.variety,
            initialQuantityKg: initialKg,
            rawStockKg: cfg.currentStoKg,
            sortedQualityKg: isFirst ? 18000 : 0,
            sortedSmallKg: isFirst ? 1200 : 0,
            sortedWasteKg: isFirst ? 800 : 0,
            packagedStockKg: isFirst ? 10000 : 0,
            shippedKg: isFirst ? 8000 : 0,
            totalWasteKg: isFirst ? 800 : 0,
            notes: `${cfg.chamberName} (${cfg.hasEquipment ? "Sa opremom" : "Bez opreme"}) — 720 boks paleta dim. 160x120x120 cm (1.100 kg u boks)`,
          },
        });

        await prisma.onionHarvestArrival.create({
          data: {
            lotId: lot.id,
            parcelId: cfg.parcel.id,
            quantityKg: initialKg,
            vehicleId: jdMachine?.id || null,
            driverId: bojanWorker?.id || markoWorker?.id || null,
            trailerInfo: `${cfg.boxCount} boks paleta (160x120x120 cm)`,
            supervisorId: magacinUser.id,
            notes: `Prijem u hladnjaču (${cfg.chamberName}) — Zadužen: Bojan Ćorović`,
          },
        });

        const stEntry = await prisma.onionStorageEntry.create({
          data: {
            lotId: lot.id,
            storageType: "HLADNJACA",
            locationOrChamber: cfg.chamberName,
            hasEquipment: cfg.hasEquipment,
            boxCount: cfg.boxCount,
            quantityKg: initialKg,
            currentQuantityKg: cfg.currentStoKg,
            temperatureC: cfg.temp,
            humidityPercent: cfg.hum,
            supervisorId: magacinUser.id,
            notes: `${cfg.boxCount} boksova dim. 160x120x120 cm (~1.100 kg/boks) | ${cfg.hasEquipment ? "Komora sa opremom" : "Komora bez opreme"}`,
          },
        });

        if (isFirst) {
          await prisma.onionSorting.create({
            data: {
              lotId: lot.id,
              storageEntryId: stEntry.id,
              inputQuantityKg: 20000,
              qualityQuantityKg: 18000,
              smallQuantityKg: 1200,
              wasteQuantityKg: 800,
              wastePercentage: 4.0,
              supervisorId: magacinUser.id,
              notes: "Kalibracija za pakericu — I klasa za džakove 10kg i 5kg",
            },
          });

          // Pakovanje 1: Džakovi 10 kg (100 džakova po paleti = 1.000 kg po paleti) -> 1.400 džakova = 14 paleta (14.000 kg)
          const pkg10kg = await prisma.onionPackaging.create({
            data: {
              lotId: lot.id,
              packageType: "DZAK_10KG",
              unitWeightKg: 10,
              packageCount: 1400,
              totalWeightKg: 14000,
              availableCount: 600, // 6 paleta po 100 džakova na stanju
              availableWeightKg: 6000,
              palletsCount: 14,
              palletNumber: "PAL-10KG-01..14 (100 džakova/paleti)",
              packerCount: 4,
              packerNotes: "Pakerica: 4 žene u smeni",
              responsiblePerson: "Bojan Ćorović",
              supervisorId: magacinUser.id,
              notes: "Na paleti spakovanog luka staje 100 džakova po 10kg (1.000 kg/paleta)",
            },
          });

          // Pakovanje 2: Džakovi 5 kg (200 džakova po paleti = 1.000 kg po paleti) -> 800 džakova = 4 palete (4.000 kg)
          await prisma.onionPackaging.create({
            data: {
              lotId: lot.id,
              packageType: "DZAK_5KG",
              unitWeightKg: 5,
              packageCount: 800,
              totalWeightKg: 4000,
              availableCount: 800, // 4 palete po 200 džakova na stanju
              availableWeightKg: 4000,
              palletsCount: 4,
              palletNumber: "PAL-5KG-01..04 (200 džakova/paleti)",
              packerCount: 4,
              packerNotes: "Pakerica: 4 žene u smeni (pakovanje po 5kg)",
              responsiblePerson: "Bojan Ćorović",
              supervisorId: magacinUser.id,
              notes: "Pakovanje u mrežaste džakove po 5kg (200 džakova na paleti = 1.000 kg)",
            },
          });

          // Otpremnica kupcu za 800 džakova od 10kg (8 paleta = 8.000 kg)
          await prisma.onionShipment.create({
            data: {
              dispatchNumber: "OTP-2026-0001",
              buyerId: buyerPartner.id,
              lotId: lot.id,
              totalWeightKg: 8000,
              totalPackagesCount: 800,
              pricePerKg: 48,
              totalValue: 384000,
              vehicleReg: "VS-051-CK",
              driverName: "Bojan Ćorović / Stefan",
              supervisorId: magacinUser.id,
              notes: "Isporučeno 8 paleta (800 džakova x 10kg) — Zadužen: Bojan Ćorović",
              items: {
                create: [
                  {
                    packagingId: pkg10kg.id,
                    packageCount: 800,
                    totalWeightKg: 8000,
                  },
                ],
              },
            },
          });
        }
      }

      console.log("  🧅 Kreirano svih 6 komora hladnjače (3 sa opremom + 3 bez opreme = 4.320 boksova / 4.800 tona luka) + Pakerica (4 žene, 10kg i 5kg)!");
    }
  }

  console.log("\n✨ SVI ŠIFARNICI I OPERATIVNI PODACI SU USPEŠNO POPUNJENI!");
  process.exit(0);
}

seed();

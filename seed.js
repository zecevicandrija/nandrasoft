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
      await auth.api.signUpEmail({
        body: {
          name: user.name,
          email: user.email,
          password: user.password,
          role: user.role,
          phone: user.phone,
        },
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
  const pumaMachine = await prisma.machine.findFirst({ where: { name: { contains: "Puma" } } });
  const imtMachine = await prisma.machine.findFirst({ where: { name: { contains: "IMT" } } });

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

  console.log("\n✨ SVI ŠIFARNICI I OPERATIVNI PODACI SU USPEŠNO POPUNJENI!");
  process.exit(0);
}

seed();

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
    name: "Potes Lug (Velika parcela)",
    areaHa: 24.5,
    location: "KO Bački Petrovac, br. 1420",
    currentCrop: "Luk žuti holandski",
    notes: "Ima sistem za navodnjavanje kap po kap",
  },
  {
    code: "P-02",
    name: "Velika Njiva 1",
    areaHa: 18.0,
    location: "KO Bački Petrovac, br. 1850",
    currentCrop: "Luk crveni ptujski",
    notes: "Odlična propusnost zemljišta",
  },
  {
    code: "P-03",
    name: "Doline - Potez Sever",
    areaHa: 12.3,
    location: "KO Gložan, br. 910",
    currentCrop: "Pšenica ozima",
    notes: "Predusev bio luk",
  },
  {
    code: "P-04",
    name: "Kamenjar",
    areaHa: 8.5,
    location: "KO Bački Petrovac, br. 312",
    currentCrop: "Kukuruz zuban",
    notes: "Blizina glavnog kanala DTD",
  },
  {
    code: "P-05",
    name: "Krajnji Lug",
    areaHa: 15.2,
    location: "KO Kulpin, br. 650",
    currentCrop: "Luk srebrenac",
    notes: "Peskovito zemljište pogodno za rano vađenje",
  },
];

const machines = [
  {
    name: "John Deere 6155M",
    type: "TRAKTOR",
    brandModel: "John Deere 6155M (155 KS)",
    regNumber: "NS-145-AG",
    year: 2021,
    currentHours: 2480,
    status: "SLOBODNA",
    notes: "Glavni traktor za oranje i tešku obradu",
  },
  {
    name: "Case IH Puma 150",
    type: "TRAKTOR",
    brandModel: "Case IH Puma 150 CVX",
    regNumber: "NS-289-TR",
    year: 2022,
    currentHours: 1950,
    status: "ZADUZENA",
    notes: "Koristi se za setvu i međurednu obradu",
  },
  {
    name: "IMT 539 De Luxe",
    type: "TRAKTOR",
    brandModel: "IMT 539 (39 KS)",
    regNumber: "NS-539-AA",
    year: 1998,
    currentHours: 6800,
    status: "SLOBODNA",
    notes: "Pomoćni traktor za transport vode, goriva i mrežica",
  },
  {
    name: "Grimme WR 200",
    type: "PRIKLJUCAK",
    brandModel: "Grimme Vadilica za luk 2-reda",
    regNumber: "INV-041",
    year: 2020,
    currentHours: 420,
    status: "SLOBODNA",
    notes: "Servisirana pred sezonu vađenja",
  },
  {
    name: "Amazone UF 1201",
    type: "PRIKLJUCAK",
    brandModel: "Nošena prskalica 1200L / 18m",
    regNumber: "INV-018",
    year: 2023,
    currentHours: 310,
    status: "SLOBODNA",
    notes: "GPS sekcijska kontrola grana",
  },
  {
    name: "Linde H25D",
    type: "VILJUSKAR",
    brandModel: "Linde H25D Dizel 2.5t",
    regNumber: "INV-002",
    year: 2019,
    currentHours: 3400,
    status: "SLOBODNA",
    notes: "Za magacin i hladnjaču luka",
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

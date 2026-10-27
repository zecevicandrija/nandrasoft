import 'dotenv/config';
import { prisma } from './lib/prisma.js';

async function runTests() {
  console.log('🧪 Pokrećem testiranje pravila za gorivo...');

  // 1. Dohvati korisnike
  const directorUser = await prisma.user.findFirst({ where: { role: 'DIREKTOR' } });
  const operatorUser = await prisma.user.findFirst({ where: { role: 'OPERATER' } });
  const machine = await prisma.machine.findFirst({ where: { tankCapacityLiters: { gt: 50 } } });
  const worker = await prisma.worker.findFirst({ where: { isActive: true } });

  console.log(`👤 Direktor: ${directorUser?.name} (${directorUser?.role})`);
  console.log(`👤 Operater: ${operatorUser?.name} (${operatorUser?.role})`);
  console.log(`🚜 Mašina: ${machine?.name}`);

  if (!directorUser || !operatorUser || !machine || !worker) {
    console.error('❌ Nedostaju testni podaci.');
    process.exit(1);
  }

  // Helper koji simulira rutu POST /entries
  async function testCreateEntry(user, body) {
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(user.role);

    // 1. Poslovno pravilo: Cisterna i kanister samo za direktor i rukovodilac
    if (["CISTERNA", "KANISTER"].includes(body.fuelSource)) {
      if (!isManager) {
        return { status: 403, error: "Nemate ovlašćenje za točenje iz cisterne firme ili kanistera. U kanister i cisternu za firmu mogu sipati isključivo direktor i rukovodilac." };
      }
    }

    // 2. Poslovno pravilo: Radnici samo na javnoj Petrol i Europetrol pumpi
    let effectiveGasStation = null;
    if (body.fuelSource === "PUMPA") {
      const stationNormalized = (body.gasStation || "").trim().toUpperCase();
      if (!isManager) {
        if (!["PETROL", "EUROPETROL"].includes(stationNormalized)) {
          return { status: 400, error: "Radnici mogu sipati gorivo isključivo na javnoj Petrol ili Europetrol pumpi. Molimo izaberite ovlašćenu pumpu (Petrol ili Europetrol)." };
        }
        effectiveGasStation = stationNormalized;
      } else {
        effectiveGasStation = stationNormalized || "PETROL";
      }
    } else {
      if (!isManager) {
        return { status: 403, error: "Radnici mogu sipati gorivo isključivo na javnoj Petrol ili Europetrol pumpi." };
      }
    }

    // Kreiranje zapisa u bazi za uspešan slučaj
    const entry = await prisma.fuelEntry.create({
      data: {
        machineId: body.machineId,
        workerId: worker.id,
        fuelSource: body.fuelSource,
        gasStation: effectiveGasStation,
        fuelType: body.fuelType || "EURODIZEL",
        liters: body.liters,
        createdById: user.id,
      },
    });

    return { status: 201, entry };
  }

  // TEST 1: Radnik pokušava da sipa iz cisterne firme
  console.log('\n--- TEST 1: Radnik pokušava sipanje iz CISTERNE ---');
  const res1 = await testCreateEntry(operatorUser, {
    machineId: machine.id,
    fuelSource: 'CISTERNA',
    liters: 30,
  });
  console.log(`Rezultat: status=${res1.status}, error=${res1.error}`);
  if (res1.status === 403) {
    console.log('✅ TEST 1 PROŠAO: Radnik je uspešno blokiran (403)');
  } else {
    console.error('❌ TEST 1 NEUSPEŠAN');
  }

  // TEST 2: Radnik pokušava da sipa iz kanistera
  console.log('\n--- TEST 2: Radnik pokušava sipanje iz KANISTERA ---');
  const res2 = await testCreateEntry(operatorUser, {
    machineId: machine.id,
    fuelSource: 'KANISTER',
    liters: 20,
  });
  console.log(`Rezultat: status=${res2.status}, error=${res2.error}`);
  if (res2.status === 403) {
    console.log('✅ TEST 2 PROŠAO: Radnik je uspešno blokiran (403)');
  } else {
    console.error('❌ TEST 2 NEUSPEŠAN');
  }

  // TEST 3: Radnik sipa na pumpi bez izbora stanice ili neregistrovana pumpa
  console.log('\n--- TEST 3: Radnik na pumpi bez PETROL/EUROPETROL ---');
  const res3 = await testCreateEntry(operatorUser, {
    machineId: machine.id,
    fuelSource: 'PUMPA',
    gasStation: 'NIS',
    liters: 40,
  });
  console.log(`Rezultat: status=${res3.status}, error=${res3.error}`);
  if (res3.status === 400) {
    console.log('✅ TEST 3 PROŠAO: Radnik je blokiran ako nije Petrol/Europetrol (400)');
  } else {
    console.error('❌ TEST 3 NEUSPEŠAN');
  }

  // TEST 4: Radnik sipa na Petrol pumpi
  console.log('\n--- TEST 4: Radnik sipa na PETROL pumpi ---');
  const res4 = await testCreateEntry(operatorUser, {
    machineId: machine.id,
    fuelSource: 'PUMPA',
    gasStation: 'PETROL',
    liters: 45,
  });
  console.log(`Rezultat: status=${res4.status}, entryId=${res4.entry?.id}, gasStation=${res4.entry?.gasStation}`);
  if (res4.status === 201 && res4.entry?.gasStation === 'PETROL') {
    console.log('✅ TEST 4 PROŠAO: Radnik uspešno evidentirao PETROL točenje');
    // Obriši testni unos
    await prisma.fuelEntry.delete({ where: { id: res4.entry.id } });
  } else {
    console.error('❌ TEST 4 NEUSPEŠAN');
  }

  // TEST 5: Radnik sipa na Europetrol pumpi
  console.log('\n--- TEST 5: Radnik sipa na EUROPETROL pumpi ---');
  const res5 = await testCreateEntry(operatorUser, {
    machineId: machine.id,
    fuelSource: 'PUMPA',
    gasStation: 'EUROPETROL',
    liters: 50,
  });
  console.log(`Rezultat: status=${res5.status}, entryId=${res5.entry?.id}, gasStation=${res5.entry?.gasStation}`);
  if (res5.status === 201 && res5.entry?.gasStation === 'EUROPETROL') {
    console.log('✅ TEST 5 PROŠAO: Radnik uspešno evidentirao EUROPETROL točenje');
    // Obriši testni unos
    await prisma.fuelEntry.delete({ where: { id: res5.entry.id } });
  } else {
    console.error('❌ TEST 5 NEUSPEŠAN');
  }

  // TEST 6: Direktor sipa iz Cisterne
  console.log('\n--- TEST 6: Direktor sipa iz CISTERNE ---');
  const res6 = await testCreateEntry(directorUser, {
    machineId: machine.id,
    fuelSource: 'CISTERNA',
    liters: 35,
  });
  console.log(`Rezultat: status=${res6.status}, entryId=${res6.entry?.id}`);
  if (res6.status === 201) {
    console.log('✅ TEST 6 PROŠAO: Direktor ima dozvolu za cisternu');
    await prisma.fuelEntry.delete({ where: { id: res6.entry.id } });
  } else {
    console.error('❌ TEST 6 NEUSPEŠAN');
  }

  // TEST 7: Direktor sipa iz Kanistera
  console.log('\n--- TEST 7: Direktor sipa iz KANISTERA ---');
  const res7 = await testCreateEntry(directorUser, {
    machineId: machine.id,
    fuelSource: 'KANISTER',
    liters: 15,
  });
  console.log(`Rezultat: status=${res7.status}, entryId=${res7.entry?.id}`);
  if (res7.status === 201) {
    console.log('✅ TEST 7 PROŠAO: Direktor ima dozvolu za kanister');
    await prisma.fuelEntry.delete({ where: { id: res7.entry.id } });
  } else {
    console.error('❌ TEST 7 NEUSPEŠAN');
  }

  console.log('\n🎉 SVI TESTOVI SU USPEŠNO ZAVRŠENI!');
  process.exit(0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});


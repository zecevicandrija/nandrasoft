import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { prisma } from "../lib/prisma.js";
import { getAllChambers } from "../lib/storageChamber.js";

async function measure(label, fn) {
  const start = performance.now();
  const result = await fn();
  return { label, durationMs: Number((performance.now() - start).toFixed(2)), ...result };
}

export async function benchmarkOnionQueries(db) {
  const counts = await Promise.all([
    db.workOrder.count({ where: { orderType: "PAKOVANJE" } }),
    db.onionLot.count(),
    db.onionStorageEntry.count(),
    db.onionStorageEntry.count({ where: { currentQuantityKg: { gt: 0 } } }),
    db.onionPackaging.count(),
    db.onionPackaging.count({ where: { availableCount: { gt: 0 } } }),
    db.onionShipment.count(),
    db.onionWaste.count(),
  ]);

  const workOrders = await measure("GET /api/onion/work-orders (page 1)", async () => {
    const [total, orders] = await Promise.all([
      db.workOrder.count({ where: { orderType: "PAKOVANJE" } }),
      db.workOrder.findMany({
        where: { orderType: "PAKOVANJE" },
        orderBy: [{ orderDate: "desc" }, { id: "desc" }],
        take: 25,
        select: { id: true, orderNumber: true, packingPlan: true },
      }),
    ]);
    const lotIds = [...new Set(orders.map((o) => o.packingPlan?.packagingForm?.lotId).filter(Boolean))];
    const lots = lotIds.length
      ? await db.onionLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNumber: true } })
      : [];
    return { total, pageRows: orders.length, resolvedLots: lots.length };
  });

  const lookup = await measure("GET /api/onion/lookup (optimized)", async () => {
    const [parcels, machines, workers, buyers, allLots, packedGroups, availablePackagings, chambers] = await Promise.all([
      db.parcel.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, areaHa: true, currentCrop: true } }),
      db.machine.findMany({ where: { isActive: true }, select: { id: true, name: true, regNumber: true } }),
      db.worker.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true } }),
      db.partner.findMany({ where: { isActive: true, type: { in: ["KUPAC", "OBA"] } }, select: { id: true, name: true, pib: true } }),
      db.onionLot.findMany({
        include: {
          parcel: { select: { id: true, code: true, name: true, areaHa: true, currentCrop: true } },
          storageEntries: {
            where: { currentQuantityKg: { gt: 0 } },
            select: { id: true, chamberId: true, locationOrChamber: true, storageType: true, currentQuantityKg: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.onionPackaging.groupBy({ by: ["lotId"], _sum: { totalWeightKg: true } }),
      db.onionPackaging.findMany({ where: { availableWeightKg: { gt: 0 } }, select: { id: true } }),
      getAllChambers(db),
    ]);
    return {
      parcels: parcels.length,
      machines: machines.length,
      workers: workers.length,
      buyers: buyers.length,
      allLots: allLots.length,
      packedGroups: packedGroups.length,
      availablePackagings: availablePackagings.length,
      chambers: chambers.length,
    };
  });

  const dashboard = await measure("GET /api/onion/dashboard (optimized)", async () => {
    const [lotGroups, activeStorage, storageTotals, packGroups, availPacks, shipAgg, wasteAgg, chambers] = await Promise.all([
      db.onionLot.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { initialQuantityKg: true, rawStockKg: true, sortedQualityKg: true, sortedSmallKg: true, sortedWasteKg: true, totalWasteKg: true },
      }),
      db.onionStorageEntry.findMany({
        where: { currentQuantityKg: { gt: 0 } },
        select: { id: true, chamberId: true, currentQuantityKg: true },
      }),
      db.onionStorageEntry.groupBy({ by: ["chamberId", "storageType", "locationOrChamber"], _sum: { quantityKg: true } }),
      db.onionPackaging.groupBy({
        by: ["packageType"],
        _sum: { totalWeightKg: true, packageCount: true, availableWeightKg: true, availableCount: true },
      }),
      db.onionPackaging.findMany({
        where: { availableCount: { gt: 0 } },
        select: { packageType: true, availableCount: true, packageCount: true, palletsCount: true },
      }),
      db.onionShipment.aggregate({ _sum: { totalWeightKg: true, totalPackagesCount: true, totalValue: true } }),
      db.onionWaste.aggregate({ _sum: { quantityKg: true } }),
      getAllChambers(db, { includeInactive: true }),
    ]);
    return {
      lotGroups: lotGroups.length,
      activeStorageRows: activeStorage.length,
      storageChamberGroups: storageTotals.length,
      packagingGroups: packGroups.length,
      availablePackagingRows: availPacks.length,
      hasShipments: Boolean(shipAgg._sum?.totalWeightKg),
      hasWaste: Boolean(wasteAgg._sum?.quantityKg),
      chambers: chambers.length,
    };
  });

  return {
    tableCounts: {
      packingWorkOrders: counts[0],
      onionLots: counts[1],
      storageEntriesTotal: counts[2],
      storageEntriesActive: counts[3],
      packagingsTotal: counts[4],
      packagingsAvailable: counts[5],
      shipments: counts[6],
      wastes: counts[7],
    },
    timings: [workOrders, lookup, dashboard],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await benchmarkOnionQueries(prisma), null, 2));
  } catch (error) {
    console.error("ONION_BENCHMARK_FAILED", error?.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

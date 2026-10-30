import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";

const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
const round = (value) => Number(value.toFixed(3));

// Read-only accounting comparison. A ledger difference is NOT proof of physical
// inventory or authorization to overwrite it: legacy opening balances may be missing.
export async function auditInventory(db) {
  const products = await db.fertilizerProduct.findMany({ include: { movements: { select: { movementType: true, quantity: true } } } });
  const lots = await db.onionLot.findMany({ include: {
      harvestArrivals: { select: { quantityKg: true } },
      sortings: { select: { inputQuantityKg: true, qualityQuantityKg: true, smallQuantityKg: true, wasteQuantityKg: true } },
      packagings: { select: { availableCount: true, packageCount: true, totalWeightKg: true, availableWeightKg: true,
        shipmentItems: { select: { packageCount: true, totalWeightKg: true } } } },
      shipments: { select: { totalWeightKg: true } },
      wastes: { select: { quantityKg: true } },
    } });
  const machines = await db.machine.findMany({ select: { id: true, name: true, currentFuelLiters: true, tankCapacityLiters: true, enpTagBalance: true,
      tollEntries: { where: { paymentMethod: "ENP_TAG" }, select: { amount: true } },
      tollTopUps: { select: { amount: true } },
    } });
  const supplies = await db.fuelSupply.aggregate({ _sum: { liters: true } });
  const dispensed = await db.fuelEntry.aggregate({ where: { fuelSource: "CISTERNA" }, _sum: { liters: true } });
  const fertilizer = products.map((p) => {
    const ledgerNet = p.movements.reduce((total, row) => total +
      (["PRIJEM_NABAVKA", "POVRAT_SA_NJIVE"].includes(row.movementType) ? row.quantity : -row.quantity), 0);
    const difference = round(p.currentStock - ledgerNet);
    return { id: p.id, name: p.name, unit: p.unit, stored: p.currentStock,
      ledgerNet: round(ledgerNet), unexplainedOpeningOrDifference: difference, needsReview: Math.abs(difference) > 0.001 };
  });
  const onion = lots.map((lot) => {
    const computed = {
      initialQuantityKg: sum(lot.harvestArrivals, "quantityKg"),
      rawStockKg: sum(lot.harvestArrivals, "quantityKg") - sum(lot.sortings, "inputQuantityKg") - sum(lot.wastes, "quantityKg"),
      sortedQualityKg: sum(lot.sortings, "qualityQuantityKg"),
      sortedSmallKg: sum(lot.sortings, "smallQuantityKg"),
      sortedWasteKg: sum(lot.sortings, "wasteQuantityKg"),
      packagedStockKg: sum(lot.packagings, "availableWeightKg"),
      shippedKg: sum(lot.shipments, "totalWeightKg"),
      totalWasteKg: sum(lot.sortings, "wasteQuantityKg") + sum(lot.wastes, "quantityKg"),
    };
    const differences = Object.entries(computed).flatMap(([field, ledger]) =>
      Math.abs(lot[field] - ledger) > 0.01 ? [{ field, stored: lot[field], ledger: round(ledger), difference: round(lot[field] - ledger) }] : []);
    const packageErrors = lot.packagings.filter((p) =>
      p.availableCount !== p.packageCount - sum(p.shipmentItems, "packageCount") ||
      Math.abs(p.availableWeightKg - (p.totalWeightKg - sum(p.shipmentItems, "totalWeightKg"))) > 0.01).length;
    return { id: lot.id, lotNumber: lot.lotNumber, differences, packageErrors, needsReview: differences.length > 0 || packageErrors > 0 };
  });
  const enp = machines.map((m) => {
    const ledgerNet = sum(m.tollTopUps, "amount") - sum(m.tollEntries, "amount");
    const difference = round((m.enpTagBalance || 0) - ledgerNet);
    return { id: m.id, name: m.name, stored: m.enpTagBalance || 0, ledgerNet: round(ledgerNet),
      unexplainedOpeningOrDifference: difference, needsReview: Math.abs(difference) > 0.01 };
  });
  const cisternLiters = round((supplies._sum.liters || 0) - (dispensed._sum.liters || 0));
  const fuel = { receivedLiters: supplies._sum.liters || 0, dispensedLiters: dispensed._sum.liters || 0,
    ledgerCisternLiters: cisternLiters, needsReview: cisternLiters < 0,
    invalidMachineLevels: machines.filter((m) => (m.currentFuelLiters || 0) < 0 ||
      (m.tankCapacityLiters && m.currentFuelLiters > m.tankCapacityLiters))
      .map((m) => ({ id: m.id, name: m.name, currentFuelLiters: m.currentFuelLiters, tankCapacityLiters: m.tankCapacityLiters })),
    limitation: "Machine fuel cannot be reconstructed from fueling alone; consumption and measured opening/closing levels must be verified.",
  };
  return { generatedAt: new Date().toISOString(), businessDataChanged: false,
    limitation: "Compare with physical inventory, ENP provider statements and documented opening balances before correcting any discrepancy.",
    summary: { fertilizerReviewed: fertilizer.length, fertilizerFlagged: fertilizer.filter((r) => r.needsReview).length,
      onionReviewed: onion.length, onionFlagged: onion.filter((r) => r.needsReview).length,
      enpReviewed: enp.length, enpFlagged: enp.filter((r) => r.needsReview).length },
    fertilizer, onion, enp, fuel };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 2) throw new Error("No mutation options supported");
    const report = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return auditInventory(tx);
    }, { isolationLevel: "RepeatableRead" });
    const directory = new URL("../reports/", import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL("inventory-review.json", directory), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ ...report.summary, fuel: report.fuel, report: "reports/inventory-review.json", businessDataChanged: false }));
  } catch (error) {
    console.error("Inventory audit failed:", error.code || error.name);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

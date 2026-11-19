import { writeAudit } from "./audit.js";
import { validateStorageCapacity } from "./storageChamber.js";

function conflict(message) {
  throw Object.assign(new Error(message), { status: 409 });
}

// Called inside the same onion inventory transaction as packing and shipment.
export async function reversePackingConfirmation(db, req, id, { action, reason, updatedAt }) {
  const order = await db.workOrder.findUnique({ where: { id } });
  if (order?.orderType !== "PAKOVANJE" || order.status !== "ZAVRSEN" || order.updatedAt.toISOString() !== updatedAt) {
    conflict("Nalog je promenjen ili više nije završen. Osvežite listu.");
  }
  const { execution, ...plan } = order.packingPlan ?? {};
  let entryId = execution?.entryId;
  if (!entryId) {
    const confirmation = await db.auditLog.findFirst({ where: { entityType: "WorkOrder", entityId: id,
      description: "Radni nalog završen potvrdom unosa u magacinu" }, orderBy: { createdAt: "desc" } });
    entryId = confirmation?.newValues?.entryId;
  }
  if (!entryId) conflict("Nije pronađen trag knjiženja za ovaj nalog.");
  const packaging = execution?.entryMode === "sorting" ? null : await db.onionPackaging.findUnique({
    where: { id: entryId }, include: { shipmentItems: { include: { shipment: { select: { dispatchNumber: true } } } } },
  });
  if (packaging && (packaging.shipmentItems.length || packaging.availableCount !== packaging.packageCount)) {
    const numbers = packaging.shipmentItems.map(item => item.shipment.dispatchNumber).join(", ");
    conflict(`Roba je već otpremljena. Proverite povezane otpremnice: ${numbers || "broj nedostupan"}.`);
  }
  const sortingId = packaging ? packaging.sortingId : entryId;
  const sorting = sortingId ? await db.onionSorting.findUnique({ where: { id: sortingId }, include: { packaging: true } }) : null;
  if ((!packaging && !sorting) || (sortingId && !sorting) || (sorting?.packaging && sorting.packaging.id !== packaging?.id)) {
    conflict("Povezano knjiženje nedostaje ili je sortiranje iskorišćeno u drugom pakovanju.");
  }
  const lotId = packaging?.lotId ?? sorting.lotId;
  const lot = await db.onionLot.findUnique({ where: { id: lotId }, include: { packagings: { select: { id: true, totalWeightKg: true } } } });
  const otherPacked = lot.packagings.reduce((sum, p) => sum + (p.id === packaging?.id ? 0 : p.totalWeightKg), 0);
  const quality = lot.sortedQualityKg - (sorting?.qualityQuantityKg ?? 0);
  const small = lot.sortedSmallKg - (sorting?.smallQuantityKg ?? 0);
  const waste = (sorting?.wasteQuantityKg ?? 0) + (sorting?.plevaKg ?? 0);
  const packed = lot.packagedStockKg - (packaging?.totalWeightKg ?? 0);
  if (Math.min(quality - otherPacked, small, lot.sortedWasteKg - waste, lot.totalWasteKg - waste, packed) < -0.000001) {
    conflict("Deo robe je dalje iskorišćen. Proverite stanje i kasnija knjiženja na istom LOT-u.");
  }
  if (sorting) {
    let deductions = execution?.storageDeductions;
    if (!deductions) {
      if (sorting.storageEntryId) deductions = [{ id: sorting.storageEntryId, kg: sorting.inputQuantityKg }];
      else {
        const sources = await db.onionStorageEntry.findMany({ where: { lotId, createdAt: { lte: sorting.createdAt } },
          select: { id: true, quantityKg: true, currentQuantityKg: true }, take: 2 });
        if (!sources.length) deductions = [];
        else {
          const [source] = sources;
          // A single historical location alone does not prove all raw stock was stored there.
          if (sources.length !== 1 || Math.abs(source.quantityKg - lot.initialQuantityKg) > 0.000001 ||
              Math.abs(source.currentQuantityKg - lot.rawStockKg) > 0.000001 ||
              await db.auditLog.findFirst({ where: { entityType: "OnionStorageEntry", entityId: source.id,
                action: { in: ["KOREKCIJA", "IZMENA"] }, createdAt: { gte: sorting.createdAt } }, select: { id: true } })) {
            conflict("Za ovo starije sortiranje nije sačuvana raspodela po komorama. Potrebna je provera skladišne evidencije.");
          }
          deductions = [{ id: source.id, kg: sorting.inputQuantityKg }];
        }
      }
    }
    for (const deduction of deductions) {
      const row = await db.onionStorageEntry.findUnique({ where: { id: deduction.id } });
      if (!row || row.lotId !== lotId) conflict("Nedostaje izvorna skladišna lokacija za povraćaj robe.");
      const currentQuantityKg = row.currentQuantityKg + deduction.kg;
      if (currentQuantityKg > row.quantityKg + 0.01) conflict("Povraćaj bi premašio evidentiranu količinu skladišne lokacije.");
      await validateStorageCapacity(db, { ...row, currentQuantityKg }, row, { restoringSortedStock: true });
      await db.onionStorageEntry.update({ where: { id: row.id }, data: { currentQuantityKg } });
    }
  }
  if (packaging) await db.onionPackaging.delete({ where: { id: packaging.id } });
  if (sorting) await db.onionSorting.delete({ where: { id: sorting.id } });
  const stillProcessed = quality + small + lot.sortedWasteKg - waste + lot.shippedKg > 0.000001;
  await db.onionLot.update({ where: { id: lotId }, data: {
    rawStockKg: lot.rawStockKg + (execution?.rawDeductedKg ?? sorting?.inputQuantityKg ?? 0), sortedQualityKg: Math.max(0, quality),
    sortedSmallKg: Math.max(0, small), sortedWasteKg: Math.max(0, lot.sortedWasteKg - waste),
    totalWasteKg: Math.max(0, lot.totalWasteKg - waste), packagedStockKg: Math.max(0, packed),
    status: lot.status === "ARHIVIRAN" ? lot.status : stillProcessed ? "U_OBRADI" : "NA_STANJU",
  } });
  const status = action === "cancel" ? "OTKAZAN" : "DODELJEN";
  const changed = await db.workOrder.updateMany({ where: { id, status: "ZAVRSEN", updatedAt: order.updatedAt },
    data: { status, packingPlan: { ...plan, ...(action === "cancel" && { cancelledAfterReversal: true }) } } });
  if (changed.count !== 1) conflict("Nalog je u međuvremenu promenjen.");
  if (action === "cancel") {
    await db.workOrderProposal.updateMany({ where: { workOrderId: id }, data: { workOrderId: null, version: { increment: 1 } } });
  }
  await writeAudit(db, req, { entityType: "WorkOrder", entityId: id, action: "STORNO",
    description: `Poništena potvrda naloga ${order.orderNumber}: ${reason}`, oldValues: { status: order.status, entryId },
    newValues: { status }, context: { reason, lotId, packagingId: packaging?.id, sortingId: sorting?.id,
      packageCount: packaging?.packageCount, totalWeightKg: packaging?.totalWeightKg, inputQuantityKg: sorting?.inputQuantityKg } });
}

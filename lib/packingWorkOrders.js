import { z } from "zod";
import { writeAudit } from "./audit.js";
import { notify } from "./directorNotifications.js";

const quantity = z.string().max(32).refine(v => Number.isFinite(Number(v)) && Number(v) >= 0, "Količina mora biti nenegativan broj.");
const count = quantity.refine(v => !v || (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 2147483647), "Broj mora biti ceo i pozitivan.");
export const sourceKeySchema = z.string().max(220).optional();

export function storageSourceKey(row) {
  return row.chamberId ? "id:" + row.chamberId : "name:" + row.locationOrChamber.trim().toLowerCase();
}

export function packingSource(lot, key) {
  const entries = lot.storageEntries.filter(row => row.currentQuantityKg > 0);
  if (key === "unstored") {
    return { name: "Neraspoređeno", entries: [], kg: Math.max(0, lot.rawStockKg - entries.reduce((sum, row) => sum + row.currentQuantityKg, 0)) };
  }
  const matching = entries.filter(row => storageSourceKey(row) === key);
  return { name: matching[0]?.locationOrChamber, entries: matching, kg: matching.reduce((sum, row) => sum + row.currentQuantityKg, 0) };
}
export const packingPlanSchema = z.object({
  entryMode: z.enum(["both", "sorting", "packaging"]),
  sortingForm: z.object({
    inputQuantityKg: quantity, qualityQuantityKg: quantity, smallQuantityKg: quantity,
    wasteQuantityKg: quantity, plevaKg: quantity,
  }),
  packagingForm: z.object({
    date: z.iso.date(), lotId: z.string().min(1, "Izaberite LOT."),
    sourceKey: sourceKeySchema, sourceName: z.string().max(220).optional(),
    packageType: z.enum(["DZAK_5KG", "DZAK_10KG", "DZAK_25KG", "DZAMBO_VRECA", "BOKS_PALETA", "RINFUZ", "DRUGO"]),
    unitWeightKg: quantity, palletsCount: count, packageCount: count, packerCount: count,
    palletNumber: z.string(), packerNotes: z.string(), responsiblePerson: z.string(), notes: z.string(),
  }),
}).superRefine(({ entryMode, sortingForm: s, packagingForm: p }, ctx) => {
  const issue = message => ctx.addIssue({ code: "custom", message });
  if (entryMode !== "packaging") {
    if (p.sourceKey === "") issue("Izaberite komoru ili neraspoređenu sirovinu.");
    if (Number(s.inputQuantityKg) <= 0 || !s.qualityQuantityKg.trim()) issue("Unesite ulaznu masu i količinu I klase.");
    const output = Number(s.qualityQuantityKg) + Number(s.smallQuantityKg) + Number(s.wasteQuantityKg) + Number(s.plevaKg);
    if (Math.abs(output - Number(s.inputQuantityKg)) > 0.5) issue("Zbir izlaznih frakcija mora odgovarati ulaznoj masi.");
  }
  if (entryMode !== "sorting" && (!Number(p.packageCount) || !Number(p.unitWeightKg) || !p.responsiblePerson.trim() || Number(p.packerCount) > 30)) {
    issue("Proverite broj i masu pakovanja, broj pakera i zaduženo lice.");
  }
});

export const warehouseRoles = ["DIREKTOR", "RUKOVODILAC", "MAGACIN"];

export function canReceivePackingOrder(worker) {
  return Boolean(worker?.isActive && worker.type !== "SEZONAC" && worker.user?.isActive && warehouseRoles.includes(worker.user.role));
}

export function requirePackingWorker(worker) {
  if (!canReceivePackingOrder(worker)) {
    throw Object.assign(new Error("Za pakovanje izaberite aktivnog magacionera, rukovodioca ili direktora."), { status: 400 });
  }
}

export async function validatePackingOrder(db, data) {
  if (!data.packingPlan) throw Object.assign(new Error("Podaci za pakovanje su obavezni."), { status: 400 });
  const form = data.packingPlan.packagingForm;
  const lot = await db.onionLot.findUnique({ where: { id: form.lotId }, select: { lotNumber: true,
    ...(form.sourceKey && { rawStockKg: true, storageEntries: true }) } });
  if (!lot) {
    throw Object.assign(new Error("Izabrani LOT ne postoji."), { status: 400 });
  }
  if (form.sourceKey) {
    const source = packingSource(lot, form.sourceKey);
    if (!source.kg) throw Object.assign(new Error("Izabrani LOT nema sirovine na izabranoj lokaciji."), { status: 400 });
    form.sourceName = source.name;
  }
  return lot;
}

// The onion inventory transaction rolls back both the entry and this status change on error.
export async function finishPackingOrder(db, req, entryId, lot, entryMode, { storageDeductions, rawDeductedKg, sourceKey, sourceName }) {
  const { workOrderId, orderUpdatedAt } = req.body;
  if (workOrderId == null) return;
  if (typeof workOrderId !== "string" || !z.iso.datetime().safeParse(orderUpdatedAt).success) {
    throw new Error("Osvežite radni nalog pre potvrde.");
  }
  const order = await db.workOrder.findUnique({
    where: { id: workOrderId }, select: { packingPlan: true, orderNumber: true },
  });
  const plan = order?.packingPlan;
  if (!plan?.packagingForm?.lotId) throw new Error("Plan pakovanja nije dostupan. Ponovo otvorite nalog.");
  const changedLot = plan.packagingForm.lotId !== lot.id;
  const plannedLot = changedLot
    ? await db.onionLot.findUnique({ where: { id: plan.packagingForm.lotId }, select: { lotNumber: true } })
    : lot;
  const execution = { entryId, lotId: lot.id, lotNumber: lot.lotNumber, entryMode, ...(storageDeductions && { storageDeductions, rawDeductedKg }),
    ...(sourceKey && { sourceKey, sourceName }), plannedLotNumber: plannedLot?.lotNumber ?? plan.packagingForm.lotId, actorName: req.user.name };
  const changed = await db.workOrder.updateMany({
    where: { id: workOrderId, orderType: "PAKOVANJE", status: { in: ["PLANIRAN", "DODELJEN"] }, updatedAt: new Date(orderUpdatedAt) },
    data: { status: "ZAVRSEN", packingPlan: { ...plan, execution } },
  });
  if (changed.count !== 1) throw new Error("Nalog je u međuvremenu promenjen. Ponovo ga otvorite u magacinu.");
  if (changedLot || plan.entryMode !== entryMode || (plan.packagingForm.sourceKey || "") !== (sourceKey || "")) {
    const modes = { both: "sortiranje i pakovanje", sorting: "samo sortiranje", packaging: "samo pakovanje" };
    const title = `Pakovanje · izmena na nalogu ${order.orderNumber}`;
    const body = `${title}\nPlanirano: ${execution.plannedLotNumber}, ${plan.packagingForm.sourceName || "bez zadate komore"}, ${modes[plan.entryMode]}.\nIzvršeno: ${lot.lotNumber}, ${sourceName || "bez zadate komore"}, ${modes[entryMode]}. Potvrdio/la: ${req.user.name}.`;
    const message = await db.directorMessage.create({ data: { authorId: req.user.id, authorName: req.user.name, body } });
    await notify(db, req.user, title, { messageId: message.id });
  }
  await writeAudit(db, req, { entityType: "WorkOrder", entityId: workOrderId, action: "IZMENA",
    description: "Radni nalog završen potvrdom unosa u magacinu", newValues: { status: "ZAVRSEN", entryId } });
}

function formatLotParcel(parcel) {
  if (!parcel?.name) return null;
  return parcel.code ? `${parcel.code} — ${parcel.name}` : parcel.name;
}

export async function enrichPackingWorkOrders(db, orders) {
  if (!Array.isArray(orders) || orders.length === 0) return orders;
  const packingOrders = orders.filter((order) => order?.orderType === "PAKOVANJE" && order?.packingPlan);
  if (packingOrders.length === 0) return orders;

  const lotIds = [
    ...new Set(
      packingOrders
        .flatMap((order) => [order.packingPlan?.packagingForm?.lotId, order.packingPlan?.execution?.lotId])
        .filter(Boolean)
    ),
  ];
  const packagingIds = [
    ...new Set(
      packingOrders
        .filter((order) => order.packingPlan?.execution?.entryId && order.packingPlan.execution.entryMode !== "sorting")
        .map((order) => order.packingPlan.execution.entryId)
    ),
  ];
  const sortingIds = [
    ...new Set(
      packingOrders
        .filter((order) => order.packingPlan?.execution?.entryId && order.packingPlan.execution.entryMode === "sorting")
        .map((order) => order.packingPlan.execution.entryId)
    ),
  ];

  const [lots, packagings, sortings] = await Promise.all([
    lotIds.length && typeof db.onionLot?.findMany === "function"
      ? db.onionLot.findMany({
          where: { id: { in: lotIds } },
          select: {
            id: true,
            lotNumber: true,
            cropVariety: true,
            parcel: { select: { name: true, code: true } },
          },
        })
      : [],
    packagingIds.length && typeof db.onionPackaging?.findMany === "function"
      ? db.onionPackaging.findMany({
          where: { id: { in: packagingIds } },
          select: {
            id: true,
            packageType: true,
            unitWeightKg: true,
            packageCount: true,
            totalWeightKg: true,
            palletsCount: true,
            palletNumber: true,
            packerCount: true,
            responsiblePerson: true,
            packerNotes: true,
            notes: true,
            sorting: {
              select: {
                inputQuantityKg: true,
                qualityQuantityKg: true,
                smallQuantityKg: true,
                wasteQuantityKg: true,
                plevaKg: true,
                wastePercentage: true,
              },
            },
          },
        })
      : [],
    sortingIds.length && typeof db.onionSorting?.findMany === "function"
      ? db.onionSorting.findMany({
          where: { id: { in: sortingIds } },
          select: {
            id: true,
            inputQuantityKg: true,
            qualityQuantityKg: true,
            smallQuantityKg: true,
            wasteQuantityKg: true,
            plevaKg: true,
            wastePercentage: true,
          },
        })
      : [],
  ]);

  const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
  const packagingsById = new Map(packagings.map((pkg) => [pkg.id, pkg]));
  const sortingsById = new Map(sortings.map((sort) => [sort.id, sort]));

  return orders.map((order) => {
    if (order?.orderType !== "PAKOVANJE" || !order?.packingPlan) return order;
    const plan = order.packingPlan;
    const execution = plan.execution;
    const plannedLot = lotsById.get(plan.packagingForm?.lotId);
    const executedLot = lotsById.get(execution?.lotId) || plannedLot;
    const plannedLotNumber = execution?.plannedLotNumber || plannedLot?.lotNumber || null;

    const pkgRecord = execution?.entryId && execution.entryMode !== "sorting"
      ? packagingsById.get(execution.entryId)
      : null;
    const sortRecord = execution?.entryId && execution.entryMode === "sorting"
      ? sortingsById.get(execution.entryId)
      : null;

    return {
      ...order,
      plannedLotNumber,
      packingSummary: {
        plannedLotNumber,
        plannedParcelName: formatLotParcel(plannedLot?.parcel),
        plannedCropVariety: plannedLot?.cropVariety || null,
        executedLotNumber: execution?.lotNumber || executedLot?.lotNumber || null,
        executedParcelName: formatLotParcel(executedLot?.parcel),
        executedCropVariety: executedLot?.cropVariety || null,
        actual: pkgRecord
          ? {
              packageType: pkgRecord.packageType,
              unitWeightKg: pkgRecord.unitWeightKg,
              packageCount: pkgRecord.packageCount,
              totalWeightKg: pkgRecord.totalWeightKg,
              palletsCount: pkgRecord.palletsCount,
              palletNumber: pkgRecord.palletNumber,
              packerCount: pkgRecord.packerCount,
              responsiblePerson: pkgRecord.responsiblePerson,
              packerNotes: pkgRecord.packerNotes,
              notes: pkgRecord.notes,
              sorting: pkgRecord.sorting ?? null,
            }
          : sortRecord
            ? { sorting: sortRecord }
            : null,
      },
    };
  });
}

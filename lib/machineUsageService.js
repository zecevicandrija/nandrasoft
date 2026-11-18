import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { hasOpenMaintenance, syncMachineStatus } from "./machineAvailability.js";
import { measuredFuelData } from "./machineFuel.js";
import { canAccessWorkerRecord } from "./workerIdentity.js";
import { assertCorrectionAccess, statusError } from "./workOrderStatusService.js";

export const usageInclude = { where: { voidedAt: null }, include: { machine: true }, orderBy: { assignedAt: "asc" } };
export const machineSnapshot = (m) => ({ currentHours: m.currentHours ?? 0, currentFuelLiters: m.currentFuelLiters ?? null });
const date = z.string().datetime({ offset: true });
const number = z.number().finite().nonnegative();
export const usageChangeSchema = z.object({
  contextType: z.enum(["order", "work", "assignment"]), contextId: z.string().min(1),
  version: z.string().min(1), mode: z.enum(["CORRECT", "REPLACE", "ADD"]),
  sourceId: z.string().optional(), machineId: z.string().min(1), reason: z.string().trim().min(3).max(500),
  expectedMachineUpdatedAt: date,
  startedAt: date, endedAt: date.optional(),
  startHours: number, endHours: number.optional(), startFuelLiters: number, endFuelLiters: number.optional(),
  areaDoneHa: number.optional(), previousAreaDoneHa: number.optional(),
  previousEndHours: number.optional(), previousEndFuelLiters: number.optional(),
  previousStartedAt: date.optional(), previousStartHours: number.optional(), previousStartFuelLiters: number.optional(),
  previousEndedAt: date.optional(),
  previousIsOperational: z.boolean().default(true), isOperational: z.boolean().default(true),
  sourceCurrentHours: number.optional(), sourceCurrentFuelLiters: number.optional(),
});

export async function usageContext(db, type, id, req) {
  let order = null, work = null, assignment = null;
  if (type === "order") order = await db.workOrder.findUnique({ where: { id } });
  else if (type === "work") work = await db.fieldWork.findUnique({ where: { id } });
  else if (type === "assignment") assignment = await db.machineAssignment.findUnique({ where: { id } });
  else throw statusError("Neispravan kontekst.", 400);
  const record = order || work || assignment;
  if (!record) throw statusError("Zapis nije pronađen.", 404);
  if (!canAccessWorkerRecord(req, record)) throw statusError("Nemate pristup ovom zapisu.", 403);
  if (assignment?.workOrderId) order = await db.workOrder.findUnique({ where: { id: assignment.workOrderId } });
  if (assignment?.fieldWorkId) work = await db.fieldWork.findUnique({ where: { id: assignment.fieldWorkId } });
  if (order?.fieldWorkId && !work) work = await db.fieldWork.findUnique({ where: { id: order.fieldWorkId } });
  if (work && !order) order = await db.workOrder.findFirst({ where: { fieldWorkId: work.id } });
  const where = work ? { fieldWorkId: work.id } : order ? { workOrderId: order.id }
    : assignment.usageGroupId ? { usageGroupId: assignment.usageGroupId } : { id: assignment.id };
  let assignments = await db.machineAssignment.findMany({ where, include: { machine: true }, orderBy: { assignedAt: "asc" } });
  // Older explicit order links are safe to present, but never guess a date/machine match.
  if (work && !assignments.length && order) assignments = await db.machineAssignment.findMany({
    where: { workOrderId: order.id }, include: { machine: true }, orderBy: { assignedAt: "asc" },
  });
  // Present uncertain legacy links for explicit selection. Never attach by a guessed day match.
  const unlinkedAssignments = work && !assignments.length ? await db.machineAssignment.findMany({ where: {
    machineId: work.machineId, workerId: work.workerId, fieldWorkId: null, voidedAt: null,
    workOrderId: order?.id || null,
    assignedAt: { lte: new Date(new Date(work.date).getTime() + 86400000) },
    OR: [{ returnedAt: null }, { returnedAt: { gte: new Date(new Date(work.date).getTime() - 86400000) } }],
  }, include: { machine: true }, orderBy: { assignedAt: "desc" }, take: 50 }) : [];
  const terminal = Boolean(work?.status === "ZAVRSENO" || work?.status === "STORNO" ||
    ["ZAVRSEN", "OTKAZAN"].includes(order?.status) || (!order && !work && assignments.every(a => a.status !== "ZADUZENA")));
  const version = createHash("sha256").update(JSON.stringify({ order, work, assignments, unlinkedAssignments })).digest("hex");
  const editDate = work?.date || assignments.find(a => !a.voidedAt)?.assignedAt || order?.orderDate;
  let canEdit = true;
  try { assertCorrectionAccess(req, record, editDate); } catch { canEdit = false; }
  return { record, order, work, assignments, unlinkedAssignments, terminal, version, canEdit, editDate };
}

function assertMeasurements(machine, start, end, startFuel, endFuel) {
  if (end != null && end < start) throw statusError("Krajnji sati ne mogu biti manji od početnih.", 400);
  const capacity = machine.tankCapacityLiters ?? 200;
  if ([startFuel, endFuel].some(v => v != null && v > capacity)) throw statusError(`Gorivo prelazi kapacitet rezervoara (${capacity} L).`, 400);
}

export async function assertUsageInterval(db, machineId, start, end, exceptId) {
  const overlap = await db.machineAssignment.findFirst({ where: {
    machineId, voidedAt: null, ...(exceptId && { id: { not: exceptId } }),
    ...(end && { assignedAt: { lt: end } }),
    OR: [{ returnedAt: null }, { returnedAt: { gt: start } }],
  } });
  if (overlap) throw statusError("Mašina ima drugo zaduženje u tom periodu. Rukovodilac treba prvo da razreši preklapanje evidencija.");
}

async function recordBreakdown(db, req, assignment) {
  if (assignment.isOperational !== false) return;
  await db.maintenanceIssue.create({ data: {
    machineId: assignment.machineId, parcelId: assignment.parcelId, reportedById: assignment.workerId,
    serviceType: "KVAR_NJIVA", priority: "VISOKA", status: "OTVOREN", isMachineStopped: true,
    title: "Kvar pri zameni/razduženju mašine", description: assignment.returnNotes || "Prijavljen kvar pri evidentiranju korišćenja.",
    createdById: req.user.id,
  } });
}

// Past corrections must never rewind a later assignment or fuel measurement.
async function applyLatestMeasurement(db, machine, at, hours, fuel, exceptId, historical = false) {
  const laterAssignment = await db.machineAssignment.findFirst({ where: {
    machineId: machine.id, voidedAt: null, ...(exceptId && { id: { not: exceptId } }),
    OR: [{ assignedAt: { gt: at } }, { returnedAt: { gt: at } }],
  } });
  const laterFuel = await db.fuelEntry.findFirst({ where: { machineId: machine.id, date: { gt: at } } });
  if (!laterAssignment && !laterFuel) await db.machine.update({ where: { id: machine.id }, data: {
    currentHours: Math.max(machine.currentHours || 0, hours),
    ...(!historical || new Date(machine.updatedAt) <= at ? measuredFuelData(machine, fuel) : {}),
  } });
}

export async function changeMachineUsage(db, req, input) {
  let c = await usageContext(db, input.contextType, input.contextId, req);
  // Fuel mutations use the same machine row locks, but a separate domain lock.
  // Acquire every affected row before validating the form's snapshot.
  for (const id of [...new Set([input.machineId, c.work?.machineId, ...c.assignments.map(a => a.machineId), ...c.unlinkedAssignments.map(a => a.machineId)].filter(Boolean))].sort()) {
    await db.machine.findUnique({ where: { id } });
  }
  c = await usageContext(db, input.contextType, input.contextId, req);
  assertCorrectionAccess(req, c.record, c.editDate);
  if (c.version !== input.version) throw statusError("Podaci su promenjeni. Osvežite pregled pre čuvanja.");
  if (c.order?.orderType === "REMONT_SERVIS") throw statusError("Servisni nalog uređuje se u radionici.");
  if (c.work?.status === "STORNO" || (c.order?.status === "OTKAZAN" && !c.work)) throw statusError("Storniran rad ili otkazan nalog bez realizacije ne može dobiti novo korišćenje.");
  if (c.order && !["U_TOKU", "ZAVRSEN", "OTKAZAN"].includes(c.order.status)) throw statusError("Pre prihvatanja promenite mašinu kroz Izmeni nalog.");
  const adopted = c.unlinkedAssignments.find(a => a.id === input.sourceId);
  let source = c.assignments.find(a => a.id === input.sourceId && !a.voidedAt) || (adopted && { ...adopted, areaDoneHa: c.work.areaDoneHa });
  const legacy = c.work && !source && !c.assignments.some(a => !a.voidedAt);
  if (input.mode !== "ADD" && !source && !(legacy && input.sourceId === "legacy")) throw statusError("Izaberite korišćenje koje menjate.", 400);
  if (legacy) {
    if (input.previousStartHours == null || input.previousStartFuelLiters == null || !input.previousStartedAt || !input.previousEndedAt) {
      throw statusError("Stari rad nema pouzdanu vezu sa zaduženjem. Unesite provereno početno stanje i vreme prethodne mašine.", 400);
    }
    const machine = await db.machine.findUnique({ where: { id: c.work.machineId } });
    source = { id: randomUUID(), machineId: machine.id, machine, workerId: c.work.workerId,
      parcelId: c.work.parcelId, fieldWorkId: c.work.id, workOrderId: c.order?.id || null,
      assignedAt: new Date(input.previousStartedAt), startHours: input.previousStartHours,
      startFuelLiters: input.previousStartFuelLiters, status: "RAZDUZENA", returnedAt: new Date(input.previousEndedAt),
      endHours: input.previousEndHours, endFuelLiters: input.previousEndFuelLiters, areaDoneHa: c.work.areaDoneHa };
  }
  if (source && (source.workerId !== c.record.workerId || (source.parcelId && c.record.parcelId && source.parcelId !== c.record.parcelId))) {
    throw statusError("Istorijsko zaduženje nije usklađeno sa radnikom i parcelom. Rukovodilac treba da razreši vezu pre izmene.");
  }
  if (source?.fieldWorkId && source.fieldWorkId !== c.work?.id) throw statusError("Zaduženje je već povezano sa drugim radom.");
  if (legacy && (source.returnedAt < source.assignedAt || source.returnedAt > new Date())) throw statusError("Period prethodne mašine nije ispravan.", 400);
  if (source && input.mode !== "ADD" && source.machineId === input.machineId) throw statusError("Izaberite drugu mašinu.", 400);
  if (source?.status === "VRACENA_SA_KVAROM" && input.mode === "CORRECT") {
    throw statusError("Za ovo zaduženje je prijavljen kvar. Prvo ispravite povezanu prijavu u radionici.");
  }
  const machine = await db.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) throw statusError("Mašina ne postoji.", 404);
  if (new Date(machine.updatedAt).getTime() !== Date.parse(input.expectedMachineUpdatedAt)) throw statusError("Stanje izabrane mašine je promenjeno. Osvežite podatke.");
  const start = new Date(input.startedAt), end = input.endedAt ? new Date(input.endedAt) : null;
  if (start > new Date() || (end && (end < start || end > new Date()))) throw statusError("Period korišćenja nije ispravan.", 400);
  if (c.terminal && (!end || input.endHours == null || input.endFuelLiters == null)) throw statusError("Za završen posao unesite i vreme i stanje pri razduženju.", 400);
  if (end && (input.endHours == null || input.endFuelLiters == null)) throw statusError("Nedostaje završno stanje mašine.", 400);
  if (!end && (machine.isActive === false || machine.status !== "SLOBODNA" || await hasOpenMaintenance(db, machine.id))) {
    throw statusError("Nova mašina nije dostupna za aktivno zaduženje.");
  }
  assertMeasurements(machine, input.startHours, input.endHours, input.startFuelLiters, input.endFuelLiters);
  await assertUsageInterval(db, machine.id, start, end);
  if (input.mode === "CORRECT" && source && !legacy &&
      (start.getTime() !== new Date(source.assignedAt).getTime() ||
       (source.returnedAt && end?.getTime() !== new Date(source.returnedAt).getTime()))) {
    throw statusError("Korekcija pogrešnog izbora zadržava originalni period korišćenja.");
  }
  if (source && input.mode === "REPLACE" && start < new Date(source.assignedAt)) throw statusError("Zamena mora biti posle početka prethodnog korišćenja.", 400);
  if (source && input.mode === "REPLACE" && source.returnedAt && start > new Date(source.returnedAt)) throw statusError("Zamena mora biti unutar prethodno evidentiranog perioda.", 400);
  const group = source?.usageGroupId || c.assignments[0]?.usageGroupId || randomUUID();
  const workId = c.work?.id || null;
  const others = c.assignments.filter(a => !a.voidedAt && a.id !== source?.id);
  if (c.work) {
    const oldArea = input.mode === "CORRECT" ? 0 : input.previousAreaDoneHa ?? source?.areaDoneHa ?? 0;
    const area = input.areaDoneHa ?? (input.mode === "CORRECT" ? source?.areaDoneHa : 0) ?? 0;
    const sum = others.reduce((n, a) => n + (a.areaDoneHa || 0), 0) + oldArea + area;
    if (Math.abs(sum - c.work.areaDoneHa) > 0.001) throw statusError(`Raspodela hektara mora dati ukupno ${c.work.areaDoneHa} ha. Unesite deo prethodne i nove mašine.`, 400);
  }
  if (adopted) await db.machineAssignment.update({ where: { id: adopted.id }, data: { fieldWorkId: workId, usageGroupId: group, areaDoneHa: source.areaDoneHa } });
  if (source && (input.mode !== "ADD" || legacy)) {
    const oldMachine = await db.machine.findUnique({ where: { id: source.machineId } });
    if (input.mode === "CORRECT") {
      // Fuel entries are real events, not copied or silently moved by a machine correction.
      const refuel = await db.fuelEntry.findFirst({ where: { machineId: source.machineId,
        date: { gte: new Date(source.assignedAt), ...(source.returnedAt && { lte: new Date(source.returnedAt) }) } } });
      if (refuel) throw statusError("U periodu pogrešnog zaduženja postoji točenje goriva. Prvo proverite/ispravite mašinu na tom točenju.");
      const later = await db.machineAssignment.findFirst({ where: { machineId: source.machineId, id: { not: source.id }, voidedAt: null,
        assignedAt: { gte: new Date(source.returnedAt || source.assignedAt) } } });
      const laterFuel = await db.fuelEntry.findFirst({ where: { machineId: source.machineId, date: { gt: new Date(source.returnedAt || source.assignedAt) } } });
      if (!later && !laterFuel) {
        const snapshot = source.machineStateBefore;
        const expectedHours = source.endHours ?? source.startHours;
        const expectedFuel = source.endFuelLiters ?? source.startFuelLiters;
        const manualReadingNeeded = snapshot && ((oldMachine.currentHours !== expectedHours && oldMachine.currentHours !== snapshot.currentHours) ||
          (oldMachine.currentFuelLiters !== expectedFuel && oldMachine.currentFuelLiters !== snapshot.currentFuelLiters));
        if (manualReadingNeeded && (input.sourceCurrentHours == null || input.sourceCurrentFuelLiters == null)) {
          throw statusError("Prethodna mašina ima novija ručno izmenjena očitavanja. Unesite provereno trenutno brojilo i gorivo, bez vraćanja starih vrednosti.");
        }
        if (!snapshot && (input.sourceCurrentHours == null || input.sourceCurrentFuelLiters == null)) {
          throw statusError("Za staro zaduženje nedostaje stanje pre greške. Unesite provereno trenutno brojilo i gorivo prethodne mašine.", 409);
        }
        const hours = input.sourceCurrentHours ?? snapshot.currentHours;
        const fuel = input.sourceCurrentFuelLiters ?? snapshot.currentFuelLiters;
        assertMeasurements(oldMachine, hours, hours, fuel, fuel);
        await db.machine.update({ where: { id: oldMachine.id }, data: { currentHours: hours, currentFuelLiters: fuel } });
      }
      const data = { status: "PONISTENA", voidedAt: new Date(), correctionReason: input.reason, usageGroupId: group, fieldWorkId: workId };
      if (legacy) {
        const { machine: ignored, ...row } = source;
        await db.machineAssignment.create({ data: { ...row, ...data, endHours: null, createdById: req.user.id } });
      } else await db.machineAssignment.update({ where: { id: source.id }, data });
    } else {
      if (input.previousEndHours == null || input.previousEndFuelLiters == null) throw statusError("Unesite završne sate i gorivo prethodne mašine.", 400);
      assertMeasurements(oldMachine, source.startHours, input.previousEndHours, source.startFuelLiters, input.previousEndFuelLiters);
      const data = { status: input.previousIsOperational ? "RAZDUZENA" : "VRACENA_SA_KVAROM",
        returnedAt: input.mode === "REPLACE" ? start : source.returnedAt,
        endHours: input.previousEndHours, endFuelLiters: input.previousEndFuelLiters,
        isOperational: input.previousIsOperational, returnNotes: input.reason,
        areaDoneHa: input.previousAreaDoneHa ?? source.areaDoneHa, usageGroupId: group, fieldWorkId: workId };
      if (legacy) {
        const { machine: ignored, ...row } = source;
        await db.machineAssignment.create({ data: { ...row, ...data, createdById: req.user.id } });
      } else await db.machineAssignment.update({ where: { id: source.id }, data });
      await applyLatestMeasurement(db, oldMachine, data.returnedAt, data.endHours, data.endFuelLiters, source.id, c.terminal);
      if (source.isOperational !== false) await recordBreakdown(db, req, { ...source, ...data });
    }
    await syncMachineStatus(db, source.machineId);
  } else if (source && input.mode === "ADD" && input.previousAreaDoneHa !== undefined) {
    await db.machineAssignment.update({ where: { id: source.id }, data: { areaDoneHa: input.previousAreaDoneHa } });
  }
  for (const segment of c.assignments) {
    if (segment.usageGroupId !== group) await db.machineAssignment.update({ where: { id: segment.id }, data: { usageGroupId: group } });
  }
  const assignment = await db.machineAssignment.create({ data: {
    machineId: machine.id, workerId: c.record.workerId, parcelId: c.work?.parcelId || c.order?.parcelId || c.record.parcelId || null,
    workOrderId: c.order?.id || null, fieldWorkId: workId, usageGroupId: group,
    assignedAt: start, returnedAt: end, startHours: input.startHours, endHours: end ? input.endHours : null,
    startFuelLiters: input.startFuelLiters, endFuelLiters: end ? input.endFuelLiters : null,
    status: end ? (input.isOperational ? "RAZDUZENA" : "VRACENA_SA_KVAROM") : "ZADUZENA",
    isOperational: input.isOperational, assignNotes: input.reason, returnNotes: end ? input.reason : null,
    areaDoneHa: input.areaDoneHa ?? (input.mode === "CORRECT" ? source?.areaDoneHa : null),
    replacesId: input.mode === "ADD" ? null : source?.id, machineStateBefore: machineSnapshot(machine), createdById: req.user.id,
  } });
  await applyLatestMeasurement(db, machine, end || start, end ? input.endHours : input.startHours,
    end ? input.endFuelLiters : input.startFuelLiters, assignment.id, Boolean(end));
  if (end) await recordBreakdown(db, req, assignment);
  await syncMachineStatus(db, machine.id);
  if (c.order && (input.mode !== "ADD" || !end)) await db.workOrder.update({ where: { id: c.order.id }, data: { machineId: machine.id } });
  if (c.work && input.mode === "CORRECT" && c.work.machineId === source.machineId) await db.fieldWork.update({ where: { id: c.work.id }, data: { machineId: machine.id } });
  // Link every old segment explicitly; no reporting joins by approximate date.
  if (workId && c.order) await db.machineAssignment.updateMany({ where: { workOrderId: c.order.id, fieldWorkId: null }, data: { fieldWorkId: workId } });
  await db.auditLog.create({ data: {
    entityType: "MachineAssignment", entityId: assignment.id, action: "IZMENA", userId: req.user.id,
    userName: req.user.name, userRole: req.user.role, description: `${input.mode}: ${input.reason}`,
    oldValues: source ? { assignmentId: source.id, machineId: source.machineId, status: source.status,
      startHours: source.startHours, endHours: source.endHours, startFuelLiters: source.startFuelLiters, endFuelLiters: source.endFuelLiters,
      areaDoneHa: source.areaDoneHa, assignedAt: source.assignedAt, returnedAt: source.returnedAt } : {},
    newValues: { assignmentId: assignment.id, machineId: machine.id, workerId: assignment.workerId, workOrderId: assignment.workOrderId, fieldWorkId: workId, mode: input.mode,
      startHours: assignment.startHours, endHours: assignment.endHours, startFuelLiters: assignment.startFuelLiters, endFuelLiters: assignment.endFuelLiters,
      areaDoneHa: assignment.areaDoneHa, assignedAt: assignment.assignedAt, returnedAt: assignment.returnedAt,
      previousEndHours: input.previousEndHours, previousEndFuelLiters: input.previousEndFuelLiters,
      sourceCurrentHours: input.sourceCurrentHours, sourceCurrentFuelLiters: input.sourceCurrentFuelLiters },
  } });
  return { message: "Korišćenje mašina je usklađeno.", assignment };
}

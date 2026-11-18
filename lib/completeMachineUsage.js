import { statusError, assertOrderTransition } from "./workOrderStatusService.js";
import { machineSnapshot } from "./machineUsageService.js";
import { measuredFuelData, fuelSnapshotError } from "./machineFuel.js";
import { syncMachineStatus } from "./machineAvailability.js";

// Called inside machineMutation: all machine returns and the work are one commit.
export async function completeMachineUsage(db, req, { work, order, machine, activeAssignment, input, workHours }) {
  if (order) assertOrderTransition(order, input.cancelRemainder ? "OTKAZAN" : "ZAVRSEN", input.cancelRemainder ? "cancel" : "complete");
  const where = order ? { workOrderId: order.id, voidedAt: null }
    : activeAssignment?.usageGroupId ? { usageGroupId: activeAssignment.usageGroupId, voidedAt: null }
    : activeAssignment ? { id: activeAssignment.id } : null;
  let segments = where ? await db.machineAssignment.findMany({ where, orderBy: { assignedAt: "asc" } }) : [];
  if (segments.some(a => a.fieldWorkId && a.fieldWorkId !== work.id)) throw statusError("Zaduženje je već povezano sa drugim radom.");
  if (order && !segments.length) throw statusError("Nalog prvo mora biti prihvaćen i mašina zadužena.");
  const completedAt = new Date();
  if (!segments.length && input.autoAssignMachine !== false) {
    const created = await db.machineAssignment.create({ data: {
      machineId: machine.id, workerId: work.workerId, parcelId: work.parcelId,
      assignedAt: new Date(completedAt.getTime() - Math.max(0, workHours || 0) * 3600000),
      startHours: machine.currentHours || 0, startFuelLiters: machine.currentFuelLiters ?? null,
      status: "ZADUZENA", machineStateBefore: machineSnapshot(machine), createdById: req.user.id,
      assignNotes: "Automatski evidentirano uz rad na njivi",
    } });
    segments = [created];
  }
  const areas = new Map((input.usageAreas || []).map(a => [a.assignmentId, a.areaDoneHa]));
  if (areas.size !== (input.usageAreas || []).length || [...areas.keys()].some(id => !segments.some(s => s.id === id))) {
    throw statusError("Raspodela hektara sadrži nepoznato ili ponovljeno zaduženje.", 400);
  }
  const areaFor = a => segments.length === 1 ? work.areaDoneHa : areas.get(a.id) ?? a.areaDoneHa;
  if (segments.length > 1 && (segments.some(a => areaFor(a) == null) ||
      Math.abs(segments.reduce((sum, a) => sum + (areaFor(a) || 0), 0) - work.areaDoneHa) > 0.001)) {
    throw statusError(`Raspodelite ukupno ${work.areaDoneHa} ha na korišćene mašine.`, 400);
  }
  for (const a of segments) {
    if (a.workerId !== work.workerId || (a.parcelId && a.parcelId !== work.parcelId)) throw statusError("Korišćenje ne pripada radniku i parceli ovog rada.");
    const data = { fieldWorkId: work.id, areaDoneHa: areaFor(a) };
    if (a.status === "ZADUZENA") {
      const primary = a.machineId === machine.id;
      const reading = primary ? input : input.machineReturns?.find(r => r.assignmentId === a.id);
      if (!reading) throw statusError("Unesite razduženje za svaku aktivnu mašinu na ovom poslu.", 400);
      const current = primary ? machine : await db.machine.findUnique({ where: { id: a.machineId } });
      if (reading.endFuelLiters != null) {
        const conflict = fuelSnapshotError(current, reading.expectedMachineUpdatedAt || req.body.expectedMachineUpdatedAt);
        if (conflict) throw statusError(conflict.error);
      }
      const endHours = reading.endHours ?? (current.currentHours || 0) + (segments.length === 1 ? workHours || 0 : 0);
      if (segments.length > 1 && reading.endHours == null) throw statusError("Za više mašina unesite završno brojilo svake mašine.", 400);
      if (endHours < a.startHours) throw statusError("Završno brojilo je manje od početnog.", 400);
      if (reading.endFuelLiters != null && reading.endFuelLiters > (current.tankCapacityLiters ?? 200)) throw statusError("Gorivo prelazi kapacitet rezervoara.", 400);
      const isOperational = reading.isOperational !== false;
      Object.assign(data, { returnedAt: completedAt, endHours, endFuelLiters: reading.endFuelLiters ?? null,
        isOperational, returnNotes: reading.returnNotes || null, photoUrl: input.photoUrl || null,
        status: isOperational ? "RAZDUZENA" : "VRACENA_SA_KVAROM" });
      await db.machine.update({ where: { id: a.machineId }, data: { currentHours: endHours,
        ...(reading.endFuelLiters != null ? measuredFuelData(current, reading.endFuelLiters) : {}) } });
      if (!isOperational) await db.maintenanceIssue.create({ data: {
        machineId: a.machineId, parcelId: work.parcelId, reportedById: work.workerId,
        serviceType: "KVAR_NJIVA", priority: "VISOKA", status: "OTVOREN", isMachineStopped: true,
        title: `Prijava kvara pri radu na njivi: ${current.name}`,
        description: reading.returnNotes || "Kvar pri završetku rada.", photoUrl: input.photoUrl || null, createdById: req.user.id,
      } });
    }
    await db.machineAssignment.update({ where: { id: a.id }, data });
    await syncMachineStatus(db, a.machineId);
  }
  if (order) await db.workOrder.update({ where: { id: order.id, status: order.status }, data: { status: input.cancelRemainder ? "OTKAZAN" : "ZAVRSEN", fieldWorkId: work.id } });
}

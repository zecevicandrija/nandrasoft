// Fuel balance is measured per closed assignment. Work-level values are allocations,
// not direct measurements. Never substitute dispensed liters for consumption.
const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" });
const day = (value) => dayFormat.format(new Date(value));
const time = (value) => new Date(value).getTime();
export function efficiency(totalLiters, coveredHa, norm) {
  const actualLPerHa = coveredHa > 0 ? totalLiters / coveredHa : null;
  const variancePercent = actualLPerHa !== null && norm > 0 ? (actualLPerHa / norm - 1) * 100 : null;
  const status = variancePercent === null ? "NEMA_PODATAKA" : variancePercent > 25 + 1e-9 ? "ANOMALIJA"
    : variancePercent > 10 + 1e-9 ? "UPOZORENJE" : "OPTIMALNO";
  return { actualLPerHa, variancePercent, status };
}

export function calculateFuelEfficiency({ works, assignments, entries, workTypes, dateFrom, dateTo }) {
  const inPeriod = (work) => (!dateFrom || time(work.date) >= time(dateFrom)) && (!dateTo || time(work.date) <= time(dateTo));
  const allocations = new Map();
  const groupBy = (rows, key) => {
    const groups = new Map();
    for (const row of rows) {
      const id = key(row);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(row);
    }
    return groups;
  };
  const machineAssignments = groupBy(assignments, a => a.machineId);
  const workerAssignments = groupBy(assignments, a => JSON.stringify([a.machineId, a.workerId]));
  const machineEntries = groupBy(entries, e => e.machineId);
  const assignmentDays = new Map(assignments.map(a => [a.id, [day(a.assignedAt), day(a.returnedAt)]]));
  const candidates = new Map();
  const relatedWorks = new Map();
  for (const work of works) {
    const workDay = day(work.date);
    const matches = (workerAssignments.get(JSON.stringify([work.machineId, work.workerId])) || []).filter(a =>
      (!a.parcelId || a.parcelId === work.parcelId) &&
      workDay >= assignmentDays.get(a.id)[0] && workDay <= assignmentDays.get(a.id)[1]);
    candidates.set(work.id, matches);
    for (const a of matches) {
      if (!relatedWorks.has(a.id)) relatedWorks.set(a.id, []);
      relatedWorks.get(a.id).push(work);
    }
  }
  let invalidAssignments = 0;
  for (const a of assignments) {
    if (a.startFuelLiters == null || a.endFuelLiters == null) continue;
    if (a.startFuelLiters < 0 || a.endFuelLiters < 0 || time(a.returnedAt) <= time(a.assignedAt) ||
      (machineAssignments.get(a.machineId) || []).some(other => other.id !== a.id && other.machineId === a.machineId &&
        time(other.assignedAt) < time(a.returnedAt) && time(other.returnedAt) > time(a.assignedAt))) {
      invalidAssignments++; continue;
    }
    // Shared boundary entries belong to the assignment starting at that instant.
    const refills = (machineEntries.get(a.machineId) || []).filter(e => time(e.date) >= time(a.assignedAt) && time(e.date) < time(a.returnedAt));
    const consumption = a.startFuelLiters + refills.reduce((sum, e) => sum + e.liters, 0) - a.endFuelLiters;
    if (consumption < 0) { invalidAssignments++; continue; }
    const related = relatedWorks.get(a.id) || [];
    // Ambiguous day-only records must not cause double allocation or false alarms.
    if (!related.length || related.some(w => candidates.get(w.id).length !== 1 || !(w.areaDoneHa > 0))) continue;
    const useHours = related.every(w => w.workHours > 0);
    const weight = w => useHours ? w.workHours : w.areaDoneHa;
    const totalWeight = related.reduce((sum, w) => sum + weight(w), 0);
    for (const w of related) allocations.set(w.id, { liters: consumption * weight(w) / totalWeight,
      assignmentId: a.id, allocationBasis: useHours ? "RADNI_SATI" : "HEKTARI" });
  }
  const groups = new Map(workTypes.map(w => [w.id, { workTypeId: w.id, workTypeName: w.name, category: w.category,
    normLPerHa: w.fuelNormLitersPerHa, totalHa: 0, coveredHa: 0, totalHours: 0, totalLiters: 0, worksCount: 0, coveredWorksCount: 0 }]));
  const details = [];
  for (const w of works.filter(inPeriod)) {
    if (!groups.has(w.workTypeId)) groups.set(w.workTypeId, { workTypeId: w.workTypeId, workTypeName: w.workType.name,
      category: w.workType.category, normLPerHa: w.workType.fuelNormLitersPerHa,
      totalHa: 0, coveredHa: 0, totalHours: 0, totalLiters: 0, worksCount: 0, coveredWorksCount: 0 });
    const group = groups.get(w.workTypeId);
    group.totalHa += w.areaDoneHa; group.totalHours += w.workHours || 0; group.worksCount++;
    const allocation = allocations.get(w.id);
    if (!allocation) continue;
    group.coveredHa += w.areaDoneHa; group.totalLiters += allocation.liters; group.coveredWorksCount++;
    details.push({ id: w.id, date: w.date, parcel: w.parcel.name, machine: w.machine.name, worker: w.worker.name,
      workType: w.workType.name, areaDoneHa: w.areaDoneHa, totalLiters: allocation.liters,
      normLPerHa: group.normLPerHa, ...allocation, ...efficiency(allocation.liters, w.areaDoneHa, group.normLPerHa) });
  }
  const operations = [...groups.values()].map(g => ({ ...g, ...efficiency(g.totalLiters, g.coveredHa, g.normLPerHa) }));
  const totalLiters = operations.reduce((sum, g) => sum + g.totalLiters, 0);
  const coveredHa = operations.reduce((sum, g) => sum + g.coveredHa, 0);
  const criticalWorks = details.filter(w => w.status === "ANOMALIJA");
  return { operations, criticalWorks, summary: { totalLiters, coveredHa,
    totalHa: operations.reduce((sum, g) => sum + g.totalHa, 0),
    actualLPerHa: coveredHa > 0 ? totalLiters / coveredHa : null,
    criticalWorksCount: criticalWorks.length, uncoveredWorksCount: works.filter(inPeriod).length - details.length, invalidAssignments } };
}

export { loadPagedFuelEfficiency as loadFuelEfficiency } from "./fuelEfficiencyQuery.js";

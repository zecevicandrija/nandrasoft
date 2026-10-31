export interface FuelOperation {
  workTypeId: string; workTypeName: string; category: string;
  totalHa: number; coveredHa: number; totalHours: number; totalLiters: number;
  actualLPerHa: number | null; normLPerHa: number | null;
  variancePercent: number | null; status: string;
}
export interface CriticalFuelWork {
  id: string; date: string; parcel: string; machine: string; worker: string; workType: string;
  areaDoneHa: number; totalLiters: number; actualLPerHa: number; normLPerHa: number;
  variancePercent: number; allocationBasis: string;
}
export interface FuelEfficiencyReport {
  operations: FuelOperation[]; criticalWorks: CriticalFuelWork[];
  operationsPagination: FuelPagination; criticalPagination: FuelPagination;
  summary: { totalLiters: number; totalHa: number; coveredHa: number; actualLPerHa: number | null;
    dispensedCostRSD: number; dispensedLiters: number; criticalWorksCount: number;
    uncoveredWorksCount: number; invalidAssignments: number };
}
export const fuelNumber = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('sr-RS', { maximumFractionDigits: 2 });
export const fuelStatus = (status: string) => ({ OPTIMALNO: 'Optimalno', UPOZORENJE: 'Povišeno', ANOMALIJA: 'Prekoračenje', NEMA_PODATAKA: 'Nema podataka' }[status] || status);
export const fuelOperationRows = (data: FuelEfficiencyReport) => data.operations.map(o => [o.workTypeName, o.category,
  fuelNumber(o.totalHa), fuelNumber(o.coveredHa), fuelNumber(o.totalLiters), fuelNumber(o.actualLPerHa),
  fuelNumber(o.normLPerHa), fuelNumber(o.variancePercent), fuelStatus(o.status)]);
export const fuelCriticalRows = (data: FuelEfficiencyReport) => data.criticalWorks.map(w => [
  new Date(w.date).toLocaleDateString('sr-RS'), w.parcel, w.workType, w.worker, w.machine,
  fuelNumber(w.areaDoneHa), fuelNumber(w.totalLiters), fuelNumber(w.actualLPerHa), fuelNumber(w.normLPerHa), fuelNumber(w.variancePercent),
]);
export const fuelHeaders = ['Operacija', 'Kategorija', 'Ukupno ha', 'Obuhvaćeno ha', 'Gorivo L', 'L/ha', 'Norma L/ha', 'Odstupanje %', 'Status'];
export const criticalFuelHeaders = ['Datum', 'Parcela', 'Operacija', 'Radnik', 'Mašina', 'ha', 'Gorivo L', 'L/ha', 'Norma', 'Odstupanje %'];


export interface FuelPagination { total: number; page: number; limit: number; totalPages: number }

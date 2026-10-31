import type { FuelEfficiencyReport } from './fuelEfficiencyReport';

export interface FuelFilters { dateFrom: string; dateTo: string; machineId: string; workerId: string; parcelId: string; search: string }
export function fuelFilterParams(filters: FuelFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
  return params.toString();
}
export async function fetchFuelEfficiency(filters: string, operationsPage = 1, criticalPage = 1, signal?: AbortSignal): Promise<FuelEfficiencyReport> {
  const params = new URLSearchParams(filters);
  params.set('operationsPage', String(operationsPage)); params.set('criticalPage', String(criticalPage)); params.set('limit', '10');
  const res = await fetch(`/api/analytics/fuel-efficiency?${params}`, { credentials: 'include', signal });
  if (!res.ok) throw new Error('Analitika goriva nije dostupna. Proverite filtere i pokušajte ponovo.');
  return res.json();
}

// Only an explicit export traverses every page; opening the tab loads one page.
export async function fetchFuelExport(filters: string): Promise<FuelEfficiencyReport> {
  const first = await fetchFuelEfficiency(filters);
  const result = { ...first, operations: [...first.operations], criticalWorks: [...first.criticalWorks] };
  const pages = Math.max(first.operationsPagination.totalPages, first.criticalPagination.totalPages);
  for (let page = 2; page <= pages; page++) {
    const next = await fetchFuelEfficiency(filters, Math.min(page, first.operationsPagination.totalPages), Math.min(page, first.criticalPagination.totalPages));
    if (page <= first.operationsPagination.totalPages) result.operations.push(...next.operations);
    if (page <= first.criticalPagination.totalPages) result.criticalWorks.push(...next.criticalWorks);
  }
  return result;
}

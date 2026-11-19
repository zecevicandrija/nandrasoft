import type * as XLSXTypes from 'xlsx';
import { fetchFuelExport } from './fuelEfficiencyQueries.ts';
import {
  criticalFuelHeaders,
  fuelCriticalRows,
  fuelHeaders,
  fuelOperationRows,
  type FuelEfficiencyReport,
} from './fuelEfficiencyReport.ts';

export type AnalyticsExportFormat = 'Excel' | 'PDF';

export interface ExportSectionFailure {
  section: string;
  reason: string;
}

export class AnalyticsExportError extends Error {
  readonly format: AnalyticsExportFormat;
  readonly failures: ExportSectionFailure[];

  constructor(format: AnalyticsExportFormat, failures: ExportSectionFailure[]) {
    const details = failures.map((failure) => `${failure.section} (${failure.reason})`).join('; ');
    const prefix =
      failures.length === 1
        ? `Izvoz u ${format} je zaustavljen jer deo podataka nije učitan:`
        : `Izvoz u ${format} je zaustavljen jer sledeći delovi podataka nisu učitani:`;
    super(`${prefix} ${details}.`);
    this.name = 'AnalyticsExportError';
    this.format = format;
    this.failures = failures;
  }
}

export interface AnalyticsOverviewExport {
  totalFieldWorks: number;
  totalHaDone: number;
  totalFuelLiters: number;
  totalFuelCost: number;
  totalMaintenanceCost: number;
  maintenancePartsCost: number;
  maintenanceLaborCost: number;
  totalTollCost: number;
  totalFertilizerCost: number;
  totalSeasonalHours: number;
  totalSeasonalWages: number;
  onionShippedKg: number;
  onionShipmentValue: number;
}

export interface AnalyticsMachineRepairExport {
  dateReported?: string | null;
  title?: string;
  serviceType?: string;
  priority?: string;
  status?: string;
  partsReplaced?: string | null;
  repairNotes?: string | null;
  lubricantType?: string | null;
  lubricantLiters?: number | null;
  totalCost?: number | null;
  downtimeHours?: number | null;
}

export interface AnalyticsMachineItemExport {
  machine: {
    name: string;
    type: string;
    brandModel?: string | null;
    currentHours?: number | null;
    status: string;
  };
  fieldWork: {
    totalHa?: number | null;
    totalWorkHours?: number | null;
  };
  fuel: {
    totalLiters?: number | null;
    totalCost?: number | null;
  };
  maintenance: {
    totalCost?: number | null;
    partsCost?: number | null;
    laborCost?: number | null;
    count?: number | null;
    downtimeHours?: number | null;
    recentRepairs?: AnalyticsMachineRepairExport[];
  };
  tolls: {
    totalCost?: number | null;
  };
  totalCostMachine?: number | null;
}

export interface AnalyticsMachinesExport {
  machines: AnalyticsMachineItemExport[];
}

export interface AnalyticsWorkerItemExport {
  worker: {
    name: string;
    role?: string | null;
    type?: string | null;
    phone?: string | null;
  };
  fieldWork: {
    totalHa?: number | null;
    totalWorkHours?: number | null;
    estimatedLabourCost?: number | null;
  };
  fuel: {
    totalLiters?: number | null;
  };
  maintenanceReported?: number | null;
  tolls: {
    totalCost?: number | null;
  };
}

export interface AnalyticsWorkersExport {
  workers: AnalyticsWorkerItemExport[];
}

export interface AnalyticsParcelItemExport {
  parcel: {
    name: string;
    code: string;
    areaHa: number;
  };
  fieldWork: {
    count?: number | null;
    totalHa?: number | null;
  };
  fertilizer: {
    totalQuantity?: number | null;
    totalCost?: number | null;
  };
  seasonal: {
    totalHours?: number | null;
    totalWages?: number | null;
  };
}

export interface AnalyticsParcelsExport {
  parcels: AnalyticsParcelItemExport[];
}

export interface AnalyticsFuelMonthExport {
  month: string;
  total_liters?: number | null;
  total_cost?: number | null;
}

export interface AnalyticsMaintenanceMonthExport {
  month: string;
  total_cost?: number | null;
}

export interface AnalyticsTollMonthExport {
  month: string;
  total_amount?: number | null;
}

export interface AnalyticsSeasonalMonthExport {
  month: string;
  total_wages?: number | null;
}

export interface AnalyticsFinancialExport {
  allFuelByMonth?: AnalyticsFuelMonthExport[];
  fuelByMonth?: AnalyticsFuelMonthExport[];
  maintenanceByMonth: AnalyticsMaintenanceMonthExport[];
  tollsByMonth: AnalyticsTollMonthExport[];
  seasonalByMonth: AnalyticsSeasonalMonthExport[];
}

export interface AnalyticsWorkItemExport {
  date?: string | null;
  shift?: string | null;
  worker?: { name?: string | null } | null;
  workType?: { name?: string | null } | null;
  parcel?: { code?: string | null; name?: string | null } | null;
  machine?: { name?: string | null } | null;
  attachment?: { name?: string | null } | null;
  areaDoneHa?: number | null;
  workHours?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

export interface AnalyticsWorksExport {
  works: AnalyticsWorkItemExport[];
}

export interface ExcelExportDataset {
  overview: AnalyticsOverviewExport;
  machines: AnalyticsMachinesExport;
  workers: AnalyticsWorkersExport;
  parcels: AnalyticsParcelsExport;
  financial: AnalyticsFinancialExport;
  works: AnalyticsWorksExport;
  fuelExport: FuelEfficiencyReport;
}

export interface PdfExportDataset {
  overview: AnalyticsOverviewExport;
  machines: AnalyticsMachinesExport;
  workers: AnalyticsWorkersExport;
  fuelExport: FuelEfficiencyReport;
}

export interface LoadAnalyticsExportOptions {
  apiBase: string;
  queryParams: string;
  searchTerm: string;
  fuelFilters: string;
  fetchFn?: typeof fetch;
  loadFuelExport?: (filters: string) => Promise<FuelEfficiencyReport>;
}

export interface ExportAnalyticsExcelOptions extends LoadAnalyticsExportOptions {
  dateFrom: string;
  dateTo: string;
  loadXlsx: () => Promise<typeof XLSXTypes>;
}

const OVERVIEW_NUMERIC_KEYS: (keyof AnalyticsOverviewExport)[] = [
  'totalFieldWorks',
  'totalHaDone',
  'totalFuelLiters',
  'totalFuelCost',
  'totalMaintenanceCost',
  'maintenancePartsCost',
  'maintenanceLaborCost',
  'totalTollCost',
  'totalFertilizerCost',
  'totalSeasonalHours',
  'totalSeasonalWages',
  'onionShippedKg',
  'onionShipmentValue',
];

const OPERATING_COST_KEYS: (keyof AnalyticsOverviewExport)[] = [
  'totalFuelCost',
  'totalMaintenanceCost',
  'totalTollCost',
  'totalFertilizerCost',
  'totalSeasonalWages',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isOverviewExportData(value: unknown): value is AnalyticsOverviewExport {
  if (!isPlainObject(value)) return false;
  return OVERVIEW_NUMERIC_KEYS.every((key) => isFiniteNumber(value[key]));
}

export function isMachinesExportData(value: unknown): value is AnalyticsMachinesExport {
  return isPlainObject(value) && Array.isArray(value.machines);
}

export function isWorkersExportData(value: unknown): value is AnalyticsWorkersExport {
  return isPlainObject(value) && Array.isArray(value.workers);
}

export function isParcelsExportData(value: unknown): value is AnalyticsParcelsExport {
  return isPlainObject(value) && Array.isArray(value.parcels);
}

export function isFinancialExportData(value: unknown): value is AnalyticsFinancialExport {
  if (!isPlainObject(value)) return false;
  const hasFuelMonths = Array.isArray(value.allFuelByMonth) || Array.isArray(value.fuelByMonth);
  return (
    hasFuelMonths &&
    Array.isArray(value.maintenanceByMonth) &&
    Array.isArray(value.tollsByMonth) &&
    Array.isArray(value.seasonalByMonth)
  );
}

export function isWorksExportData(value: unknown): value is AnalyticsWorksExport {
  return isPlainObject(value) && Array.isArray(value.works);
}

export function isFuelExportData(value: unknown): value is FuelEfficiencyReport {
  if (!isPlainObject(value)) return false;
  if (!Array.isArray(value.operations) || !Array.isArray(value.criticalWorks)) return false;
  if (!isPlainObject(value.summary)) return false;
  return (
    isFiniteNumber(value.summary.coveredHa) &&
    isFiniteNumber(value.summary.totalHa) &&
    isFiniteNumber(value.summary.uncoveredWorksCount) &&
    isFiniteNumber(value.summary.totalLiters) &&
    isFiniteNumber(value.summary.dispensedCostRSD)
  );
}

class SectionLoadError extends Error {
  readonly reason: string;

  constructor(section: string, reason: string) {
    super(`${section}: ${reason}`);
    this.name = 'SectionLoadError';
    this.reason = reason;
  }
}

function extractServerErrorMessage(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  return null;
}

export async function fetchAnalyticsExportSection<T>(
  url: string,
  section: string,
  isValid: (data: unknown) => data is T,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url, { credentials: 'include' });
  } catch (err) {
    const detail = err instanceof Error && err.message ? err.message : 'mrežna greška';
    throw new SectionLoadError(section, detail);
  }

  let payload: unknown;
  let parsedJson: boolean;
  try {
    payload = await response.json();
    parsedJson = true;
  } catch {
    parsedJson = false;
  }

  if (!response.ok) {
    const serverMessage = parsedJson ? extractServerErrorMessage(payload) : null;
    const reason = serverMessage ? `HTTP ${response.status}: ${serverMessage}` : `HTTP ${response.status}`;
    throw new SectionLoadError(section, reason);
  }

  if (!parsedJson) {
    throw new SectionLoadError(section, 'neispravan JSON odgovor');
  }

  if (!isValid(payload)) {
    throw new SectionLoadError(section, 'neočekivana struktura odgovora');
  }

  return payload;
}

async function loadValidatedFuelExport(
  fuelFilters: string,
  loadFuelExport: (filters: string) => Promise<FuelEfficiencyReport>
): Promise<FuelEfficiencyReport> {
  let payload: unknown;
  try {
    payload = await loadFuelExport(fuelFilters);
  } catch (err) {
    const reason = err instanceof Error && err.message ? err.message : 'greška pri učitavanju';
    throw new SectionLoadError('Efikasnost goriva', reason);
  }

  if (!isFuelExportData(payload)) {
    throw new SectionLoadError('Efikasnost goriva', 'neočekivana struktura odgovora');
  }

  return payload;
}

function buildExportParams(queryParams: string, searchTerm: string): string {
  const params = new URLSearchParams(queryParams);
  params.set('all', 'true');
  if (searchTerm.trim()) params.set('search', searchTerm.trim());
  return params.toString();
}

function extractFailureReason(reason: unknown): string {
  if (reason instanceof SectionLoadError) return reason.reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return 'nepoznata greška';
}

export function calculateExportOperatingCosts(overview: AnalyticsOverviewExport): number {
  return OPERATING_COST_KEYS.reduce((sum, key) => sum + (overview[key] || 0), 0);
}

export async function loadExcelExportData({
  apiBase,
  queryParams,
  searchTerm,
  fuelFilters,
  fetchFn = globalThis.fetch,
  loadFuelExport = fetchFuelExport,
}: LoadAnalyticsExportOptions): Promise<ExcelExportDataset> {
  const exportQuery = buildExportParams(queryParams, searchTerm);
  const overviewUrl = queryParams ? `${apiBase}/analytics/overview?${queryParams}` : `${apiBase}/analytics/overview`;

  const tasks = [
    {
      section: 'Pregled & KPI',
      promise: fetchAnalyticsExportSection(overviewUrl, 'Pregled & KPI', isOverviewExportData, fetchFn),
    },
    {
      section: 'Mašine',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/machines?${exportQuery}`, 'Mašine', isMachinesExportData, fetchFn),
    },
    {
      section: 'Radnici',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/workers?${exportQuery}`, 'Radnici', isWorkersExportData, fetchFn),
    },
    {
      section: 'Parcele',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/parcels?${exportQuery}`, 'Parcele', isParcelsExportData, fetchFn),
    },
    {
      section: 'Mesečni troškovi',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/financial?${exportQuery}`, 'Mesečni troškovi', isFinancialExportData, fetchFn),
    },
    {
      section: 'Dnevnik radova',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/works?${exportQuery}`, 'Dnevnik radova', isWorksExportData, fetchFn),
    },
    {
      section: 'Efikasnost goriva',
      promise: loadValidatedFuelExport(fuelFilters, loadFuelExport),
    },
  ] as const;

  const results = await Promise.allSettled(tasks.map((task) => task.promise));
  const failures: ExportSectionFailure[] = [];

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push({
        section: tasks[index].section,
        reason: extractFailureReason(result.reason),
      });
    }
  });

  if (failures.length > 0) {
    throw new AnalyticsExportError('Excel', failures);
  }

  return {
    overview: (results[0] as PromiseFulfilledResult<AnalyticsOverviewExport>).value,
    machines: (results[1] as PromiseFulfilledResult<AnalyticsMachinesExport>).value,
    workers: (results[2] as PromiseFulfilledResult<AnalyticsWorkersExport>).value,
    parcels: (results[3] as PromiseFulfilledResult<AnalyticsParcelsExport>).value,
    financial: (results[4] as PromiseFulfilledResult<AnalyticsFinancialExport>).value,
    works: (results[5] as PromiseFulfilledResult<AnalyticsWorksExport>).value,
    fuelExport: (results[6] as PromiseFulfilledResult<FuelEfficiencyReport>).value,
  };
}

export async function loadPdfExportData({
  apiBase,
  queryParams,
  searchTerm,
  fuelFilters,
  fetchFn = globalThis.fetch,
  loadFuelExport = fetchFuelExport,
}: LoadAnalyticsExportOptions): Promise<PdfExportDataset> {
  const exportQuery = buildExportParams(queryParams, searchTerm);
  const overviewUrl = queryParams ? `${apiBase}/analytics/overview?${queryParams}` : `${apiBase}/analytics/overview`;

  const tasks = [
    {
      section: 'Pregled & KPI',
      promise: fetchAnalyticsExportSection(overviewUrl, 'Pregled & KPI', isOverviewExportData, fetchFn),
    },
    {
      section: 'Mašine',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/machines?${exportQuery}`, 'Mašine', isMachinesExportData, fetchFn),
    },
    {
      section: 'Radnici',
      promise: fetchAnalyticsExportSection(`${apiBase}/analytics/workers?${exportQuery}`, 'Radnici', isWorkersExportData, fetchFn),
    },
    {
      section: 'Efikasnost goriva',
      promise: loadValidatedFuelExport(fuelFilters, loadFuelExport),
    },
  ] as const;

  const results = await Promise.allSettled(tasks.map((task) => task.promise));
  const failures: ExportSectionFailure[] = [];

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push({
        section: tasks[index].section,
        reason: extractFailureReason(result.reason),
      });
    }
  });

  if (failures.length > 0) {
    throw new AnalyticsExportError('PDF', failures);
  }

  return {
    overview: (results[0] as PromiseFulfilledResult<AnalyticsOverviewExport>).value,
    machines: (results[1] as PromiseFulfilledResult<AnalyticsMachinesExport>).value,
    workers: (results[2] as PromiseFulfilledResult<AnalyticsWorkersExport>).value,
    fuelExport: (results[3] as PromiseFulfilledResult<FuelEfficiencyReport>).value,
  };
}

export function buildAnalyticsExcelWorkbook(
  XLSX: typeof XLSXTypes,
  data: ExcelExportDataset,
  { dateFrom, dateTo }: { dateFrom: string; dateTo: string }
): XLSXTypes.WorkBook {
  const wb = XLSX.utils.book_new();
  const exportOverview = data.overview;
  const exportOperatingCosts = calculateExportOperatingCosts(exportOverview);

  // Sheet 1: Pregled
  const overviewRows = [
    { Metrika: 'Period izveštaja', Vrednost: `${dateFrom || 'Sve'} do ${dateTo || 'Sve'}` },
    { Metrika: 'Ukupno urađeno hektara', Vrednost: exportOverview.totalHaDone || 0 },
    { Metrika: 'Ukupno završenih radova na njivi', Vrednost: exportOverview.totalFieldWorks || 0 },
    { Metrika: 'Ukupno utrošeno goriva (litara)', Vrednost: exportOverview.totalFuelLiters || 0 },
    { Metrika: 'Ukupan trošak goriva (RSD)', Vrednost: exportOverview.totalFuelCost || 0 },
    { Metrika: 'Uloženo u popravke i servis (RSD)', Vrednost: exportOverview.totalMaintenanceCost || 0 },
    { Metrika: 'Trošak rezervnih delova (RSD)', Vrednost: exportOverview.maintenancePartsCost || 0 },
    { Metrika: 'Trošak eksternog rada servisa (RSD)', Vrednost: exportOverview.maintenanceLaborCost || 0 },
    { Metrika: 'Troškovi putarina i ENP (RSD)', Vrednost: exportOverview.totalTollCost || 0 },
    { Metrika: 'Troškovi nabavke đubriva (RSD)', Vrednost: exportOverview.totalFertilizerCost || 0 },
    { Metrika: 'Sati rada sezonskih radnika', Vrednost: exportOverview.totalSeasonalHours || 0 },
    { Metrika: 'Isplaćene dnevnice sezonaca (RSD)', Vrednost: exportOverview.totalSeasonalWages || 0 },
    { Metrika: 'Otpremljeno luka (kg)', Vrednost: exportOverview.onionShippedKg || 0 },
    { Metrika: 'Fakturisana vrednost luka (RSD)', Vrednost: exportOverview.onionShipmentValue || 0 },
    { Metrika: 'UKUPNI OPERATIVNI TROŠKOVI (RSD)', Vrednost: exportOperatingCosts },
  ];
  const wsOverview = XLSX.utils.json_to_sheet(overviewRows);
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Pregled & KPI');

  // Sheet 2: Mašine
  const machineRows = data.machines.machines.map((m) => ({
    'Naziv Mašine': m.machine.name,
    Tip: m.machine.type,
    'Model / Marka': m.machine.brandModel || '',
    'Trenutni Radni Sati': m.machine.currentHours || 0,
    Status: m.machine.status,
    'Urađeno ha (period)': m.fieldWork.totalHa || 0,
    'Radnih Sati na Njivi': m.fieldWork.totalWorkHours || 0,
    'Utrošeno Goriva (L)': m.fuel.totalLiters || 0,
    'Trošak Goriva (RSD)': m.fuel.totalCost || 0,
    'Popravke Ukupno (RSD)': m.maintenance.totalCost || 0,
    'Trošak Delova (RSD)': m.maintenance.partsCost || 0,
    'Trošak Rada Servisa (RSD)': m.maintenance.laborCost || 0,
    'Broj Kvarova': m.maintenance.count || 0,
    'Sati Zastoja (Downtime)': Math.round((m.maintenance.downtimeHours || 0) * 10) / 10,
    'Putarine (RSD)': m.tolls.totalCost || 0,
    'UKUPAN TROŠAK MAŠINE (RSD)': m.totalCostMachine || 0,
  }));
  const wsMachines = XLSX.utils.json_to_sheet(machineRows);
  XLSX.utils.book_append_sheet(wb, wsMachines, 'Mašine');

  // Sheet 3: Radnici
  const workerRows = data.workers.workers.map((w) => ({
    'Ime Radnika': w.worker.name,
    Uloga: w.worker.role || 'OPERATER',
    Tip: w.worker.type || 'STALNI',
    Telefon: w.worker.phone || '',
    'Urađeno ha (period)': w.fieldWork.totalHa || 0,
    'Radni Sati na Njivi': w.fieldWork.totalWorkHours || 0,
    'Efikasnost (ha/h)':
      w.fieldWork.totalWorkHours && w.fieldWork.totalHa
        ? +(w.fieldWork.totalHa / w.fieldWork.totalWorkHours).toFixed(2)
        : 0,
    'Sipano Gorivo Tokom Rada (L)': w.fuel.totalLiters || 0,
    'Broj Prijavljenih Kvarova': w.maintenanceReported || 0,
    'Putarine (RSD)': w.tolls.totalCost || 0,
    'Procenjen Trošak Rada (RSD)': w.fieldWork.estimatedLabourCost || 0,
  }));
  const wsWorkers = XLSX.utils.json_to_sheet(workerRows);
  XLSX.utils.book_append_sheet(wb, wsWorkers, 'Radnici');

  // Sheet 4: Istorija Popravki Mehanizacije
  const allRepairs: Record<string, string | number>[] = [];
  data.machines.machines.forEach((m) => {
    (m.maintenance.recentRepairs || []).forEach((r) => {
      allRepairs.push({
        Mašina: m.machine.name,
        Datum: r.dateReported ? r.dateReported.substring(0, 10) : '',
        'Naslov / Opis Kvara': r.title || '',
        'Tip Servisa': r.serviceType || '',
        Prioritet: r.priority || '',
        Status: r.status || '',
        'Zamenjeni Delovi': r.partsReplaced || '',
        'Izveštaj Mehaničara': r.repairNotes || '',
        'Utrošeno Mazivo': r.lubricantType ? `${r.lubricantType} (${r.lubricantLiters || 0} L)` : '',
        'Trošak Popravke (RSD)': r.totalCost || 0,
        'Sati Zastoja': Math.round((r.downtimeHours || 0) * 10) / 10,
      });
    });
  });
  if (allRepairs.length > 0) {
    const wsRepairs = XLSX.utils.json_to_sheet(allRepairs);
    XLSX.utils.book_append_sheet(wb, wsRepairs, 'Istorija Popravki');
  }

  // Sheet 5: Parcele
  const parcelRows = data.parcels.parcels.map((p) => ({
    'Naziv Parcele': p.parcel.name,
    Šifra: p.parcel.code,
    'Površina (ha)': p.parcel.areaHa,
    'Urađeno Operacija (broj)': p.fieldWork.count || 0,
    'Urađeno ha (ukupno operacija)': p.fieldWork.totalHa || 0,
    'Utrošak Đubriva (kg/L)': p.fertilizer.totalQuantity || 0,
    'Trošak Đubriva (RSD)': p.fertilizer.totalCost || 0,
    'Sati Sezonaca na Parceli': p.seasonal.totalHours || 0,
    'Isplaćene Dnevnice na Parceli (RSD)': p.seasonal.totalWages || 0,
  }));
  const wsParcels = XLSX.utils.json_to_sheet(parcelRows);
  XLSX.utils.book_append_sheet(wb, wsParcels, 'Parcele');

  // Sheet 6: Mesečni Troškovi
  const fuelMonths = data.financial.allFuelByMonth ?? data.financial.fuelByMonth ?? [];
  const monthlyRows = fuelMonths.map((f) => {
    const mnt = data.financial.maintenanceByMonth.find((m) => m.month === f.month);
    const toll = data.financial.tollsByMonth.find((t) => t.month === f.month);
    const seas = data.financial.seasonalByMonth.find((s) => s.month === f.month);
    const fuelCost = f.total_cost || 0;
    const maintCost = mnt ? mnt.total_cost || 0 : 0;
    const tollCost = toll ? toll.total_amount || 0 : 0;
    const seasCost = seas ? seas.total_wages || 0 : 0;
    return {
      Mesec: f.month,
      'Gorivo (L)': f.total_liters || 0,
      'Gorivo Trošak (RSD)': fuelCost,
      'Popravke Trošak (RSD)': maintCost,
      'Putarine (RSD)': tollCost,
      'Dnevnice Sezonaca (RSD)': seasCost,
      'UKUPNO TROŠAK (RSD)': fuelCost + maintCost + tollCost + seasCost,
    };
  });
  if (monthlyRows.length > 0) {
    const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows);
    XLSX.utils.book_append_sheet(wb, wsMonthly, 'Mesečni Troškovi');
  }

  // Sheet 7: Dnevnik Radova
  const workRows = data.works.works.map((w) => ({
    Datum: w.date ? new Date(w.date).toLocaleDateString('sr-RS') : '',
    Smena: w.shift || '',
    Radnik: w.worker?.name || '',
    Operacija: w.workType?.name || '',
    Parcela: w.parcel ? `[${w.parcel.code}] ${w.parcel.name}` : '',
    Mašina: w.machine?.name || '',
    Priključak: w.attachment?.name || '',
    'Urađeno (ha)': w.areaDoneHa || 0,
    'Radni sati (h)': w.workHours || 0,
    Vreme: w.startTime && w.endTime ? `${w.startTime} - ${w.endTime}` : '',
    Napomena: w.notes || '',
  }));
  if (workRows.length > 0) {
    const wsWorks = XLSX.utils.json_to_sheet(workRows);
    XLSX.utils.book_append_sheet(wb, wsWorks, 'Dnevnik Radova');
  }

  // Sheet 8 & 9: Gorivo
  const { fuelExport } = data;
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Bilans zaduzenja sa dopunama; raspodela po satima ili hektarima.'],
      ['Obuhvaceno ha', fuelExport.summary.coveredHa, 'Ukupno ha', fuelExport.summary.totalHa],
      ['Bez obracuna (radovi)', fuelExport.summary.uncoveredWorksCount],
      ['Potrosnja L', fuelExport.summary.totalLiters, 'Trosak tocenja RSD', fuelExport.summary.dispensedCostRSD],
      fuelHeaders,
      ...fuelOperationRows(fuelExport),
    ]),
    'Gorivo normativi'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([criticalFuelHeaders, ...fuelCriticalRows(fuelExport)]),
    'Gorivo odstupanja'
  );

  return wb;
}

export async function exportAnalyticsExcel({
  dateFrom,
  dateTo,
  loadXlsx,
  ...loadOptions
}: ExportAnalyticsExcelOptions): Promise<string> {
  const data = await loadExcelExportData(loadOptions);
  const XLSX = await loadXlsx();
  const wb = buildAnalyticsExcelWorkbook(XLSX, data, { dateFrom, dateTo });
  const fileName = `Nandra_Direktorska_Analitika_${dateFrom || 'sve'}_${dateTo || 'sve'}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

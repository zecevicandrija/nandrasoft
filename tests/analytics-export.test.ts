import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import {
  AnalyticsExportError,
  exportAnalyticsExcel,
  loadPdfExportData,
} from '../src/Analitika/analyticsExport.ts';
import type { FuelEfficiencyReport } from '../src/Analitika/fuelEfficiencyReport.ts';

function validOverview() {
  return {
    totalFieldWorks: 0,
    totalHaDone: 0,
    totalFuelLiters: 0,
    totalFuelCost: 0,
    totalMaintenanceCost: 0,
    maintenancePartsCost: 0,
    maintenanceLaborCost: 0,
    totalTollCost: 0,
    totalFertilizerCost: 0,
    totalSeasonalHours: 0,
    totalSeasonalWages: 0,
    onionShippedKg: 0,
    onionShipmentValue: 0,
  };
}

function validFuelReport(): FuelEfficiencyReport {
  return {
    operations: [],
    criticalWorks: [],
    operationsPagination: { total: 0, page: 1, limit: 10, totalPages: 1 },
    criticalPagination: { total: 0, page: 1, limit: 10, totalPages: 1 },
    summary: {
      totalLiters: 0,
      totalHa: 0,
      coveredHa: 0,
      actualLPerHa: null,
      dispensedCostRSD: 0,
      dispensedLiters: 0,
      criticalWorksCount: 0,
      uncoveredWorksCount: 0,
      invalidAssignments: 0,
    },
  };
}

function createMockFetch(overrides: Record<string, () => Response | Promise<Response>> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input), 'http://localhost').pathname;
    if (overrides[pathname]) {
      return overrides[pathname]();
    }
    switch (pathname) {
      case '/api/analytics/overview':
        return Response.json(validOverview());
      case '/api/analytics/machines':
        return Response.json({ machines: [], pagination: { total: 0, page: 1, limit: 0, totalPages: 1 } });
      case '/api/analytics/workers':
        return Response.json({ workers: [], pagination: { total: 0, page: 1, limit: 0, totalPages: 1 } });
      case '/api/analytics/parcels':
        return Response.json({ parcels: [], pagination: { total: 0, page: 1, limit: 0, totalPages: 1 } });
      case '/api/analytics/financial':
        return Response.json({
          fuelByMonth: [],
          allFuelByMonth: [],
          maintenanceByMonth: [],
          fuelSupplyByMonth: [],
          tollsByMonth: [],
          seasonalByMonth: [],
          pagination: { total: 0, page: 1, limit: 0, totalPages: 1 },
        });
      case '/api/analytics/works':
        return Response.json({ works: [], byWorkType: [], summary: { totalWorks: 0 }, pagination: { total: 0, page: 1, limit: 0, totalPages: 1 } });
      default:
        return Response.json({ error: `Unexpected path ${pathname}` }, { status: 404 });
    }
  }) as typeof fetch;
}

test('Excel export stops without saving when a single source returns HTTP error with readable JSON', async () => {
  let writeCalls = 0;
  let loadXlsxCalls = 0;
  const mockXlsx = {
    ...XLSX,
    writeFile: () => {
      writeCalls++;
    },
  } as typeof XLSX;

  const mockFetch = createMockFetch({
    '/api/analytics/machines': () =>
      Response.json({ error: 'Greška pri dohvatanju analitike mašina.' }, { status: 500 }),
  });

  await assert.rejects(
    exportAnalyticsExcel({
      apiBase: '/api',
      queryParams: 'dateFrom=2026-10-01&dateTo=2026-10-31',
      searchTerm: '',
      fuelFilters: 'dateFrom=2026-10-01&dateTo=2026-10-31',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      fetchFn: mockFetch,
      loadFuelExport: async () => validFuelReport(),
      loadXlsx: async () => {
        loadXlsxCalls++;
        return mockXlsx;
      },
    }),
    (err: unknown) => {
      assert.ok(err instanceof AnalyticsExportError);
      assert.equal(err.format, 'Excel');
      assert.equal(err.failures.length, 1);
      assert.equal(err.failures[0].section, 'Mašine');
      assert.match(err.message, /Mašine/);
      assert.match(err.message, /HTTP 500/);
      assert.match(err.message, /Greška pri dohvatanju analitike mašina/);
      return true;
    }
  );

  assert.equal(loadXlsxCalls, 0);
  assert.equal(writeCalls, 0);
});

test('Excel export stops without saving when a source returns HTTP 200 with unexpected JSON structure', async () => {
  let writeCalls = 0;
  const mockXlsx = {
    ...XLSX,
    writeFile: () => {
      writeCalls++;
    },
  } as typeof XLSX;

  const mockFetch = createMockFetch({
    '/api/analytics/financial': () => Response.json({ error: 'Neočekivano telo bez nizova' }, { status: 200 }),
  });

  await assert.rejects(
    exportAnalyticsExcel({
      apiBase: '/api',
      queryParams: '',
      searchTerm: '',
      fuelFilters: '',
      dateFrom: '',
      dateTo: '',
      fetchFn: mockFetch,
      loadFuelExport: async () => validFuelReport(),
      loadXlsx: async () => mockXlsx,
    }),
    (err: unknown) => {
      assert.ok(err instanceof AnalyticsExportError);
      assert.equal(err.failures.length, 1);
      assert.equal(err.failures[0].section, 'Mesečni troškovi');
      assert.match(err.message, /Mesečni troškovi/);
      assert.match(err.message, /neočekivana struktura/);
      return true;
    }
  );

  assert.equal(writeCalls, 0);
});

test('Excel export reports all failed sections together when multiple sources fail', async () => {
  let writeCalls = 0;
  const mockXlsx = {
    ...XLSX,
    writeFile: () => {
      writeCalls++;
    },
  } as typeof XLSX;

  const mockFetch = createMockFetch({
    '/api/analytics/machines': () => Response.json({ error: 'Baza nedostupna' }, { status: 503 }),
    '/api/analytics/works': () => new Response('<html>502 Bad Gateway</html>', { status: 200 }),
  });

  await assert.rejects(
    exportAnalyticsExcel({
      apiBase: '/api',
      queryParams: '',
      searchTerm: '',
      fuelFilters: '',
      dateFrom: '',
      dateTo: '',
      fetchFn: mockFetch,
      loadFuelExport: async () => {
        throw new Error('Analitika goriva nije dostupna.');
      },
      loadXlsx: async () => mockXlsx,
    }),
    (err: unknown) => {
      assert.ok(err instanceof AnalyticsExportError);
      assert.deepEqual(
        err.failures.map((f) => f.section),
        ['Mašine', 'Dnevnik radova', 'Efikasnost goriva']
      );
      assert.match(err.message, /Mašine/);
      assert.match(err.message, /Dnevnik radova/);
      assert.match(err.message, /Efikasnost goriva/);
      return true;
    }
  );

  assert.equal(writeCalls, 0);
});

test('Excel export succeeds when all sources return HTTP 200 with empty rows for the selected period', async () => {
  let savedWorkbook: XLSX.WorkBook | null = null;
  let savedFileName = '';
  const mockXlsx = {
    ...XLSX,
    writeFile: (wb: XLSX.WorkBook, filename: string) => {
      savedWorkbook = wb;
      savedFileName = filename;
    },
  } as typeof XLSX;

  const fileName = await exportAnalyticsExcel({
    apiBase: '/api',
    queryParams: 'dateFrom=2026-01-01&dateTo=2026-01-31',
    searchTerm: '',
    fuelFilters: 'dateFrom=2026-01-01&dateTo=2026-01-31',
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    fetchFn: createMockFetch(),
    loadFuelExport: async () => validFuelReport(),
    loadXlsx: async () => mockXlsx,
  });

  assert.equal(fileName, 'Nandra_Direktorska_Analitika_2026-01-01_2026-01-31.xlsx');
  assert.equal(savedFileName, fileName);
  assert.ok(savedWorkbook);
  const wb = savedWorkbook as XLSX.WorkBook;
  assert.deepEqual(wb.SheetNames, [
    'Pregled & KPI',
    'Mašine',
    'Radnici',
    'Parcele',
    'Gorivo normativi',
    'Gorivo odstupanja',
  ]);
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(bytes, { type: 'buffer' });
  const overviewSheet = XLSX.utils.sheet_to_json<{ Metrika: string; Vrednost: unknown }>(
    parsed.Sheets['Pregled & KPI']
  );
  assert.equal(overviewSheet[0].Vrednost, '2026-01-01 do 2026-01-31');
});

test('PDF export stops when workers endpoint returns HTTP error with readable JSON, and succeeds on empty period', async () => {
  const failingFetch = createMockFetch({
    '/api/analytics/workers': () =>
      Response.json({ error: 'Greška pri dohvatanju analitike radnika.' }, { status: 500 }),
  });

  await assert.rejects(
    loadPdfExportData({
      apiBase: '/api',
      queryParams: '',
      searchTerm: '',
      fuelFilters: '',
      fetchFn: failingFetch,
      loadFuelExport: async () => validFuelReport(),
    }),
    (err: unknown) => {
      assert.ok(err instanceof AnalyticsExportError);
      assert.equal(err.format, 'PDF');
      assert.equal(err.failures[0].section, 'Radnici');
      assert.match(err.message, /Radnici/);
      return true;
    }
  );

  const emptyPdfData = await loadPdfExportData({
    apiBase: '/api',
    queryParams: '',
    searchTerm: '',
    fuelFilters: '',
    fetchFn: createMockFetch(),
    loadFuelExport: async () => validFuelReport(),
  });
  assert.deepEqual(emptyPdfData.machines.machines, []);
  assert.deepEqual(emptyPdfData.workers.workers, []);
});

test('Excel export populates optional sheets when rows exist and forwards search/all params', async () => {
  const seenUrls: string[] = [];
  let savedWorkbook: XLSX.WorkBook | null = null;
  const mockXlsx = {
    ...XLSX,
    writeFile: (wb: XLSX.WorkBook) => {
      savedWorkbook = wb;
    },
  } as typeof XLSX;

  const baseFetch = createMockFetch({
    '/api/analytics/machines': () =>
      Response.json({
        machines: [
          {
            machine: { name: 'John Deere 6155', type: 'TRAKTOR', brandModel: '6155M', currentHours: 1200, status: 'AKTIVNA' },
            fieldWork: { totalHa: 45, totalWorkHours: 15 },
            fuel: { totalLiters: 400, totalCost: 80000 },
            maintenance: {
              totalCost: 25000,
              partsCost: 15000,
              laborCost: 10000,
              count: 1,
              downtimeHours: 4.5,
              recentRepairs: [
                {
                  dateReported: '2026-10-12T08:00:00.000Z',
                  title: 'Zamena filtera',
                  serviceType: 'REDOVAN',
                  priority: 'SREDNJI',
                  status: 'ZAVRSENO',
                  totalCost: 25000,
                  downtimeHours: 4.5,
                },
              ],
            },
            tolls: { totalCost: 0 },
            totalCostMachine: 105000,
          },
        ],
      }),
    '/api/analytics/financial': () =>
      Response.json({
        allFuelByMonth: [{ month: '2026-10', total_liters: 400, total_cost: 80000 }],
        maintenanceByMonth: [{ month: '2026-10', total_cost: 25000 }],
        tollsByMonth: [],
        seasonalByMonth: [],
      }),
    '/api/analytics/works': () =>
      Response.json({
        works: [
          {
            date: '2026-10-10T00:00:00.000Z',
            shift: 'PRVA',
            worker: { name: 'Marko' },
            workType: { name: 'Oranje' },
            parcel: { code: 'P1', name: 'Sever' },
            machine: { name: 'John Deere 6155' },
            areaDoneHa: 15,
            workHours: 5,
          },
        ],
      }),
  });

  const trackingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrls.push(String(input));
    return baseFetch(input, init);
  }) as typeof fetch;

  await exportAnalyticsExcel({
    apiBase: '/api',
    queryParams: 'dateFrom=2026-10-01&dateTo=2026-10-31',
    searchTerm: ' John ',
    fuelFilters: 'dateFrom=2026-10-01&dateTo=2026-10-31&search=John',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
    fetchFn: trackingFetch,
    loadFuelExport: async () => validFuelReport(),
    loadXlsx: async () => mockXlsx,
  });

  assert.ok(savedWorkbook);
  const wb = savedWorkbook as XLSX.WorkBook;
  assert.ok(wb.SheetNames.includes('Istorija Popravki'));
  assert.ok(wb.SheetNames.includes('Mesečni Troškovi'));
  assert.ok(wb.SheetNames.includes('Dnevnik Radova'));
  const machinesUrl = seenUrls.find((u) => u.includes('/analytics/machines'));
  assert.ok(machinesUrl);
  const parsedUrl = new URL(machinesUrl, 'http://localhost');
  assert.equal(parsedUrl.searchParams.get('all'), 'true');
  assert.equal(parsedUrl.searchParams.get('search'), 'John');
});

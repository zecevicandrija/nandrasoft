import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchFuelEfficiency, fetchFuelExport, fuelFilterParams } from '../src/Analitika/fuelEfficiencyQueries.ts';

test('fuel request forwards every shared filter and independent ten-row pages', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  const filters = fuelFilterParams({ dateFrom: '2026-10-01', dateTo: '2026-10-31', machineId: 'm', workerId: 'w', parcelId: 'p', search: ' oranje ' });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    assert.equal(url.searchParams.get('machineId'), 'm'); assert.equal(url.searchParams.get('workerId'), 'w');
    assert.equal(url.searchParams.get('parcelId'), 'p'); assert.equal(url.searchParams.get('search'), 'oranje');
    assert.equal(url.searchParams.get('dateFrom'), '2026-10-01'); assert.equal(url.searchParams.get('dateTo'), '2026-10-31');
    assert.equal(url.searchParams.get('operationsPage'), '3'); assert.equal(url.searchParams.get('criticalPage'), '2');
    assert.equal(url.searchParams.get('limit'), '10'); assert.equal(options?.signal, controller.signal);
    return Response.json({ operations: [], criticalWorks: [] });
  };
  try { await fetchFuelEfficiency(filters, 3, 2, controller.signal); } finally { globalThis.fetch = original; }
});

test('opening the tab fetches a single page; explicit export collects both tables without duplicates', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    calls++;
    const params = new URL(String(input), 'http://localhost').searchParams;
    assert.equal(params.get('machineId'), 'm');
    const op = Number(params.get('operationsPage')), critical = Number(params.get('criticalPage'));
    return Response.json({
      operations: Array.from({ length: op === 3 ? 5 : 10 }, (_, i) => ({ workTypeId: `op-${(op - 1) * 10 + i}` })),
      criticalWorks: Array.from({ length: critical === 2 ? 2 : 10 }, (_, i) => ({ id: `work-${(critical - 1) * 10 + i}` })),
      operationsPagination: { page: op, limit: 10, total: 25, totalPages: 3 },
      criticalPagination: { page: critical, limit: 10, total: 12, totalPages: 2 }, summary: { totalLiters: 500 },
    });
  };
  try {
    const initial = await fetchFuelEfficiency('machineId=m');
    assert.equal(calls, 1); assert.equal(initial.operations.length, 10);
    calls = 0;
    const result = await fetchFuelExport('machineId=m');
    assert.equal(calls, 3); assert.equal(result.operations.length, 25); assert.equal(result.criticalWorks.length, 12);
    assert.equal(new Set(result.operations.map(o => o.workTypeId)).size, 25);
    assert.equal(new Set(result.criticalWorks.map(w => w.id)).size, 12);
  } finally { globalThis.fetch = original; }
});

test('a failed page stops export instead of silently producing a partial report', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  try { await assert.rejects(fetchFuelExport(''), /Analitika goriva/); } finally { globalThis.fetch = original; }
});

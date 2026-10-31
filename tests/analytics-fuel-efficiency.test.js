import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { calculateFuelEfficiency, efficiency, loadFuelEfficiency } from '../lib/fuelEfficiency.js';
import { prisma } from '../lib/prisma.js';
const restore = [];
const patch = (obj, key, value) => { const old = obj[key]; obj[key] = value; restore.push(() => { obj[key] = old; }); };
import { auth } from '../routes/auth.js';
import router from '../routes/analytics.js';
const norm = { id: 'type', name: 'Oranje', category: 'OBRADA', fuelNormLitersPerHa: 10 };
const assignment = { id: 'a', machineId: 'm', workerId: 'w', assignedAt: new Date('2026-10-01T06:00Z'), returnedAt: new Date('2026-10-03T18:00Z'), startFuelLiters: 100, endFuelLiters: 20 };
const work = { id: 'work', machineId: 'm', workerId: 'w', parcelId: 'p', workTypeId: 'type', workType: norm,
  date: new Date('2026-10-01T12:00Z'), areaDoneHa: 10, workHours: 5, parcel: { name: 'P' }, machine: { name: 'M' }, worker: { name: 'W' } };
const refill = { machineId: 'm', date: new Date('2026-10-02T08:00Z'), liters: 50 };
const input = { works: [work], assignments: [assignment], entries: [refill], workTypes: [norm] };
test('balance includes refills and detects >25% deviation', () => {
  const r = calculateFuelEfficiency(input);
  assert.equal(r.summary.totalLiters, 130); assert.equal(r.summary.actualLPerHa, 13);
  assert.ok(Math.abs(r.operations[0].variancePercent - 30) < 1e-8);
  assert.equal(r.operations[0].status, 'ANOMALIJA'); assert.equal(r.criticalWorks[0].machine, 'M');
});
test('thresholds and missing norm/coverage', () => {
  for (const [liters, status] of [[110, 'OPTIMALNO'], [110.1, 'UPOZORENJE'], [125, 'UPOZORENJE'], [126, 'ANOMALIJA']]) {
    assert.equal(efficiency(liters, 10, 10).status, status);
  }
  assert.equal(efficiency(100, 0, 10).actualLPerHa, null);
  assert.equal(efficiency(100, 10, null).status, 'NEMA_PODATAKA');
});
test('shorter report period preserves allocation across full assignment', () => {
  const second = { ...work, id: 'second', date: new Date('2026-10-03T12:00Z'), workHours: 15 };
  const r = calculateFuelEfficiency({ ...input, works: [work, second], dateTo: new Date('2026-10-01T23:59Z') });
  assert.equal(r.summary.totalLiters, 32.5); assert.equal(r.summary.totalHa, 10);
});
test('missing fuel levels, invalid balances, ambiguous and zero area works never generate alarms', () => {
  for (const change of [
    { assignments: [{ ...assignment, endFuelLiters: null }] },
    { assignments: [{ ...assignment, endFuelLiters: 200 }] },
    { assignments: [assignment, { ...assignment, id: 'overlap' }] },
    { works: [{ ...work, areaDoneHa: 0 }] },
    { assignments: [] },
  ]) {
    const r = calculateFuelEfficiency({ ...input, ...change });
    assert.equal(r.summary.totalLiters, 0); assert.equal(r.criticalWorks.length, 0);
    assert.equal(r.summary.uncoveredWorksCount, 1);
  }
});
test('area fallback, zero consumption, inactive operations and covered area denominator', () => {
  const extra = { ...work, id: 'missing', machineId: 'unmeasured', areaDoneHa: 30 };
  const r = calculateFuelEfficiency({ ...input, works: [{ ...work, workHours: null }, extra], workTypes: [] });
  assert.equal(r.summary.actualLPerHa, 13); assert.equal(r.summary.coveredHa, 10); assert.equal(r.summary.totalHa, 40);
  const zero = calculateFuelEfficiency({ ...input, assignments: [{ ...assignment, endFuelLiters: 150 }] });
  assert.equal(zero.summary.actualLPerHa, 0); assert.equal(zero.operations[0].status, 'OPTIMALNO');
});
test('invalid date filters reject before any queries', async () => {
  for (const query of [{ dateFrom: 'bad' }, { dateTo: '2026-02-30' }, { dateFrom: '2026-10-10', dateTo: '2026-10-01' }]) {
    await assert.rejects(loadFuelEfficiency({}, query), /INVALID_FUEL_QUERY/);
  }
});
function request(query = {}) {
  return new Promise((resolve, reject) => router.handle({ method: 'GET', url: '/fuel-efficiency', headers: {}, query }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); },
  }, error => reject(error || new Error('Unhandled request'))));
}
test('endpoint calculates report, validates dates and is director-only', async () => {
  let role = 'DIREKTOR';
  mock.method(auth.api, 'getSession', async () => ({ user: { id: 'u', role, isActive: true }, session: {} }));
  patch(prisma, '$transaction', async fn => fn({
    async $executeRaw() {},
    async $queryRaw(sql) {
      assert.ok(sql.text.includes('LIMIT 10 OFFSET'));
      const report = calculateFuelEfficiency(input);
      report.summary.dispensedCostRSD = 10000;
      return [{ report }];
    },
  }));
  try {
    const r = await request({ dateFrom: '2026-10-01', dateTo: '2026-10-02' });
    assert.equal(r.status, 200); assert.equal(r.body.summary.totalLiters, 130);
    assert.equal(r.body.summary.dispensedCostRSD, 10000);
    assert.equal((await request({ dateFrom: 'bad' })).status, 400);
    for (role of ['OPERATER', 'RUKOVODILAC']) assert.equal((await request()).status, 403);
  } finally { mock.restoreAll(); restore.splice(0).reverse().forEach(fn => fn()); }
});

test.after(async () => { await prisma.$disconnect(); });

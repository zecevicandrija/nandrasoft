import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { fuelEfficiencyQuery, fuelEfficiencySql, loadPagedFuelEfficiency } from '../lib/fuelEfficiencyQuery.js';

test('pages are capped at ten and every user filter is parameterized', async () => {
  const q = fuelEfficiencyQuery.parse({ machineId: "m' OR TRUE --", workerId: 'w', parcelId: 'p', search: '100%', operationsPage: '3', criticalPage: '2' });
  const sql = fuelEfficiencySql(q);
  assert.equal(q.limit, 10);
  assert.ok(!sql.text.includes(q.machineId)); assert.ok(sql.values.includes(q.machineId));
  assert.ok(sql.values.includes('w')); assert.ok(sql.values.includes('p'));
  assert.ok(sql.text.includes('LIMIT 10 OFFSET')); assert.ok(sql.values.includes(20));
  for (const bad of [{ operationsPage: '0' }, { criticalPage: '-1' }, { limit: 1000 }, { machineId: ['m'] }, { dateTo: '2026-02-30' }]) {
    await assert.rejects(loadPagedFuelEfficiency({}, bad), /INVALID_FUEL_QUERY/);
  }
});

test('PostgreSQL paginates both tables, filters all summaries and keeps full assignment weights', {
  skip: process.env.TEST_FUEL_DB !== '1',
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    // Session-local tables shadow real relations. No persistent data is read or changed.
    await client.query(`CREATE TEMP TABLE field_work (id text, date timestamp, status text, "machineId" text, "workerId" text, "parcelId" text, "workTypeId" text, "areaDoneHa" float8, "workHours" float8);
      CREATE TEMP TABLE work_type (id text, name text, category text, "fuelNormLitersPerHa" float8);
      CREATE TEMP TABLE machine (id text, name text);
      CREATE TEMP TABLE worker (id text, name text);
      CREATE TEMP TABLE parcel (id text, name text);
      CREATE TEMP TABLE machine_assignment (id text, "machineId" text, "workerId" text, "parcelId" text, status text, "assignedAt" timestamp, "returnedAt" timestamp, "startFuelLiters" float8, "endFuelLiters" float8);
      CREATE TEMP TABLE fuel_entry ("machineId" text, "workerId" text, date timestamp, liters float8, "totalCost" numeric);
      INSERT INTO work_type SELECT 't'||n, 'Operation '||lpad(n::text,2,'0'), 'OBRADA',10 FROM generate_series(1,25) n;
      INSERT INTO machine SELECT 'm'||n,'Machine '||n FROM generate_series(1,25) n;
      INSERT INTO worker VALUES ('w1','Worker 1'),('w2','Worker 2'); INSERT INTO parcel VALUES ('p1','Parcel 1'),('p2','Parcel 2');
      INSERT INTO field_work SELECT 'work'||n,'2026-10-01 12:00','ZAVRSENO','m'||n,'w'||(n%2+1),'p'||(n%2+1),'t'||n,1,5 FROM generate_series(1,25) n;
      INSERT INTO machine_assignment SELECT 'a'||n,'m'||n,'w'||(n%2+1),NULL,'RAZDUZENA','2026-10-01 06:00','2026-10-03 18:00',100,80 FROM generate_series(1,25) n;
      INSERT INTO fuel_entry VALUES ('m1','w2','2026-10-02 08:00',5,1000);`);
    const tx = { async $executeRaw(strings, ...values) { const q = strings.reduce((s, part, i) => s + (i ? '$'+i : '') + part, ''); return client.query(q, values); }, async $queryRaw(sql) { return (await client.query(sql.text, sql.values)).rows; } };
    const db = { async $transaction(fn) { await client.query('BEGIN'); try { const r = await fn(tx); await client.query('COMMIT'); return r; } catch(e) { await client.query('ROLLBACK'); throw e; } } };
    const first = await loadPagedFuelEfficiency(db, {});
    assert.equal(first.operations.length,10); assert.equal(first.criticalWorks.length,10);
    assert.equal(first.operationsPagination.total,25); assert.equal(first.criticalPagination.totalPages,3);
    assert.equal(first.summary.totalLiters,505); assert.equal(first.summary.criticalWorksCount,25);
    const second = await loadPagedFuelEfficiency(db, { operationsPage: 2, criticalPage: 2 });
    assert.equal(second.operations.length,10); assert.equal(second.summary.totalLiters,505);
    assert.equal(new Set([...first.operations,...second.operations].map(x => x.workTypeId)).size,20);
    assert.equal(new Set([...first.criticalWorks,...second.criticalWorks].map(x => x.id)).size,20);
    const third = await loadPagedFuelEfficiency(db, { operationsPage: 3, criticalPage: 3 });
    assert.equal(third.operations.length,5); assert.equal(third.criticalWorks.length,5);
    const filtered = await loadPagedFuelEfficiency(db, { machineId: 'm1', workerId: 'w2', parcelId: 'p2', dateFrom: '2026-10-01', dateTo: '2026-10-02' });
    assert.equal(filtered.operationsPagination.total,1); assert.equal(filtered.summary.totalLiters,25); assert.equal(filtered.summary.dispensedCostRSD,1000);
    for (const filter of [{ workerId:'w1' },{ parcelId:'p1' }]) {
      const r = await loadPagedFuelEfficiency(db, filter); assert.equal(r.summary.totalLiters,240); assert.equal(r.operationsPagination.total,12);
    }
    const empty = await loadPagedFuelEfficiency(db, { machineId:'missing' });
    assert.equal(empty.operations.length,0); assert.equal(empty.summary.totalLiters,0); assert.equal(empty.summary.actualLPerHa,null);
    assert.equal((await loadPagedFuelEfficiency(db,{ search:'Operation 01' })).operationsPagination.total,1);
    await client.query(`INSERT INTO field_work VALUES ('outside','2026-10-03 12:00','ZAVRSENO','m1','w2','p1','t1',3,15)`);
    const partial = await loadPagedFuelEfficiency(db,{ machineId:'m1', parcelId:'p2',dateTo:'2026-10-01' });
    assert.equal(partial.summary.totalLiters,6.25); assert.equal(partial.summary.coveredHa,1);
    await client.query(`UPDATE machine_assignment SET "endFuelLiters"=NULL WHERE id='a1'`);
    const missing = await loadPagedFuelEfficiency(db,{ machineId:'m1' });
    assert.equal(missing.summary.actualLPerHa,null); assert.equal(missing.summary.uncoveredWorksCount,2);
    await client.query(`UPDATE machine_assignment SET "endFuelLiters"=200 WHERE id='a1'`);
    const negative = await loadPagedFuelEfficiency(db,{ machineId:'m1' });
    assert.equal(negative.summary.totalLiters,0); assert.equal(negative.criticalWorks.length,0);
    await client.query(`UPDATE machine_assignment SET "endFuelLiters"=80 WHERE id='a1';
      INSERT INTO machine_assignment VALUES ('overlap','m1','w2',NULL,'RAZDUZENA','2026-10-02 06:00','2026-10-03 18:00',100,80)`);
    const ambiguous = await loadPagedFuelEfficiency(db,{ machineId:'m1' });
    assert.equal(ambiguous.summary.totalLiters,0); assert.equal(ambiguous.summary.uncoveredWorksCount,2);
    assert.equal(ambiguous.criticalWorks.length,0);
    await client.query(`INSERT INTO machine VALUES ('split','Two refills');
      INSERT INTO field_work VALUES ('split-work','2026-10-04 12:00','ZAVRSENO','split','w1','p1','t1',10,5);
      INSERT INTO machine_assignment VALUES ('split-assignment','split','w1','p1','RAZDUZENA','2026-10-04 06:00','2026-10-04 18:00',100,100);
      INSERT INTO fuel_entry VALUES ('split','w1','2026-10-04 08:00',40,8000), ('split','w1','2026-10-04 10:00',60,12000)`);
    const multipleRefills = await loadPagedFuelEfficiency(db, { machineId: 'split' });
    assert.equal(multipleRefills.summary.totalLiters,100);
    assert.equal(multipleRefills.summary.coveredHa,10);
    assert.equal(multipleRefills.summary.totalHa,10);
    assert.equal(multipleRefills.summary.actualLPerHa,10);
    assert.equal(multipleRefills.operations[0].worksCount,1);
  } finally { await client.end(); }
});

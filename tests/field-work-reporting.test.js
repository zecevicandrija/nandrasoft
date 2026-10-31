import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { Prisma } from "@prisma/client";
import { reportingQuery, fieldWorkStats, unassignedWorkPage } from "../lib/fieldWorkReporting.js";
import "dotenv/config";

test("reporting filters validate calendar dates, ordering and bounded pagination", () => {
  for (const query of [{ dateFrom: "2026-02-30" }, { dateTo: "bad" }, { dateFrom: "2026-10-31", dateTo: "2026-10-01" },
    { limit: "101" }, { limit: "0" }, { page: "-1" }, { period: "bad" }]) {
    assert.equal(reportingQuery.safeParse(query).success, false);
  }
  assert.equal(reportingQuery.parse({}).limit, 50);
});

test("PostgreSQL reporting handles calendar days, permissions, pagination and 10,000 works/assignments", { skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 30000 }, async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, types: {
    // Match Prisma's UTC treatment of timestamp-without-time-zone columns.
    getTypeParser(oid, format) { return oid === 1114 ? (value) => new Date(`${value}Z`) : pg.types.getTypeParser(oid, format); },
  } });
  await client.connect();
  let lastStatsQuery, detailReads = 0;
  const query = (strings, values) => { const q = Prisma.sql(strings, ...values); return { text: q.text, values: q.values }; };
  const tx = {
    async $executeRaw(strings, ...values) { return client.query(query(strings, values)); },
    async $queryRaw(strings, ...values) {
      const q = query(strings, values);
      if (q.text.includes("classified AS MATERIALIZED")) lastStatsQuery = q;
      return (await client.query(q)).rows;
    },
    fieldWork: {
      async groupBy({ where }) {
        const rows = (await client.query(`SELECT "workTypeId", SUM("areaDoneHa") AS area, SUM("workHours") AS hours, COUNT(*)::int AS count
          FROM pg_temp.field_work WHERE status <> 'STORNO' AND ($1::text IS NULL OR "workerId" = $1) GROUP BY "workTypeId"`, [where.workerId ?? null])).rows;
        return rows.map((row) => ({ workTypeId: row.workTypeId, _sum: { areaDoneHa: row.area, workHours: row.hours }, _count: { id: row.count } }));
      },
      async findMany({ where, take }) {
        detailReads++; assert.ok(where.id.in.length <= 100 && take <= 100);
        return (await client.query('SELECT * FROM pg_temp.field_work WHERE id = ANY($1::text[]) ORDER BY date DESC, id DESC LIMIT $2', [where.id.in, take])).rows;
      },
    },
  };
  const db = { async $transaction(callback, options) {
    assert.equal(options.isolationLevel, "RepeatableRead"); await client.query("BEGIN");
    try { const result = await callback(tx); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  } };
  const now = new Date("2026-10-30T12:00:00Z");
  const filters = (q = {}) => reportingQuery.parse(q);
  try {
    // Temporary tables shadow business tables only within this connection.
    await client.query(`CREATE TEMP TABLE field_work (id text PRIMARY KEY, date timestamp NOT NULL, "machineId" text NOT NULL,
      "workerId" text NOT NULL, "workTypeId" text NOT NULL DEFAULT 'type', "areaDoneHa" float8, "workHours" float8, status text NOT NULL DEFAULT 'ZAVRSENO');
      CREATE TEMP TABLE machine_assignment ("machineId" text NOT NULL, "assignedAt" timestamp NOT NULL);
      CREATE INDEX reporting_test_assignment_idx ON machine_assignment ("machineId", "assignedAt");
      INSERT INTO pg_temp.field_work (id,date,"machineId","workerId","areaDoneHa","workHours",status) VALUES
      ('a','2026-10-30 11:00','a','w1',1,1,'ZAVRSENO'), ('b','2026-10-30 22:30','b','w1',2,2,'ZAVRSENO'),
      ('dst','2026-10-24 22:15','c','w1',3,3,'ZAVRSENO'), ('midnight','2026-10-25 23:00','d','w1',4,4,'ZAVRSENO'),
      ('old','2024-01-01 12:00','a','w1',5,5,'ZAVRSENO'), ('cancelled','2026-10-30 12:00','x','w1',999,999,'STORNO'),
      ('other','2026-10-30 12:00','a','w2',6,6,'ZAVRSENO'), ('f','2026-10-30 12:00','f','w1',7,NULL,'ZAVRSENO'), ('g','2026-10-30 12:00','g','w1',8,8,'ZAVRSENO');
      INSERT INTO pg_temp.machine_assignment VALUES ('a','2026-10-29 23:30'), ('a','2026-10-30 10:00'),
      ('b','2026-10-30 23:30'), ('c','2026-10-25 22:30'), ('d','2026-10-25 22:59');`);
    await t.test("aggregates exclude storno and do not multiply works by duplicate assignments", async () => {
      const result = await fieldWorkStats(db, filters(), null, now);
      assert.deepEqual(result.today, { count: 5, areaDoneHa: 24, workHours: 17, unassignedWarnings: 3 });
      assert.equal(result.week.count, 6); assert.equal(result.month.count, 7);
      assert.equal(result.current.count, 8); assert.equal(result.current.workHours, 29);
      assert.equal(result.unassignedWarningsTotal, 5); assert.equal(detailReads, 0);
    });
    await t.test("worker filters, empty data and DST date ranges give correct aggregates", async () => {
      const result = await fieldWorkStats(db, filters({ period: "danas" }), "w1", now);
      assert.equal(result.current.count, 4); assert.equal(result.current.areaDoneHa, 18);
      assert.equal(result.workTypesBreakdown[0]._count.id, 7);
      assert.equal((await fieldWorkStats(db, filters(), "empty", now)).current.count, 0);
      const dst = await fieldWorkStats(db, filters({ dateFrom: "2026-10-25", dateTo: "2026-10-25" }), null, now);
      assert.deepEqual(dst.current, { count: 1, areaDoneHa: 3, workHours: 3, unassignedWarnings: 0 });
      assert.equal((await fieldWorkStats(db, filters({ dateTo: "2024-01-01" }), null, now)).current.count, 1);
    });
    await t.test("pages are bounded and nonoverlapping, with exact counts and UTC boundaries", async () => {
      const first = await unassignedWorkPage(db, filters({ limit: 2 }), now);
      const second = await unassignedWorkPage(db, filters({ limit: 2, page: 2 }), now);
      assert.equal(first.count, 3); assert.equal(first.totalPages, 2);
      assert.equal(first.items.length, 2); assert.equal(second.items.length, 1);
      assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 3);
      assert.equal(first.period.from.toISOString(), "2026-10-29T23:00:00.000Z");
      assert.equal(first.period.to.toISOString(), "2026-10-30T22:59:59.999Z");
    });
    await t.test("large histories return compact aggregates and use the assignment index", async () => {
      await client.query(`TRUNCATE pg_temp.field_work, pg_temp.machine_assignment;
        INSERT INTO pg_temp.field_work (id,date,"machineId","workerId","areaDoneHa","workHours")
        SELECT n::text, '2026-10-30 12:00'::timestamp, 'm_' || n, 'w1', 1, 1 FROM generate_series(1,10000) n;
        INSERT INTO pg_temp.machine_assignment SELECT 'm_' || n, '2026-10-30 08:00'::timestamp FROM generate_series(1,10000) n;
        ANALYZE pg_temp.field_work; ANALYZE pg_temp.machine_assignment;`);
      const before = detailReads;
      const result = await fieldWorkStats(db, filters(), null, now);
      assert.equal(result.current.count, 10000); assert.equal(result.unassignedWarningsTotal, 0);
      assert.equal(detailReads, before); assert.ok(JSON.stringify(result).length < 2000);
      const plan = (await client.query({ text: `EXPLAIN (ANALYZE, FORMAT JSON) ${lastStatsQuery.text}`, values: lastStatsQuery.values })).rows[0]["QUERY PLAN"];
      assert.match(JSON.stringify(plan), /reporting_test_assignment_idx/);
      t.diagnostic(`Indexed SQL execution for 10,000 works/assignments: ${plan[0]["Execution Time"]} ms (local test).`);
    });
  } finally { await client.end(); }
});

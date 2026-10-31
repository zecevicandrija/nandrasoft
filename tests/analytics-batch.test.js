import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { loadAnalyticsBatch } from "../lib/analyticsBatch.js";
import { prisma } from "../lib/prisma.js";
import analytics from "../routes/analytics.js";

const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-31T23:59:59.999Z");
const range = { gte: from, lte: to };

function fixture(size) {
  const calls = [];
  const data = Object.fromEntries(["machine", "worker", "parcel", "workType", "fieldWork", "fuelEntry", "maintenanceIssue", "tollEntry", "workOrder"].map((key) => [key, []]));
  for (let i = 0; i < size; i++) {
    data.machine.push({ id: `m${i}`, name: `Machine ${i}`, isActive: true });
    data.worker.push({ id: `w${i}`, name: `Worker ${i}`, isActive: true, hourlyRate: 12.34 });
    for (let j = 0; j < 12; j++) {
      data.fieldWork.push({ id: `${i}-${j}`, machineId: `m${i}`, workerId: `w${i}`, workTypeId: "type", parcelId: `p${j}`,
        date: from, status: "ZAVRSENO", areaDoneHa: j + 1, workHours: 0.5 });
    }
    data.fieldWork.push({ machineId: `m${i}`, workerId: `w${i}`, date: from, status: "STORNO", areaDoneHa: 999 });
    data.fieldWork.push({ machineId: `m${i}`, workerId: `w${i}`, date: new Date("2025-01-01"), status: "ZAVRSENO", areaDoneHa: 999 });
    data.fuelEntry.push({ machineId: `m${i}`, workerId: `w${i}`, date: to, liters: 39, totalCost: 0.1 });
    data.tollEntry.push({ machineId: `m${i}`, workerId: `w${i}`, date: from, amount: 0.2 });
    data.maintenanceIssue.push({ machineId: `m${i}`, reportedById: `w${i}`, dateReported: from, totalCost: 0.3, partsCost: null, laborCost: 0.3, downtimeHours: 2 });
    data.workOrder.push({ workerId: `w${i}`, orderDate: to, status: "ZAVRSEN" });
  }
  data.workType.push({ id: "type", name: "Type" });
  data.parcel = Array.from({ length: 12 }, (_, j) => ({ id: `p${j}`, code: `P${j}`, name: `Parcel ${j}` }));
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if (value.in) return value.in.includes(row[key]);
      if (value.contains) return row[key]?.toLowerCase().includes(value.contains.toLowerCase());
      return (!value.gte || row[key] >= value.gte) && (!value.lte || row[key] <= value.lte);
    }
    return row[key] === value;
  });
  const db = Object.fromEntries(Object.keys(data).map((model) => [model, {
    async count(args) { calls.push({ model, operation: "count", ...args }); return data[model].filter((row) => matches(row, args.where)).length; },
    async findMany(args) {
      calls.push({ model, operation: "findMany", ...args });
      const rows = data[model].filter((row) => matches(row, args.where));
      return rows.slice(args.skip || 0, args.take ? (args.skip || 0) + args.take : undefined);
    },
    async groupBy(args) {
      calls.push({ model, operation: "groupBy", ...args });
      const groups = new Map();
      for (const row of data[model].filter((row) => matches(row, args.where))) {
        const key = JSON.stringify(args.by.map((key) => row[key]));
        if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(args.by.map((key) => [key, row[key]])), _sum: {}, _count: 0 });
        const group = groups.get(key);
        group._count++;
        for (const key of Object.keys(args._sum || {})) group._sum[key] = (group._sum[key] || 0) + (row[key] || 0);
      }
      const rows = [...groups.values()];
      if (args.orderBy) {
        const key = Object.keys(args.orderBy._sum)[0];
        rows.sort((a, b) => b._sum[key] - a._sum[key]);
      }
      return rows;
    },
  }]));
  db.$queryRaw = async (sql) => { calls.push({ operation: "raw", sql }); return []; };
  return { db, data, calls };
}

async function request(path, query) {
  const handler = analytics.stack.find((layer) => layer.route?.path === path).route.stack[0].handle;
  let result;
  await handler({ query }, { json(body) { result = body; }, status(code) { throw new Error(`Unexpected HTTP ${code}`); } });
  return result;
}

test("analytics responses preserve totals, dates, per-entity limits and pagination with constant query counts", async () => {
  for (const size of [1, 10, 100]) {
    const { db, calls } = fixture(size);
    const originals = Object.fromEntries(Object.keys(db).map((key) => [key, prisma[key]]));
    Object.assign(prisma, db);
    try {
      const query = { dateFrom: "2026-10-01", dateTo: "2026-10-31", all: "true" };
      const machines = await request("/machines", query);
      assert.equal(calls.length, 11);
      assert.equal(machines.machines.length, size);
      assert.deepEqual(machines.pagination, { total: size, page: 1, limit: size, totalPages: 1 });
      for (const row of machines.machines) {
        assert.deepEqual(row.fieldWork, { totalHa: 78, totalWorkHours: 6, count: 12 });
        assert.equal(row.fuel.avgLPerHa, null, "Refills must not be presented as measured consumption");
        assert.equal(row.maintenance.count, 1);
        assert.equal(row.totalCostMachine, 0.6);
        assert.equal(row.topWorkers[0].totalHa, 78);
        assert.equal(row.workTypeBreakdown[0].count, 12);
      }
      calls.length = 0;
      const workers = await request("/workers", query);
      assert.equal(calls.length, 13);
      for (const row of workers.workers) {
        assert.equal(row.fieldWork.estimatedLabourCost, 74.04);
        assert.equal(row.maintenanceReported, 1);
        assert.deepEqual(row.orderStats, { ZAVRSEN: 1 });
        assert.equal(row.parcelBreakdown.length, 10);
        assert.equal(row.parcelBreakdown[0].totalHa, 12);
        assert.equal(row.parcelBreakdown[9].totalHa, 3);
      }
      calls.length = 0;
      const page = await request("/workers", { ...query, all: undefined, limit: "1", page: "2" });
      assert.equal(page.workers.length, size > 1 ? 1 : 0);
      assert.equal(page.pagination.total, size);
      if (size > 1) assert.equal(page.workers[0].worker.id, "w1");
    } finally { Object.assign(prisma, originals); }
  }
});

test("empty entities have zero aggregates; empty pages perform no analytics queries", async () => {
  const { db, data, calls } = fixture(1);
  const empty = await loadAnalyticsBatch(db, "machine", [], { date: range }, { dateReported: range });
  assert.equal(empty.size, 0);
  assert.equal(calls.length, 0);
  for (const model of ["fieldWork", "fuelEntry", "maintenanceIssue", "tollEntry", "workOrder"]) data[model] = [];
  const stats = (await loadAnalyticsBatch(db, "worker", ["w0"], { date: range }, { dateReported: range }, { orderDate: range })).get("w0");
  assert.deepEqual(stats.fieldWork, { _sum: {}, _count: 0 });
  assert.equal(stats.maintenance, 0);
  assert.deepEqual(stats.related, []);
  assert.deepEqual(stats.orderStats, []);
});

test("top limits apply separately to each parent before name lookups", async () => {
  const { db, data } = fixture(2);
  data.fieldWork = [];
  for (let parent = 0; parent < 2; parent++) for (let j = 0; j < 12; j++) {
    data.fieldWork.push({ machineId: `m${parent}`, workerId: `other${j}`, workTypeId: "type", date: from,
      status: "ZAVRSENO", areaDoneHa: j, workHours: 1 });
    data.fieldWork.push({ machineId: `other${j}`, workerId: `w${parent}`, workTypeId: "type", date: from,
      status: "ZAVRSENO", areaDoneHa: j, workHours: 1 });
  }
  for (const [kind, ids, limit] of [["machine", ["m0", "m1"], 5], ["worker", ["w0", "w1"], 10]]) {
    const stats = await loadAnalyticsBatch(db, kind, ids, { date: range }, { dateReported: range });
    for (const id of ids) {
      assert.equal(stats.get(id).related.length, limit);
      assert.equal(stats.get(id).related[0]._sum.areaDoneHa, 11);
      assert.equal(stats.get(id).related.at(-1)._sum.areaDoneHa, 12 - limit);
    }
  }
});

test("PostgreSQL recent repairs query bounds each machine and preserves historical repairs", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1",
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(`CREATE TEMP TABLE maintenance_issue (id text, "machineId" text, title text, "serviceType" text,
      priority text, status text, "totalCost" numeric(15,2), "partsReplaced" text, "repairNotes" text,
      "dateReported" timestamp, "repairedAt" timestamp, "downtimeHours" float8, "lubricantType" text, "lubricantLiters" float8);
      INSERT INTO maintenance_issue (id, "machineId", "dateReported", "totalCost")
      SELECT n::text, m, '2020-01-01'::timestamp + n * interval '1 day', 0.01
      FROM generate_series(1,15) n CROSS JOIN unnest(ARRAY['m0','m1','excluded']) m;`);
    const { db } = fixture(2);
    db.$queryRaw = async (sql) => (await client.query({ text: sql.text, values: sql.values })).rows;
    const stats = await loadAnalyticsBatch(db, "machine", ["m0", "m1' OR true --", "m1"], { date: range }, { dateReported: range });
    for (const id of ["m0", "m1"]) {
      const repairs = stats.get(id).recentRepairs;
      assert.equal(repairs.length, 10);
      assert.equal(repairs[0].id, "15");
      assert.equal(repairs.at(-1).id, "6");
      assert.equal("machineId" in repairs[0], false);
    }
    assert.deepEqual(stats.get("m1' OR true --").recentRepairs, []);
  } finally { await client.end(); }
});

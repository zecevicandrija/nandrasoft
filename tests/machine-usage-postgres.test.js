import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import usageRouter from "../routes/machineUsage.js";
import fieldRouter from "../routes/fieldWork.js";
import { usageContext } from "../lib/machineUsageService.js";
import { usageGroupBy } from "../lib/machineUsageReporting.js";
import { fuelEfficiencySql, fuelEfficiencyQuery } from "../lib/fuelEfficiencyQuery.js";

test("real PostgreSQL migration, replacement, completion, correction and multi-machine reports", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 60000,
}, async () => {
  const schema = `nandra_usage_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^nandra_usage_test_[a-f0-9]{32}$/);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set("schema", schema);
  let db;
  const originalTransaction = prisma.$transaction;
  try {
    // A blocking advisory-lock SELECT holds a snapshot which can deadlock another
    // schema's CREATE INDEX CONCURRENTLY. Poll without an open transaction instead.
    const lockDeadline = Date.now() + 45000;
    while (!(await client.query("SELECT pg_try_advisory_lock(1312902726, 1) AS acquired")).rows[0].acquired) {
      if (Date.now() > lockDeadline) throw new Error("Timed out waiting for isolated migration tests");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await client.query(`CREATE SCHEMA "${schema}"`);
    await promisify(execFile)(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 20000,
    });
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema}`, max: 3 }, { schema }) });
    prisma.$transaction = db.$transaction.bind(db);
    const actor = await db.user.create({ data: { name: "Manager", email: `${schema}@example.test`, role: "RUKOVODILAC" } });
    const worker = await db.worker.create({ data: { name: "Worker" } });
    const parcel = await db.parcel.create({ data: { code: "p", name: "Parcel", areaHa: 10 } });
    const workType = await db.workType.create({ data: { name: "Work", fuelNormLitersPerHa: 5 } });
    const x = await db.machine.create({ data: { name: "X", currentHours: 10, currentFuelLiters: 80, status: "ZADUZENA" } });
    const y = await db.machine.create({ data: { name: "Y", currentHours: 100, currentFuelLiters: 70 } });
    const z = await db.machine.create({ data: { name: "Z", currentHours: 200, currentFuelLiters: 60 } });
    const started = new Date(Date.now() - 4 * 3600000), switched = new Date(Date.now() - 2 * 3600000);
    const order = await db.workOrder.create({ data: { orderNumber: "TEST-1", orderDate: started, status: "U_TOKU",
      machineId: x.id, workerId: worker.id, parcelId: parcel.id, workTypeId: workType.id, issuedById: actor.id } });
    const first = await db.machineAssignment.create({ data: { machineId: x.id, workerId: worker.id, parcelId: parcel.id,
      workOrderId: order.id, assignedAt: started, startHours: 10, startFuelLiters: 80, status: "ZADUZENA", createdById: actor.id,
      machineStateBefore: { currentHours: 10, currentFuelLiters: 80 } } });
    const req = { user: actor, worker, workerResolved: true, headers: {}, method: "POST" };
    const request = async (router, path, body) => {
      let response;
      const stack = router.stack.find(l => l.route?.path === path && l.route.methods.post).route.stack;
      await stack.at(-1).handle({ ...req, url: path, body, params: {} }, {
        status(code) { this.code = code; return this; }, json(body) { response = { status: this.code || 200, body }; },
      });
      return response;
    };
    const context = await usageContext(db, "order", order.id, req);
    const replaced = await request(usageRouter, "/change", { contextType: "order", contextId: order.id, version: context.version,
      mode: "REPLACE", sourceId: first.id, machineId: y.id, reason: "Stvarna zamena", expectedMachineUpdatedAt: y.updatedAt.toISOString(),
      startedAt: switched.toISOString(), startHours: 100, startFuelLiters: 70, previousEndHours: 12, previousEndFuelLiters: 60,
      previousAreaDoneHa: 4, areaDoneHa: 6 });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    const currentY = await db.machine.findUnique({ where: { id: y.id } });
    const finished = await request(fieldRouter, "/", { workOrderId: order.id, workerId: worker.id, machineId: y.id, parcelId: parcel.id,
      workTypeId: workType.id, areaDoneHa: 10, workHours: 4, endHours: 103, endFuelLiters: 40,
      expectedMachineUpdatedAt: currentY.updatedAt.toISOString() });
    assert.equal(finished.status, 201, JSON.stringify(finished.body));
    assert.equal((await db.workOrder.findUnique({ where: { id: order.id } })).status, "ZAVRSEN");
    assert.equal(await db.machineAssignment.count({ where: { workOrderId: order.id, status: "ZADUZENA" } }), 0);
    let totals = await usageGroupBy(db, { by: ["machineId"], _sum: { areaDoneHa: true, workHours: true } });
    assert.equal(totals.reduce((n, r) => n + r._sum.areaDoneHa, 0), 10);
    assert.equal(totals.find(r => r.machineId === x.id)._sum.workHours, 2);
    assert.equal(totals.find(r => r.machineId === y.id)._sum.workHours, 3);
    const fuel = (await db.$queryRaw(fuelEfficiencySql(fuelEfficiencyQuery.parse({})) ))[0];
    assert.ok(fuel);
    // Finished correction removes X's usage from totals without re-opening the work.
    const c = await usageContext(db, "work", finished.body.work.id, req);
    const corrected = await request(usageRouter, "/change", { contextType: "work", contextId: c.work.id, version: c.version,
      mode: "CORRECT", sourceId: first.id, machineId: z.id, reason: "Pogresan izbor prve masine", expectedMachineUpdatedAt: z.updatedAt.toISOString(),
      startedAt: started.toISOString(), endedAt: switched.toISOString(), startHours: 200, endHours: 202,
      startFuelLiters: 60, endFuelLiters: 40, areaDoneHa: 4 });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    totals = await usageGroupBy(db, { by: ["machineId"], _sum: { areaDoneHa: true, workHours: true } });
    assert.equal(totals.length, 2); assert.ok(totals.every(r => r.machineId !== x.id));
    assert.equal(totals.reduce((n, r) => n + r._sum.areaDoneHa, 0), 10);
    assert.equal((await db.fieldWork.findUnique({ where: { id: c.work.id } })).workHours, 4);
    assert.equal(await db.machineAssignment.count({ where: { status: "ZADUZENA" } }), 0);
    assert.equal(await db.machineAssignment.count({ where: { status: "PONISTENA" } }), 1);
    assert.ok(await db.auditLog.count() >= 3);
  } finally {
    prisma.$transaction = originalTransaction;
    if (db) await db.$disconnect();
    try { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await client.end(); }
  }
});

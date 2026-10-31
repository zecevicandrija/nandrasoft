import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import seasonalRouter from "../routes/seasonalWorkers.js";

function request(router, method, url, body = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      body,
      headers,
      query: {},
      user: null,
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: this.statusCode, data });
      },
    };
    router.handle(req, res, (error) => reject(error || new Error("Unhandled request")));
  });
}

test("seasonal group logging uses batch insert (createManyAndReturn)", async (t) => {
  const supervisor = { id: "u-poslovodja", role: "RUKOVODILAC", isActive: true, name: "Poslovođa Milan" };
  mock.method(auth.api, "getSession", async () => ({ user: supervisor, session: {} }));

  const workers = [
    { id: "sw-1", name: "Jovan Petrović", dailyWage: 3000, groupName: "Grupa A" },
    { id: "sw-2", name: "Dragan Nikolić", dailyWage: 3200, groupName: "Grupa A" },
    { id: "sw-3", name: "Zoran Simić", dailyWage: 3500, groupName: "Grupa A" },
  ];

  let batchCalledWith = null;
  let auditBatchCalledWith = null;

  const originalWorkersFindMany = prisma.seasonalWorker.findMany;
  const originalCreateManyAndReturn = prisma.seasonalWorkLog.createManyAndReturn;
  const originalTx = prisma.$transaction;
  const originalExec = prisma.$executeRaw;
  const originalQuery = prisma.$queryRaw;
  const originalAuditCreateMany = prisma.auditLog.createMany;

  t.after(() => {
    prisma.seasonalWorker.findMany = originalWorkersFindMany;
    prisma.seasonalWorkLog.createManyAndReturn = originalCreateManyAndReturn;
    prisma.$transaction = originalTx;
    prisma.$executeRaw = originalExec;
    prisma.$queryRaw = originalQuery;
    prisma.auditLog.createMany = originalAuditCreateMany;
  });

  prisma.$transaction = async (callback) => {
    if (typeof callback === "function") return callback(prisma);
    return Promise.all(callback);
  };
  prisma.$executeRaw = async () => 1;
  prisma.$queryRaw = async () => [];
  prisma.seasonalWorker.findMany = async () => workers;

  prisma.seasonalWorkLog.createManyAndReturn = async ({ data }) => {
    batchCalledWith = data;
    return data.map((item, idx) => ({
      id: `log-batch-${idx + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...item,
    }));
  };

  prisma.auditLog.createMany = async ({ data }) => {
    auditBatchCalledWith = data;
    return { count: data.length };
  };

  const payload = {
    workerIds: ["sw-1", "sw-2", "sw-3"],
    parcelId: "parcel-10",
    jobDescription: "Sečenje peruške i klasiranje",
    date: "2026-10-31",
    startTime: "07:00",
    endTime: "15:00",
    breakMinutes: 30,
    dailyWage: 3500,
    groupName: "Ekipa 1",
    notes: "Odličan učinak",
  };

  const res = await request(seasonalRouter, "POST", "/logs/group", payload, {
    "x-mutation-key": "batch-test-key-1",
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.success, true);
  assert.equal(res.data.count, 3);
  assert.match(res.data.message, /3 radnika/);

  // 1. Verifikacija da je pozvan tačno jedan batch upis
  assert.ok(batchCalledWith !== null, "createManyAndReturn must be called");
  assert.equal(batchCalledWith.length, 3);
  assert.equal(batchCalledWith[0].seasonalWorkerId, "sw-1");
  assert.equal(batchCalledWith[1].seasonalWorkerId, "sw-2");
  assert.equal(batchCalledWith[2].seasonalWorkerId, "sw-3");
  assert.equal(batchCalledWith[0].hoursWorked, 7.5);
  assert.equal(batchCalledWith[0].dailyWageApplied, 3500);
  assert.equal(batchCalledWith[0].groupCount, 3);
  assert.equal(batchCalledWith[0].groupName, "Ekipa 1");
  assert.equal(batchCalledWith[0].supervisorId, "u-poslovodja");

  // 2. Verifikacija da je audit upisan u jednom batch-u sa ispravnim entityId
  assert.ok(auditBatchCalledWith !== null, "writeAuditBatch must be called");
  assert.equal(auditBatchCalledWith.length, 3);
  assert.equal(auditBatchCalledWith[0].entityId, "log-batch-1");
  assert.equal(auditBatchCalledWith[1].entityId, "log-batch-2");
  assert.equal(auditBatchCalledWith[2].entityId, "log-batch-3");
});

test("seasonal group logging falls back cleanly if createManyAndReturn is not present", async (t) => {
  const supervisor = { id: "u-poslovodja", role: "RUKOVODILAC", isActive: true, name: "Poslovođa Milan" };
  mock.method(auth.api, "getSession", async () => ({ user: supervisor, session: {} }));

  const workers = [{ id: "sw-1", name: "Jovan Petrović", dailyWage: 3000 }];
  let createSingleCount = 0;

  const originalWorkersFindMany = prisma.seasonalWorker.findMany;
  const originalCreateManyAndReturn = prisma.seasonalWorkLog.createManyAndReturn;
  const originalCreate = prisma.seasonalWorkLog.create;
  const originalTx = prisma.$transaction;
  const originalExec = prisma.$executeRaw;
  const originalQuery = prisma.$queryRaw;
  const originalAuditCreateMany = prisma.auditLog.createMany;

  t.after(() => {
    prisma.seasonalWorker.findMany = originalWorkersFindMany;
    prisma.seasonalWorkLog.createManyAndReturn = originalCreateManyAndReturn;
    prisma.seasonalWorkLog.create = originalCreate;
    prisma.$transaction = originalTx;
    prisma.$executeRaw = originalExec;
    prisma.$queryRaw = originalQuery;
    prisma.auditLog.createMany = originalAuditCreateMany;
  });

  // Simuliramo odsustvo createManyAndReturn
  delete prisma.seasonalWorkLog.createManyAndReturn;

  prisma.$transaction = async (operations) => {
    if (typeof operations === "function") return operations(prisma);
    return Promise.all(operations);
  };
  prisma.$executeRaw = async () => 1;
  prisma.$queryRaw = async () => [];
  prisma.seasonalWorker.findMany = async () => workers;

  prisma.seasonalWorkLog.create = async ({ data }) => {
    createSingleCount++;
    return {
      id: `log-single-${createSingleCount}`,
      ...data,
    };
  };

  prisma.auditLog.createMany = async () => ({ count: 1 });

  const payload = {
    workerIds: ["sw-1"],
    jobDescription: "Fallback test posao",
    hoursWorked: 8,
  };

  const res = await request(seasonalRouter, "POST", "/logs/group", payload, {
    "x-mutation-key": "fallback-test-key-1",
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.count, 1);
  assert.equal(createSingleCount, 1, "Fallback executed single create");
});


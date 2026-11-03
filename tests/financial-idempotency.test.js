import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import fuel from "../routes/fuel.js";
import seasonal from "../routes/seasonalWorkers.js";

function request(router, path, body, key, method = "POST") {
  return new Promise((resolve, reject) => router.handle({
    method, url: path, baseUrl: router === fuel ? "/api/fuel" : "/api/seasonal",
    body, query: {}, headers: key === undefined ? {} : { "idempotency-key": key },
  }, {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, data: JSON.parse(JSON.stringify(data)) }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("fuel and seasonal controllers commit each request key only once", async (t) => {
  let user = { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true };
  const session = mock.method(auth.api, "getSession", async () => user ? { user, session: {} } : null);
  const logging = mock.method(console, "error", () => {});
  const original = prisma.$transaction;
  const originalLogs = prisma.seasonalWorkLog;
  let state, failure, tail = Promise.resolve(), workerReads = 0;
  const workers = [{ id: "a", hourlyRate: 375 }, { id: "b", hourlyRate: 500 }];
  const reset = () => {
    user = { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true };
    state = { logs: [], entries: [], receipts: [], audit: [], machine: {
      id: "machine", name: "Truck", type: "KAMION", currentFuelLiters: 0, tankCapacityLiters: 100,
    } };
    failure = null; workerReads = 0;
  };
  prisma.seasonalWorkLog = {
    async findUnique({ where }) { return structuredClone(state.logs.find((row) => row.id === where.id) || null); },
    async update({ where, data }) {
      const row = state.logs.find((row) => row.id === where.id);
      Object.assign(row, data); return row;
    },
  };
  prisma.$transaction = async (callback) => {
    const previous = tail;
    let unlock;
    tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const before = structuredClone(state);
    const tx = {
      async $queryRaw(strings, userId, key) {
        return state.receipts.filter((row) => row.userId === userId && row.key === key);
      },
      async $executeRaw(strings, ...values) {
        if (strings.join("").includes('INSERT INTO "mutation_receipt"')) {
          if (failure === "receipt") throw new Error("Receipt failure");
          const [userId, key, route, fingerprint, statusCode, response] = values;
          state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
        }
        return 1;
      },
      seasonalWorker: {
        async findMany() { workerReads++; return workers; },
        async findUnique({ where }) { workerReads++; return workers.find((worker) => worker.id === where.id); },
      },
      seasonalWorkLog: {
        ...prisma.seasonalWorkLog,
        async create({ data }) {
          if (failure === "second-worker" && data.seasonalWorkerId === "b") throw new Error("Worker write failure");
          const row = { id: `log-${state.logs.length}`, ...data };
          state.logs.push(row); return row;
        },
        async createManyAndReturn({ data }) {
          if (failure === "second-worker" && data.some((d) => d.seasonalWorkerId === "b")) {
            throw new Error("Worker write failure");
          }
          return data.map((d) => {
            const row = { id: `log-${state.logs.length}`, ...d };
            state.logs.push(row);
            return row;
          });
        },
      },
      machine: {
        async findUnique() { return structuredClone(state.machine); },
        async update({ data }) {
          for (const [key, value] of Object.entries(data)) state.machine[key] = value && typeof value === "object" && "increment" in value
            ? state.machine[key] + value.increment : value;
          return state.machine;
        },
      },
      worker: { async findUnique() { return { id: "worker", isActive: true }; } },
      fieldWork: { async findFirst() { return null; } },
      fuelEntry: { async create({ data }) {
        const row = { id: `fuel-${state.entries.length}`, ...data };
        state.entries.push(row); return structuredClone(row);
      } },
      auditLog: { async createMany({ data }) {
        if (failure === "audit") throw new Error("Audit failure");
        state.audit.push(...data); return { count: data.length };
      }, async create({ data }) {
        if (failure === "audit") throw new Error("Audit failure");
        state.audit.push(data); return data;
      } },
    };
    try {
      const result = await callback(tx);
      if (failure === "commit") throw new Error("Commit failure");
      return result;
    } catch (error) { state = before; throw error; }
    finally { unlock(); }
  };
  const group = { workerIds: ["a", "b"], jobDescription: "Harvest", date: "2026-10-31", hoursWorked: 8 };
  const entry = { workerId: "worker", machineId: "machine", fuelSource: "PUMPA", gasStation: "PETROL", liters: 15, totalCost: 3000 };
  try {
    await t.test("single and group logs reject negative, zero, non-finite or coerced hours and wages before any write", async () => {
      for (const [path, base, wageField] of [
        ["/logs", { seasonalWorkerId: "a", jobDescription: "Harvest", hoursWorked: 8 }, "hourlyRateApplied"],
        ["/logs/group", group, "hourlyRate"],
      ]) {
        for (const field of ["hoursWorked", wageField]) {
          for (const value of [-1, 0, NaN, Infinity, -Infinity, "abc", "Infinity", true, [], {}]) {
            reset(); const before = structuredClone(state);
            assert.equal((await request(seasonal, path, { ...base, [field]: value }, "invalid-key-123")).status, 400, `${path} ${field}: ${String(value)}`);
            assert.deepEqual(state, before);
          }
        }
      }
    });
    await t.test("invalid times, negative pauses and computed zero work are rejected", async () => {
      for (const values of [
        { startTime: "25:00", endTime: "15:00" },
        { startTime: "07:99", endTime: "15:00" },
        { startTime: "07:00", endTime: "07:00" },
        { startTime: "07:00", endTime: "08:00", breakMinutes: 61 },
        { hoursWorked: 8, breakMinutes: -1 },
        { hoursWorked: 8, breakMinutes: 0.5 },
        { hoursWorked: 8, breakMinutes: Infinity },
        { hoursWorked: 25 },
      ]) {
        reset();
        assert.equal((await request(seasonal, "/logs", { seasonalWorkerId: "a", jobDescription: "Harvest", ...values })).status, 400);
        assert.equal(state.logs.length, 0);
      }
    });
    await t.test("numeric form strings and overnight shifts retain valid hours and wages", async () => {
      reset();
      const response = await request(seasonal, "/logs", {
        seasonalWorkerId: "a", jobDescription: "Harvest", startTime: "22:00", endTime: "06:00", breakMinutes: "30", hourlyRateApplied: "450.50",
      });
      assert.equal(response.status, 201);
      assert.equal(state.logs[0].hoursWorked, 7.5);
      assert.equal(state.logs[0].hourlyRateApplied, 450.5);
      assert.equal(state.logs[0].dailyWageApplied, 3378.75);
    });
    await t.test("a negative default wage in any selected worker rejects the whole group", async () => {
      reset(); const saved = workers[1].hourlyRate;
      try {
        workers[1].hourlyRate = -100;
        assert.equal((await request(seasonal, "/logs/group", group, "default-key-123")).status, 400);
        assert.equal(state.logs.length, 0);
        assert.equal(state.receipts.length, 0);
      } finally { workers[1].hourlyRate = saved; }
    });
    await t.test("editing cannot introduce invalid numbers; a note-only edit preserves existing hours and break", async () => {
      reset();
      state.logs.push({ id: "existing", seasonalWorkerId: "a", jobDescription: "Harvest", startTime: null, endTime: null, hoursWorked: 8, breakMinutes: 30, dailyWageApplied: 3000 });
      for (const field of ["hoursWorked", "hourlyRateApplied", "breakMinutes"]) {
        for (const value of [-1, Infinity, "abc"]) {
          const before = structuredClone(state);
          assert.equal((await request(seasonal, "/logs/existing", { [field]: value }, undefined, "PUT")).status, 400);
          assert.deepEqual(state, before);
        }
      }
      assert.equal((await request(seasonal, "/logs/existing", { notes: "Checked" }, undefined, "PUT")).status, 200);
      assert.equal(state.logs[0].hoursWorked, 8);
      assert.equal(state.logs[0].breakMinutes, 30);
    });
    await t.test("the seasonal worker catalogue also rejects invalid default wages", async () => {
      for (const hourlyRate of [-1, 0, Infinity]) {
        assert.equal((await request(seasonal, "/workers", { name: "Test Worker", hourlyRate })).status, 400);
      }
    });
    await t.test("parallel group submits and a lost-response retry create one set of wages", async () => {
      reset();
      const results = await Promise.all([request(seasonal, "/logs/group", group, "group-key-123"), request(seasonal, "/logs/group", group, "group-key-123")]);
      assert.equal(results[0].status, 201);
      assert.deepEqual(results[1], results[0]);
      assert.deepEqual(await request(seasonal, "/logs/group", group, "group-key-123"), results[0]);
      assert.equal(state.logs.length, 2);
      assert.equal(state.logs.reduce((sum, row) => sum + row.dailyWageApplied, 0), 7000);
      assert.equal(state.receipts.length, 1);
      assert.equal(workerReads, 1, "replay must not recompute wages or rerun the group");
      assert.equal(state.audit.length, 2);
      assert.deepEqual(state.audit.map((row) => row.entityId), state.logs.map((row) => row.id));
      assert.deepEqual(state.audit.map((row) => row.newValues.dailyWageApplied), [3000, 4000]);
      assert.equal(new Set(state.audit.map((row) => row.context.operationId)).size, 1);
      assert.ok(state.audit[0].context.operationId);
    });
    await t.test("single-worker logs use the same protection", async () => {
      reset();
      const body = { seasonalWorkerId: "a", jobDescription: "Harvest", hoursWorked: 8 };
      const first = await request(seasonal, "/logs", body, "single-key-123");
      assert.equal(first.status, 201);
      assert.deepEqual(await request(seasonal, "/logs", body, "single-key-123"), first);
      assert.equal(state.logs.length, 1);
    });
    await t.test("group override applies an hourly rate and preserves individual defaults", async () => {
      reset();
      assert.equal((await request(seasonal, "/logs/group", { ...group, hoursWorked: 7.5, hourlyRate: 450 })).status, 201);
      assert.deepEqual(state.logs.map((log) => [log.hourlyRateApplied, log.dailyWageApplied]), [[450, 3375], [450, 3375]]);
      assert.deepEqual(workers.map((worker) => worker.hourlyRate), [375, 500]);
    });
    await t.test("missing hourly rates reject a complete group without using old daily wages", async () => {
      reset(); const saved = workers[1].hourlyRate;
      try {
        workers[1].hourlyRate = null;
        workers[1].dailyWage = 4000;
        assert.equal((await request(seasonal, "/logs/group", group)).status, 400);
        assert.equal(state.logs.length, 0);
      } finally { workers[1].hourlyRate = saved; delete workers[1].dailyWage; }
    });
    await t.test("rate and time edits recompute earnings, while later default changes preserve agreed rates", async () => {
      reset();
      await request(seasonal, "/logs", { seasonalWorkerId: "a", jobDescription: "Harvest", hoursWorked: 8 });
      const id = state.logs[0].id;
      assert.equal((await request(seasonal, `/logs/${id}`, { hoursWorked: 6.5 }, undefined, "PUT")).status, 200);
      assert.equal(state.logs[0].dailyWageApplied, 2437.5);
      assert.equal((await request(seasonal, `/logs/${id}`, { hourlyRateApplied: 450 }, undefined, "PUT")).status, 200);
      assert.equal(state.logs[0].dailyWageApplied, 2925);
      const saved = workers[0].hourlyRate;
      try {
        workers[0].hourlyRate = 900;
        assert.equal((await request(seasonal, `/logs/${id}`, { notes: "Checked" }, undefined, "PUT")).status, 200);
        assert.equal(state.logs[0].hourlyRateApplied, 450);
        assert.equal(state.logs[0].dailyWageApplied, 2925);
      } finally { workers[0].hourlyRate = saved; }
    });
    await t.test("minute-based hours are not rounded before calculating earnings", async () => {
      reset();
      assert.equal((await request(seasonal, "/logs", { seasonalWorkerId: "a", jobDescription: "Harvest", startTime: "07:00", endTime: "15:20", hourlyRateApplied: 500 })).status, 201);
      assert.equal(state.logs[0].dailyWageApplied, 4166.67);
    });
    await t.test("both director and supervisor may change the applied rate; other roles cannot", async () => {
      reset();
      await request(seasonal, "/logs", { seasonalWorkerId: "a", jobDescription: "Harvest", hoursWorked: 8 });
      const id = state.logs[0].id;
      for (const role of ["DIREKTOR", "RUKOVODILAC"]) {
        user.role = role;
        assert.equal((await request(seasonal, `/logs/${id}`, { hourlyRateApplied: 550 }, undefined, "PUT")).status, 200);
      }
      for (const role of ["OPERATER", "MAGACIN", "MEHANICAR"]) {
        user.role = role;
        assert.equal((await request(seasonal, `/logs/${id}`, { hourlyRateApplied: 100 }, undefined, "PUT")).status, 403);
        assert.equal(state.logs[0].dailyWageApplied, 4400);
      }
    });
    await t.test("fuel replay returns its original result without changing cost, tank level or audit", async () => {
      reset(); state.machine.tankCapacityLiters = 20;
      const results = await Promise.all([request(fuel, "/entries", entry, "fuel-key-123"), request(fuel, "/entries", entry, "fuel-key-123")]);
      assert.equal(results[0].status, 201);
      assert.deepEqual(results[1], results[0]);
      assert.deepEqual(await request(fuel, "/entries", entry, "fuel-key-123"), results[0]);
      assert.equal(state.entries.length, 1);
      assert.equal(state.entries[0].totalCost, 3000);
      assert.equal(state.machine.currentFuelLiters, 15);
      assert.equal(state.audit.length, 1);
      assert.equal(state.audit[0].entityId, state.entries[0].id);
      assert.equal(state.receipts.length, 1);
    });
    await t.test("fuel uses decimal rounding and its audit points to the actual created entry", async () => {
      reset();
      const body = { ...entry, liters: 1, totalCost: null, pricePerLiter: 1.005 };
      assert.equal((await request(fuel, "/entries", body, "decimal-key-123")).status, 201);
      assert.equal(state.entries[0].totalCost, 1.01);
      assert.equal(state.audit[0].entityId, state.entries[0].id);
      assert.notEqual(state.audit[0].entityId, "new-entry");
    });
    await t.test("audit failure rolls back fuel and group wages together with their receipts", async () => {
      for (const [router, path, body] of [[fuel, "/entries", entry], [seasonal, "/logs/group", group]]) {
        reset(); failure = "audit"; const before = structuredClone(state);
        assert.equal((await request(router, path, body, "audit-key-123")).status, 500);
        assert.deepEqual(state, before);
      }
    });
    await t.test("changed payload or route returns 409; another user's key and intentional new entries remain independent", async () => {
      reset();
      assert.equal((await request(fuel, "/entries", entry, "shared-key-123")).status, 201);
      const changed = await request(fuel, "/entries", { ...entry, liters: 16 }, "shared-key-123");
      assert.equal(changed.status, 409);
      assert.equal(changed.data.code, "IDEMPOTENCY_MISMATCH");
      assert.equal((await request(seasonal, "/logs/group", group, "shared-key-123")).status, 409);
      assert.equal(state.logs.length, 0);
      assert.equal(state.entries.length, 1);
      user = { ...user, id: "other-manager" };
      assert.equal((await request(fuel, "/entries", entry, "shared-key-123")).status, 201);
      assert.equal((await request(fuel, "/entries", entry, "new-fuel-key-123")).status, 201);
      assert.equal(state.entries.length, 3);
    });
    await t.test("receipt or commit failure rolls back fuel and group writes; the same key can safely retry", async () => {
      for (const type of ["receipt", "commit"]) {
        for (const [router, path, body] of [[fuel, "/entries", entry], [seasonal, "/logs/group", group]]) {
          reset(); failure = type;
          const before = structuredClone(state);
          assert.equal((await request(router, path, body, "retry-key-123")).status, 500);
          assert.deepEqual(state, before);
          failure = null;
          assert.equal((await request(router, path, body, "retry-key-123")).status, 201);
          assert.equal(state.receipts.length, 1);
        }
      }
    });
    await t.test("a group cannot leave partial wages when a later worker fails", async () => {
      reset(); failure = "second-worker";
      assert.equal((await request(seasonal, "/logs/group", group, "partial-key-123")).status, 500);
      assert.equal(state.logs.length, 0);
      assert.equal(state.receipts.length, 0);
    });
    await t.test("authentication, key validation and business rejection precede committed receipts", async () => {
      reset(); user = null;
      assert.equal((await request(seasonal, "/logs/group", group, "auth-key-123")).status, 401);
      reset();
      assert.equal((await request(fuel, "/entries", entry, "bad")).status, 400);
      assert.equal((await request(seasonal, "/logs/group", { ...group, workerIds: [] }, "correct-key-123")).status, 400);
      assert.equal(state.receipts.length, 0);
      assert.equal((await request(seasonal, "/logs/group", group, "correct-key-123")).status, 201);
    });
  } finally {
    prisma.$transaction = original;
    prisma.seasonalWorkLog = originalLogs;
    session.mock.restore(); logging.mock.restore();
  }
});

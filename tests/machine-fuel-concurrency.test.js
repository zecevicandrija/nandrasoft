import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import fuel from "../routes/fuel.js";
import assignments from "../routes/assignments.js";
import fieldWork from "../routes/fieldWork.js";
import orders from "../routes/workOrders.js";
import master from "../routes/masterData.js";
import { inventoryMutation } from "../lib/inventoryTransaction.js";

const initialVersion = "2026-11-01T00:00:00.000Z";
const copy = (value) => structuredClone(value);
function request(router, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(body)) }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("fuel deltas and measured machine states coordinate across inventory domains", async (t) => {
  const originalTransaction = prisma.$transaction, originalWorker = prisma.worker.findUnique;
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  prisma.worker.findUnique = async () => ({ id: "worker", isActive: true });
  let state, failAudit, locks, onMachineLocked, lockFailure;
  const reset = () => {
    locks = new Map(); failAudit = false; onMachineLocked = null; lockFailure = false;
    state = {
      machine: { id: "m", name: "Tractor", type: "TRAKTOR", status: "ZADUZENA", currentHours: 10, currentFuelLiters: 50, tankCapacityLiters: 200, updatedAt: new Date(initialVersion) },
      assignment: { id: "a", workerId: "worker", machineId: "m", parcelId: "p", status: "ZADUZENA", startHours: 10 },
      order: { id: "o", workerId: "worker", machineId: "m", parcelId: "p", workTypeId: "type", attachmentId: null, status: "DODELJEN" },
      entries: [], works: [], audit: [], receipts: [], updates: [],
    };
  };
  prisma.$transaction = async (callback) => {
    const held = new Set(), releases = [];
    let snapshot;
    const acquire = async (key) => {
      if (held.has(key)) return;
      const previous = locks.get(key) || Promise.resolve();
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      locks.set(key, next);
      await previous;
      held.add(key); releases.push(release);
      if (key === "machine:m") {
        snapshot = copy(state);
        if (onMachineLocked) { const callback = onMachineLocked; onMachineLocked = null; await callback(); }
      }
    };
    const assertMachineLock = () => assert.ok(held.has("machine:m"), "machine state must be read and written under its row lock");
    const relation = (row, args) => {
      if (!row) return null;
      if (args.select?.machineId) return { machineId: row.machineId };
      if (args.include?.machine) { assertMachineLock(); return copy({ ...row, machine: state.machine }); }
      return copy(row);
    };
    const patch = (row, data) => {
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
      return copy(row);
    };
    const tx = {
      async $executeRaw(strings, ...values) {
        const sql = strings.join("");
        if (sql.includes('FROM "machine"')) {
          if (lockFailure) throw Object.assign(new Error("Lock timeout"), { code: "P2010", meta: { code: "55P03" } });
          await acquire(`machine:${values[0]}`);
        }
        else if (sql.includes("pg_advisory_xact_lock")) await acquire(`domain:${values.join(":")}`);
        else if (sql.includes('INSERT INTO "mutation_receipt"')) {
          const [userId, key, route, fingerprint, statusCode, response] = values;
          state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
        }
        return 1;
      },
      async $queryRaw(strings, userId, key) { return copy(state.receipts.filter((row) => row.userId === userId && row.key === key)); },
      machine: {
        async findUnique() { assertMachineLock(); return copy(state.machine); },
        async update({ data }) { assertMachineLock(); state.updates.push(copy(data)); return patch(state.machine, data); },
      },
      machineAssignment: {
        async findUnique(args) { return relation(state.assignment, args); },
        async findFirst({ where }) { return Object.entries(where).every(([key, value]) => state.assignment[key] === value) ? copy(state.assignment) : null; },
        async create({ data }) { state.assignment = { id: "new", ...data }; return copy(state.assignment); },
        async update({ data }) { return patch(state.assignment, data); },
      },
      workOrder: {
        async findUnique(args) { return relation(state.order, args); },
        async findFirst({ where }) {
          const matches = (row, filter) => Object.entries(filter).every(([key, value]) => key === "OR"
            ? value.some((part) => matches(row, part)) : value?.in ? value.in.includes(row[key]) : row[key] === value);
          return matches(state.order, where) ? copy(state.order) : null;
        },
        async update({ data }) { return patch(state.order, data); },
      },
      maintenanceIssue: { async findFirst() { return state.openIssue ?? null; }, async findMany() { return state.openIssue ? [state.openIssue] : []; } },
      worker: { async findUnique() { return { id: "worker", isActive: true }; } },
      parcel: { async findUnique() { return { id: "p", areaHa: 100, name: "Field" }; } },
      fieldWork: {
        async findFirst() { return null; },
        async create({ data }) { const row = { id: "work", ...data }; state.works.push(row); return copy(row); },
      },
      fuelEntry: {
        async findUnique(args) { return relation(state.entries.find((row) => row.id === args.where.id), args); },
        async create({ data }) { const row = { id: `entry-${state.entries.length}`, ...data }; state.entries.push(row); return copy(row); },
        async update({ where, data }) { return patch(state.entries.find((row) => row.id === where.id), data); },
        async delete({ where }) { state.entries = state.entries.filter((row) => row.id !== where.id); return {}; },
        async aggregate() { return { _sum: { liters: 0 } }; },
      },
      fuelSupply: { async aggregate() { return { _sum: { liters: 1000, totalCost: 200000 } }; } },
      auditLog: { async create({ data }) { if (failAudit) throw new Error("Audit failed"); state.audit.push(copy(data)); return data; } },
    };
    try { return await callback(tx); }
    catch (error) { if (snapshot) state = snapshot; throw error; }
    finally { for (const release of releases.reverse()) release(); }
  };
  const refill = (liters = 20, headers) => request(fuel, "POST", "/entries", { machineId: "m", workerId: "worker", liters, totalCost: 4000, fuelSource: "PUMPA", gasStation: "PETROL" }, headers);
  const checkin = (version = initialVersion, liters = 40, headers) => request(assignments, "POST", "/checkin", { assignmentId: "a", endHours: 12, endFuelLiters: liters, expectedMachineUpdatedAt: version }, headers);
  const raceWithFirstLock = async (firstOperation, secondOperation) => {
    let entered, release;
    const locked = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    onMachineLocked = async () => { entered(); await gate; };
    const first = firstOperation();
    await locked;
    const second = secondOperation();
    release();
    return Promise.all([first, second]);
  };
  try {
    await t.test("refill racing checkin either adds after measurement or rejects the stale measurement", async () => {
      for (const refillFirst of [false, true]) {
        reset();
        const results = await raceWithFirstLock(refillFirst ? refill : checkin, refillFirst ? checkin : refill);
        if (refillFirst) {
          assert.deepEqual(results.map((row) => row.status), [201, 409]);
          assert.equal(results[1].body.code, "MACHINE_STATE_CHANGED");
          assert.equal(state.machine.currentFuelLiters, 70);
          assert.equal(state.assignment.status, "ZADUZENA");
        } else {
          assert.deepEqual(results.map((row) => row.status), [200, 201]);
          assert.equal(state.machine.currentFuelLiters, 60);
          assert.equal(state.assignment.status, "RAZDUZENA");
        }
        assert.equal(state.entries.length, 1);
      }
    });
    await t.test("fuel correction and cancellation racing checkin preserve their exact delta", async () => {
      for (const method of ["PUT", "DELETE"]) for (const deltaFirst of [false, true]) {
        reset();
        state.entries.push({ id: "old", machineId: "m", workerId: "worker", date: new Date(), liters: 20, totalCost: 4000, pricePerLiter: 200, fuelSource: "PUMPA", gasStation: "PETROL" });
        const delta = method === "PUT" ? 10 : -20;
        const change = () => request(fuel, method, "/entries/old", method === "PUT" ? { liters: 30 } : {});
        const results = await raceWithFirstLock(deltaFirst ? change : checkin, deltaFirst ? checkin : change);
        assert.deepEqual(results.map((row) => row.status), deltaFirst ? [200, 409] : [200, 200]);
        assert.equal(state.machine.currentFuelLiters, (deltaFirst ? 50 : 40) + delta);
      }
    });
    await t.test("field-work completion racing a refill cannot overwrite the added fuel", async () => {
      const complete = () => request(fieldWork, "POST", "/", { machineId: "m", parcelId: "p", workerId: "worker", workTypeId: "type", areaDoneHa: 1, endFuelLiters: 40, endHours: 12, expectedMachineUpdatedAt: initialVersion });
      for (const refillFirst of [false, true]) {
        reset();
        const results = await raceWithFirstLock(refillFirst ? refill : complete, refillFirst ? complete : refill);
        assert.deepEqual(results.map((row) => row.status), refillFirst ? [201, 409] : [201, 201]);
        assert.equal(state.machine.currentFuelLiters, refillFirst ? 70 : 60);
        assert.equal(state.works.length, refillFirst ? 0 : 1);
      }
    });
    await t.test("multiple updates within one millisecond retain distinct increasing versions", async () => {
      reset();
      const time = mock.method(Date, "now", () => Date.parse(initialVersion));
      try {
        await refill();
        const afterRefill = state.machine.updatedAt.toISOString();
        assert.equal((await checkin(afterRefill, 40)).status, 200);
        assert.ok(state.machine.updatedAt.getTime() > Date.parse(afterRefill));
        const before = copy(state);
        assert.equal((await request(master, "PUT", "/machines/m", { currentFuelLiters: 20, expectedMachineUpdatedAt: afterRefill })).status, 409);
        assert.deepEqual(state, before);
      } finally { time.mock.restore(); }
    });
    await t.test("archiving a free machine preserves history, is repeatable and can be reversed", async () => {
      reset(); state.machine.status = "SLOBODNA";
      state.assignment.status = "RAZDUZENA"; state.order.status = "ZAVRSEN";
      state.tolls = [{ id: "toll", machineId: "m", amount: 300 }];
      state.topUps = [{ id: "topup", machineId: "m", amount: 1000 }];
      const history = copy({ assignment: state.assignment, order: state.order, tolls: state.tolls, topUps: state.topUps });
      assert.equal((await request(master, "DELETE", "/machines/m", {})).status, 200);
      assert.equal(state.machine.isActive, false);
      assert.deepEqual({ assignment: state.assignment, order: state.order, tolls: state.tolls, topUps: state.topUps }, history);
      assert.equal(state.audit.at(-1).action, "DEAKTIVACIJA");
      const auditCount = state.audit.length;
      assert.equal((await request(master, "DELETE", "/machines/m", {})).status, 200);
      assert.equal(state.audit.length, auditCount);
      assert.equal((await request(master, "PUT", "/machines/m", { isActive: true })).status, 200);
      assert.equal(state.machine.isActive, true);
    });
    await t.test("open assignments, orders and repairs block DELETE and isActive=false bypasses", async () => {
      for (const blocker of ["assignment", "status", "order", "service"]) for (const method of ["PUT", "DELETE"]) {
        reset(); state.machine.status = "SLOBODNA"; state.machine.isActive = true;
        state.assignment.status = "RAZDUZENA"; state.order.status = "ZAVRSEN";
        if (blocker === "assignment") state.assignment.status = "ZADUZENA";
        if (blocker === "status") state.machine.status = "ZADUZENA";
        if (blocker === "order") state.order.status = "DODELJEN";
        if (blocker === "service") state.openIssue = { id: "issue", status: "OTVOREN" };
        const before = copy(state);
        assert.equal((await request(master, method, "/machines/m", { isActive: false })).status, 409);
        assert.deepEqual(state, before);
      }
    });
    await t.test("archived machines cannot be used for fresh assignments, work orders, work or fuel", async () => {
      for (const [router, path, body] of [
        [assignments, "/checkout", { machineId: "m", workerId: "worker", startFuelLiters: 0 }],
        [assignments, "/direct", { machineId: "m", workerId: "worker", startHours: 10, endHours: 12 }],
        [orders, "/", { machineId: "m", workerId: "worker", orderType: "OSTALO", orderDate: "2026-11-01" }],
        [orders, "/o/accept", { startFuelLiters: 0 }],
        [fieldWork, "/", { machineId: "m", workerId: "worker", parcelId: "p", workTypeId: "type", areaDoneHa: 1 }],
        [fuel, "/entries", { machineId: "m", workerId: "worker", liters: 20, totalCost: 4000, fuelSource: "PUMPA", gasStation: "PETROL" }],
      ]) {
        reset(); state.machine.isActive = false; state.machine.status = "SLOBODNA"; state.assignment.status = "RAZDUZENA";
        const before = copy(state);
        assert.equal((await request(router, "POST", path, body)).status, 409, path);
        assert.deepEqual(state, before);
      }
    });
    await t.test("archival racing checkout cannot leave a checked-out machine archived", async () => {
      const archive = () => request(master, "DELETE", "/machines/m", {});
      const checkout = () => request(assignments, "POST", "/checkout", { machineId: "m", workerId: "worker", startFuelLiters: 0, expectedMachineUpdatedAt: initialVersion });
      for (const archiveFirst of [false, true]) {
        reset(); state.machine.status = "SLOBODNA"; state.machine.isActive = true;
        state.assignment.status = "RAZDUZENA"; state.order.status = "ZAVRSEN";
        const results = await raceWithFirstLock(archiveFirst ? archive : checkout, archiveFirst ? checkout : archive);
        assert.deepEqual(results.map((row) => row.status), archiveFirst ? [200, 409] : [201, 409]);
        assert.equal(state.machine.isActive, !archiveFirst);
        assert.equal(state.assignment.status, archiveFirst ? "RAZDUZENA" : "ZADUZENA");
      }
    });
    await t.test("failure to audit machine archival restores its active state", async () => {
      reset(); state.machine.status = "SLOBODNA"; state.machine.isActive = true;
      state.assignment.status = "RAZDUZENA"; state.order.status = "ZAVRSEN";
      failAudit = true; const before = copy(state);
      assert.equal((await request(master, "DELETE", "/machines/m", {})).status, 500);
      assert.deepEqual(state, before);
    });
    await t.test("missing, invalid and stale versions cannot overwrite even an unchanged fuel value", async () => {
      for (const version of [undefined, null, "invalid", "2026-10-01T00:00:00.000Z"]) {
        reset(); const before = copy(state);
        const result = await request(assignments, "POST", "/checkin", { assignmentId: "a", endHours: 12, endFuelLiters: 50, expectedMachineUpdatedAt: version });
        assert.equal(result.status, 409);
        assert.deepEqual(state, before);
      }
    });
    await t.test("row-lock timeouts return retryable conflicts even when the controller catches the database error", async () => {
      reset(); lockFailure = true; const before = copy(state);
      const result = await refill();
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "INVENTORY_BUSY");
      assert.deepEqual(state, before);
    });
    await t.test("explicitly refreshed measurement succeeds and advances the timestamp", async () => {
      reset(); await refill();
      const version = state.machine.updatedAt.toISOString();
      assert.equal((await checkin(version, 65)).status, 200);
      assert.equal(state.machine.currentFuelLiters, 65);
      assert.ok(state.machine.updatedAt > new Date(version));
    });
    await t.test("two refills add atomically; capacity excess leaves no entry or partial delta", async () => {
      reset();
      assert.deepEqual((await Promise.all([refill(), refill()])).map((row) => row.status), [201, 201]);
      assert.equal(state.machine.currentFuelLiters, 90);
      assert.ok(state.updates.every((data) => data.currentFuelLiters.increment === 20));
      const before = copy(state);
      assert.equal((await refill(111)).status, 400);
      assert.deepEqual(state, before);
    });
    await t.test("an empty tank permits checkout and order acceptance, then refilling while assigned", async () => {
      for (const [router, path, expected] of [[assignments, "/checkout", 201], [orders, "/o/accept", 200]]) {
        reset();
        state.machine.status = "SLOBODNA";
        state.machine.currentFuelLiters = 0;
        state.assignment.status = "RAZDUZENA";
        const result = await request(router, "POST", path, {
          machineId: "m", workerId: "worker", startFuelLiters: 0,
          expectedMachineUpdatedAt: initialVersion,
        });
        assert.equal(result.status, expected, JSON.stringify(result));
        assert.equal(state.machine.status, "ZADUZENA");
        assert.equal(state.machine.currentFuelLiters, 0);
        assert.equal(state.assignment.startFuelLiters, 0);
        if (router === orders) assert.equal(state.order.status, "U_TOKU");
        assert.equal((await refill(50)).status, 201);
        assert.equal(state.machine.currentFuelLiters, 50);
        assert.equal(state.machine.status, "ZADUZENA");
        assert.equal(state.assignment.startFuelLiters, 0, "refill must preserve the historical starting measurement");
      }
    });
    await t.test("legacy null fuel initializes safely", async () => {
      reset(); state.machine.currentFuelLiters = null;
      assert.equal((await refill()).status, 201);
      assert.equal(state.machine.currentFuelLiters, 20);
    });
    await t.test("fuel edits and cancellation apply exact deltas and cannot silently clamp below zero", async () => {
      reset(); await refill();
      assert.equal((await request(fuel, "PUT", "/entries/entry-0", { liters: 30 })).status, 200);
      assert.equal(state.machine.currentFuelLiters, 80);
      assert.equal((await request(fuel, "DELETE", "/entries/entry-0", {})).status, 200);
      assert.equal(state.machine.currentFuelLiters, 50);
      reset(); await refill(); state.machine.currentFuelLiters = 5;
      const before = copy(state);
      assert.equal((await request(fuel, "PUT", "/entries/entry-0", { liters: 1 })).status, 400);
      assert.equal((await request(fuel, "DELETE", "/entries/entry-0", {})).status, 400);
      assert.deepEqual(state, before);
    });
    await t.test("editing a fuel note preserves a previously identified anomaly and its reason", async () => {
      reset(); await refill();
      state.entries[0].hasAnomaly = true;
      state.entries[0].anomalyReason = "Previously identified excessive consumption";
      assert.equal((await request(fuel, "PUT", "/entries/entry-0", { notes: "Receipt checked" })).status, 200);
      assert.equal(state.entries[0].hasAnomaly, true);
      assert.equal(state.entries[0].anomalyReason, "Previously identified excessive consumption");
      assert.equal(state.entries[0].notes, "Receipt checked");
      assert.equal(state.entries[0].liters, 20);
      assert.equal(state.machine.currentFuelLiters, 70);
    });
    await t.test("field work, checkout, direct assignment, acceptance and catalogue cannot bypass stale measurement protection", async () => {
      for (const [router, method, path, body] of [
        [fieldWork, "POST", "/", { machineId: "m", parcelId: "p", workerId: "worker", workTypeId: "type", areaDoneHa: 1, endFuelLiters: 30 }],
        [assignments, "POST", "/checkout", { machineId: "m", workerId: "worker", startFuelLiters: 30 }],
        [assignments, "POST", "/direct", { machineId: "m", workerId: "worker", startHours: 10, endHours: 12, endFuelLiters: 30 }],
        [orders, "POST", "/o/accept", { startFuelLiters: 30 }],
        [master, "PUT", "/machines/m", { currentFuelLiters: 30 }],
      ]) {
        reset(); state.machine.status = "SLOBODNA"; state.assignment.status = "RAZDUZENA";
        await refill(); const before = copy(state);
        const result = await request(router, method, path, { ...body, expectedMachineUpdatedAt: initialVersion });
        assert.equal(result.status, 409, path);
        assert.equal(result.body.code, "MACHINE_STATE_CHANGED", path);
        assert.deepEqual(state, before);
      }
    });
    await t.test("failed audit rolls back fuel delta and its version; rejected checkin has no partial writes", async () => {
      reset(); failAudit = true; const before = copy(state);
      assert.equal((await refill()).status, 500);
      assert.deepEqual(state, before);
    });
    await t.test("replaying a measured checkin and a refill returns original success despite changed versions", async () => {
      reset(); const headers = { "idempotency-key": "checkin-once" };
      const first = await checkin(initialVersion, 40, headers);
      assert.equal(first.status, 200);
      assert.deepEqual(await checkin(initialVersion, 40, headers), first);
      const fuelHeaders = { "idempotency-key": "refill-once" };
      const added = await refill(20, fuelHeaders);
      assert.equal(added.status, 201);
      assert.deepEqual(await refill(20, fuelHeaders), added);
      assert.equal(state.machine.currentFuelLiters, 60);
      assert.equal(state.entries.length, 1);
    });
  } finally {
    prisma.$transaction = originalTransaction; prisma.worker.findUnique = originalWorker;
    session.mock.restore(); logging.mock.restore();
  }
});

// Uses real row locks and real application transaction wrappers, but performs
// only SELECTs and SETs: no business data or schema is created/updated/deleted.
test("PostgreSQL row locks coordinate fuel and machine domains without blocking another machine", {
  skip: process.env.TEST_FUEL_LOCK_DB !== "1", timeout: 20000,
}, async () => {
  const machines = await prisma.machine.findMany({ select: { id: true }, take: 2, orderBy: { id: "asc" } });
  assert.equal(machines.length, 2, "read-only integration test needs two existing machines");
  let release, entered, attempted, secondRead = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const trying = new Promise((resolve) => { attempted = resolve; });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  const firstResponse = response(), secondResponse = response(), otherResponse = response();
  let firstPid;
  const first = inventoryMutation("fuel", async (req, res, tx) => {
    await tx.machine.findUnique({ where: { id: machines[0].id } });
    firstPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
    entered(); await gate; res.json({ ok: true });
  })({}, firstResponse);
  let second;
  try {
    await started;
    await inventoryMutation("machines", async (req, res, tx) => {
      await tx.machine.findUnique({ where: { id: machines[1].id } }); res.json({ ok: true });
    })({}, otherResponse);
    assert.equal(otherResponse.code, 200);
    second = inventoryMutation("machines", async (req, res, tx) => {
      attempted(); await tx.machine.findUnique({ where: { id: machines[0].id } });
      secondRead = true; res.json({ ok: true });
    })({}, secondResponse);
    await trying;
    let blocked = false;
    for (let i = 0; i < 50 && !blocked; i++) {
      const rows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE ${firstPid}::integer = ANY(pg_blocking_pids(pid))`;
      blocked = rows[0].count > 0;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true);
    assert.equal(secondRead, false);
  } finally { release(); await first; if (second) await second; }
  assert.equal(firstResponse.code, 200);
  assert.equal(secondResponse.code, 200);
  assert.equal(secondRead, true);
});

test.after(async () => { await prisma.$disconnect(); });

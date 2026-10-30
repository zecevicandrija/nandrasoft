import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import assignments from "../routes/assignments.js";
import orders from "../routes/workOrders.js";
import { isActiveAssignmentConflict } from "../lib/assignmentConflict.js";

function request(router, url, body) {
  return new Promise((resolve, reject) => router.handle({ method: "POST", url, body, headers: {}, query: {} }, {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("only active-assignment unique violations are classified as checkout conflicts", () => {
  assert.equal(isActiveAssignmentConflict({ code: "P2002", meta: { modelName: "MachineAssignment", target: ["machineId"] } }), true);
  assert.equal(isActiveAssignmentConflict({ code: "P2002", meta: { target: "machine_assignment_one_active_per_machine" } }), true);
  for (const error of [null, { code: "P2025" }, { code: "P2002" },
    { code: "P2002", meta: { target: ["id"] } },
    { code: "P2002", meta: { modelName: "OtherModel", target: ["machineId"] } }]) {
    assert.equal(isActiveAssignmentConflict(error), false);
  }
});

test("concurrent checkouts return one success and one conflict under the shared machine lock", async (t) => {
  const originals = Object.fromEntries(["maintenanceIssue", "$executeRaw", "worker", "machine", "machineAssignment", "workOrder", "auditLog", "$transaction"].map((key) => [key, prisma[key]]));
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let state, tail, failure, locked;
  const reset = () => {
    state = { assignments: [], machine: { id: "machine", name: "Tractor", status: "SLOBODNA", currentHours: 10, currentFuelLiters: 0, tankCapacityLiters: 200 },
      orders: { a: "DODELJEN", b: "DODELJEN" }, audit: [] };
    tail = Promise.resolve(); failure = null; locked = false;
  };
  // Prisma transaction-array operations are lazy: writes start inside $transaction.
  const lazy = (run) => ({ then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); } });
  prisma.$executeRaw = async () => { locked = true; return 1; };
  prisma.maintenanceIssue = { async findFirst() { return null; }, async findMany() { return []; } };
  prisma.worker = { async findUnique() { return { id: "worker", isActive: true }; } };
  prisma.machine = {
    async findUnique() { return structuredClone(state.machine); },
    update: ({ data }) => lazy(() => Object.assign(state.machine, data)),
  };
  prisma.machineAssignment = {
    async findFirst() {
      assert.equal(locked, true);
      return state.assignments.find((row) => row.status === "ZADUZENA") || null;
    },
    create: ({ data }) => lazy(() => {
      if (failure) throw failure;
      if (state.assignments.some((row) => row.machineId === data.machineId && row.status === "ZADUZENA")) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002", meta: { modelName: "MachineAssignment", target: ["machineId"] } });
      }
      const row = { id: `assignment-${state.assignments.length}`, ...data };
      state.assignments.push(row);
      return row;
    }),
  };
  prisma.workOrder = {
    async findFirst() { return null; },
    async findUnique({ where }) { return { id: where.id, orderNumber: where.id, workerId: "worker", machineId: "machine", status: state.orders[where.id], machine: structuredClone(state.machine) }; },
    update: ({ where, data }) => lazy(() => { state.orders[where.id] = data.status; return { id: where.id, ...data }; }),
  };
  prisma.auditLog = { async create({ data }) { state.audit.push(data); return data; } };
  prisma.$transaction = async (operations) => {
    const previous = tail;
    let unlock;
    tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone(state);
    try {
      if (typeof operations === "function") return await operations(prisma);
      const results = [];
      for (const operation of operations) results.push(await operation);
      return results;
    } catch (error) {
      // All state, including audit, belongs to the outer transaction.
      state = snapshot;
      throw error;
    }
    finally { locked = false; unlock(); }
  };
  const checkout = () => request(assignments, "/checkout", { machineId: "machine", workerId: "worker", startFuelLiters: 20 });
  const accept = (id) => request(orders, `/${id}/accept`, { startFuelLiters: 30 });
  try {
    for (const [name, requests, expectedOrders] of [
      ["two direct checkouts", () => [checkout(), checkout()], 0],
      ["two work orders", () => [accept("a"), accept("b")], 1],
      ["direct checkout racing work-order acceptance", () => [checkout(), accept("a")], null],
    ]) {
      await t.test(name, async () => {
        reset();
        const results = await Promise.all(requests());
        assert.equal(results.filter((r) => r.status === 200 || r.status === 201).length, 1);
        assert.equal(results.filter((r) => r.status === 409).length, 1);
        assert.equal(state.assignments.length, 1);
        assert.equal(state.machine.status, "ZADUZENA");
        assert.equal(state.machine.currentFuelLiters, state.assignments[0].startFuelLiters);
        const accepted = Object.values(state.orders).filter((status) => status === "U_TOKU").length;
        assert.equal(accepted, expectedOrders ?? (state.assignments[0].workOrderId ? 1 : 0));
        assert.equal(state.audit.length, accepted);
      });
    }
    await t.test("unrelated write errors remain server errors and roll back", async () => {
      reset(); failure = Object.assign(new Error("Other unique constraint"), { code: "P2002", meta: { target: ["id"] } });
      const before = structuredClone(state);
      assert.equal((await checkout()).status, 500);
      assert.equal((await accept("a")).status, 500);
      assert.deepEqual(state, before);
    });
  } finally {
    session.mock.restore(); logging.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

test("PostgreSQL migration rejects duplicates and permits reassignment after return", { skip: process.env.TEST_ASSIGNMENT_DB !== "1" }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // A session-local shadow table keeps this test away from business records.
    await client.query('CREATE TEMP TABLE "machine_assignment" ("machineId" text NOT NULL, "status" text NOT NULL)');
    const sql = await readFile(new URL("../prisma/migrations/20261030120000_one_active_machine_assignment/migration.sql", import.meta.url), "utf8");
    await client.query(`INSERT INTO "machine_assignment" VALUES ('m', 'ZADUZENA'), ('m', 'ZADUZENA')`);
    await assert.rejects(client.query(sql), /Duplicate active machine assignments/);
    await client.query("ROLLBACK");
    assert.equal((await client.query('SELECT COUNT(*) FROM "machine_assignment"')).rows[0].count, "2");
    await client.query('TRUNCATE "machine_assignment"');
    await client.query(sql);
    await client.query(`INSERT INTO "machine_assignment" VALUES ('m', 'RAZDUZENA'), ('m', 'VRACENA_SA_KVAROM'), ('m', 'ZADUZENA'), ('other', 'ZADUZENA')`);
    await assert.rejects(client.query(`INSERT INTO "machine_assignment" VALUES ('m', 'ZADUZENA')`), { code: "23505" });
    await client.query(`UPDATE "machine_assignment" SET "status" = 'RAZDUZENA' WHERE "machineId" = 'm' AND "status" = 'ZADUZENA'`);
    await client.query(`INSERT INTO "machine_assignment" VALUES ('m', 'ZADUZENA')`);
  } finally { await client.end(); }
});

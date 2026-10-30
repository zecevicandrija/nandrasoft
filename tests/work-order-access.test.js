import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import ordersRouter from "../routes/workOrders.js";
import fieldRouter from "../routes/fieldWork.js";
import assignmentsRouter from "../routes/assignments.js";

function request(router, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers, query: {} }, {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, data }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("work orders enforce ownership and field-work consistency before mutations", async (t) => {
  let user = { id: "user-a", role: "OPERATER", isActive: true, name: "Worker A" };
  let state;
  let failOrderUpdate = false;
  let beforeTransaction = null;
  const originals = Object.fromEntries(["maintenanceIssue", "$queryRaw", "$executeRaw", "worker", "workOrder", "machine", "machineAssignment", "fieldWork", "parcel", "auditLog", "$transaction"].map((key) => [key, prisma[key]]));
  const sessionMock = mock.method(auth.api, "getSession", async () => ({ user, session: {} }));
  const logMock = mock.method(console, "error", () => {});
  const reset = () => {
    state = {
      orders: [
        { id: "own", workerId: "worker-a", machineId: "machine-a", parcelId: "parcel-a", workTypeId: "type-a", attachmentId: null, status: "DODELJEN", orderNumber: "RN-OWN" },
        { id: "other", workerId: "worker-b", machineId: "machine-b", parcelId: "parcel-b", workTypeId: "type-b", attachmentId: null, status: "DODELJEN", orderNumber: "RN-OTHER" },
      ],
      machines: ["machine-a", "machine-b"].map((id) => ({ id, name: id, status: "SLOBODNA", currentHours: 10, tankCapacityLiters: 200 })),
      assignments: [], works: [], audit: [], receipts: [],
    };
    failOrderUpdate = false;
    beforeTransaction = null;
  };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const update = (rows, { where, data }) => {
    const row = rows.find((candidate) => matches(candidate, where));
    if (!row) throw Object.assign(new Error("Stale record"), { code: "P2025" });
    Object.assign(row, data);
    return { ...row };
  };
  prisma.$queryRaw = async (strings, userId, key) => state.receipts.filter((row) => row.userId === userId && row.key === key);
  prisma.$executeRaw = async (strings, ...values) => {
    if (strings.join("").includes("INSERT INTO")) {
      const [userId, key, route, fingerprint, statusCode, response] = values;
      state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
    }
    return 1;
  };
  prisma.maintenanceIssue = { async findFirst() { return null; }, async findMany() { return []; } };
  prisma.worker = { async findUnique({ where }) {
    return { id: where.id || "worker-a", userId: "user-a", isActive: true };
  } };
  prisma.workOrder = {
    async findFirst() { return null; },
    async findUnique({ where }) {
      const row = state.orders.find((order) => order.id === where.id);
      return row ? { ...row, machine: state.machines.find((machine) => machine.id === row.machineId) } : null;
    },
    async update(args) {
      if (failOrderUpdate) throw new Error("Simulated order write failure");
      return update(state.orders, args);
    },
  };
  prisma.machine = {
    async findUnique({ where }) { return { ...state.machines.find((row) => row.id === where.id) }; },
    async update(args) { return update(state.machines, args); },
  };
  prisma.machineAssignment = {
    async findFirst({ where }) {
      const row = state.assignments.find((row) => matches(row, where));
      return row ? { ...row } : null;
    },
    async findUnique({ where }) {
      const row = state.assignments.find((entry) => entry.id === where.id);
      return row ? { ...row, machine: state.machines.find((machine) => machine.id === row.machineId) } : null;
    },
    async create({ data }) {
      const row = { id: `assignment-${state.assignments.length}`, ...data };
      state.assignments.push(row);
      return row;
    },
    async update(args) { return update(state.assignments, args); },
  };
  prisma.fieldWork = { async create({ data }) {
    const work = { id: `work-${state.works.length}`, ...data };
    state.works.push(work);
    return work;
  } };
  prisma.parcel = { async findUnique({ where }) { return { id: where.id, name: where.id, areaHa: 100 }; } };
  prisma.auditLog = { async create({ data }) { state.audit.push(data); return data; } };
  prisma.$transaction = async (operations) => {
    if (Array.isArray(operations)) return Promise.all(operations);
    if (beforeTransaction) { beforeTransaction(); beforeTransaction = null; }
    const snapshot = structuredClone(state);
    try { return await operations(prisma); } catch (error) { state = snapshot; throw error; }
  };
  const workBody = { workOrderId: "own", machineId: "machine-a", parcelId: "parcel-a", workTypeId: "type-a", areaDoneHa: 1, status: "ZAVRSENO" };
  try {
    await t.test("each worker role is denied another worker's detail, acceptance and status endpoints", async () => {
      for (const role of ["OPERATER", "MEHANICAR", "MAGACIN"]) {
        reset();
        user.role = role;
        const before = structuredClone(state);
        assert.equal((await request(ordersRouter, "GET", "/other")).status, 403);
        assert.equal((await request(ordersRouter, "POST", "/other/accept", { startFuelLiters: 20 })).status, 403);
        assert.equal((await request(ordersRouter, "PATCH", "/other/status", { status: "U_TOKU" })).status, 403);
        assert.deepEqual(state, before);
        assert.equal((await request(ordersRouter, "GET", "/own")).status, 200);
        assert.equal((await request(ordersRouter, "PATCH", "/own/status", { status: "U_TOKU" })).status, 200);
      }
    });

    await t.test("worker can accept own machine and manual orders; repeat acceptance cannot create another assignment", async () => {
      reset(); user.role = "OPERATER";
      assert.equal((await request(ordersRouter, "POST", "/own/accept", { startFuelLiters: 20 })).status, 200);
      assert.equal(state.assignments.length, 1);
      assert.equal(state.assignments[0].workerId, "worker-a");
      assert.equal(state.orders[0].status, "U_TOKU");
      assert.equal((await request(ordersRouter, "POST", "/own/accept", { startFuelLiters: 20 })).status, 400);
      assert.equal(state.assignments.length, 1);
      reset(); state.orders[0].machineId = null;
      assert.equal((await request(ordersRouter, "POST", "/own/accept", { startFuelLiters: 0 })).status, 200);
      assert.equal(state.assignments.length, 0);
    });

    await t.test("acceptance cannot take over an existing machine assignment", async () => {
      reset();
      state.assignments.push({ id: "busy", machineId: "machine-a", workerId: "worker-b", status: "ZADUZENA" });
      const before = structuredClone(state);
      assert.equal((await request(ordersRouter, "POST", "/own/accept", { startFuelLiters: 20 })).status, 409);
      assert.deepEqual(state, before);
      assert.equal((await request(assignmentsRouter, "POST", "/checkin", { assignmentId: "busy", endHours: 12 })).status, 403);
      assert.deepEqual(state, before);
    });

    await t.test("managers and directors retain access to other workers' orders", async () => {
      for (const role of ["DIREKTOR", "RUKOVODILAC"]) {
        reset(); user.role = role;
        assert.equal((await request(ordersRouter, "GET", "/other")).status, 200);
        assert.equal((await request(ordersRouter, "POST", "/other/accept", { startFuelLiters: 20 })).status, 200);
        assert.equal((await request(ordersRouter, "PATCH", "/other/status", { status: "ZAVRSEN" })).status, 200);
      }
    });

    await t.test("forged order IDs and mismatched worker, machine, parcel, operation or attachment cause no writes", async () => {
      user.role = "OPERATER";
      for (const [patch, expected] of [
        [{ workOrderId: "other" }, 403], [{ workOrderId: "missing" }, 404],
        [{ machineId: "machine-b" }, 400], [{ parcelId: "parcel-b" }, 400],
        [{ workTypeId: "type-b" }, 400], [{ attachmentId: "attachment-b" }, 400],
        [{ workerId: "worker-b" }, 403],
      ]) {
        reset(); const before = structuredClone(state);
        assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, ...patch })).status, expected);
        assert.deepEqual(state, before);
      }
      reset(); user.role = "DIREKTOR";
      const before = structuredClone(state);
      assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, workerId: "worker-b" })).status, 400);
      assert.deepEqual(state, before);
    });

    await t.test("an assignment for a different order cannot be closed through the submitted order", async () => {
      reset(); user.role = "OPERATER";
      state.assignments.push({ id: "busy", machineId: "machine-a", workerId: "worker-a", parcelId: "parcel-a", workOrderId: "other", status: "ZADUZENA" });
      const before = structuredClone(state);
      assert.equal((await request(fieldRouter, "POST", "/", workBody)).status, 403);
      assert.deepEqual(state, before);
    });

    await t.test("only finished work completes the matching order", async () => {
      reset(); user.role = "OPERATER";
      assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, status: "U_TOKU" })).status, 201);
      assert.equal(state.orders[0].status, "DODELJEN");
      reset();
      state.assignments.push({ id: "own-assignment", machineId: "machine-a", workerId: "worker-a", parcelId: "parcel-a", workOrderId: "own", status: "ZADUZENA", startHours: 10 });
      assert.equal((await request(fieldRouter, "POST", "/", workBody)).status, 201);
      assert.equal(state.orders[0].status, "ZAVRSEN");
      assert.equal(state.orders[0].fieldWorkId, state.works[0].id);
      assert.equal(state.orders[1].status, "DODELJEN");
      assert.equal(state.assignments[0].status, "RAZDUZENA");
      assert.equal(state.machines[0].status, "SLOBODNA");
    });

    await t.test("failed completion rolls back work and machine changes, and terminal orders are rejected", async () => {
      reset(); failOrderUpdate = true;
      const before = structuredClone(state);
      assert.equal((await request(fieldRouter, "POST", "/", workBody)).status, 500);
      assert.deepEqual(state, before);
      for (const status of ["ZAVRSEN", "OTKAZAN"]) {
        reset(); state.orders[0].status = status;
        const snapshot = structuredClone(state);
        assert.ok([403, 409].includes((await request(fieldRouter, "POST", "/", workBody)).status));
        assert.deepEqual(state, snapshot);
      }
    });

    await t.test("reassigned orders and changed machines are rechecked inside the write transaction", async () => {
      for (const concurrentChange of [
        () => { state.orders[0].workerId = "worker-b"; },
        () => { state.machines[0].status = "ZADUZENA"; },
      ]) {
        reset(); beforeTransaction = concurrentChange;
        assert.ok([403, 409].includes((await request(fieldRouter, "POST", "/", workBody)).status));
        assert.equal(state.works.length, 0);
        assert.equal(state.assignments.length, 0);
        assert.equal(state.orders[0].status, "DODELJEN");
      }
    });
    await t.test("replaying finished field work returns the original success after the order has already closed", async () => {
      reset(); user.role = "OPERATER";
      const headers = { "idempotency-key": "finish-order-once" };
      const first = await request(fieldRouter, "POST", "/", workBody, headers);
      assert.equal(first.status, 201);
      assert.equal(state.orders[0].status, "ZAVRSEN");
      const repeated = await request(fieldRouter, "POST", "/", workBody, headers);
      assert.deepEqual(JSON.parse(JSON.stringify(repeated)), JSON.parse(JSON.stringify(first)));
      assert.equal(state.works.length, 1);
      assert.equal(state.receipts.length, 1);
    });
    await t.test("replayed checkin returns success instead of an already-closed error", async () => {
      reset(); user.role = "OPERATER";
      state.assignments.push({ id: "own-assignment", machineId: "machine-a", workerId: "worker-a", status: "ZADUZENA", startHours: 10 });
      const body = { assignmentId: "own-assignment", endHours: 12 };
      const headers = { "idempotency-key": "return-machine-once" };
      const first = await request(assignmentsRouter, "POST", "/checkin", body, headers);
      assert.equal(first.status, 200);
      assert.deepEqual(JSON.parse(JSON.stringify(await request(assignmentsRouter, "POST", "/checkin", body, headers))), JSON.parse(JSON.stringify(first)));
      assert.equal(state.assignments[0].status, "RAZDUZENA");
      assert.equal(state.receipts.length, 1);
    });
  } finally {
    sessionMock.mock.restore(); logMock.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

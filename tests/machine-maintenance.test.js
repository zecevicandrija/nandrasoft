import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import assignments from "../routes/assignments.js";
import orders from "../routes/workOrders.js";
import maintenance from "../routes/maintenance.js";
import fieldWork from "../routes/fieldWork.js";
import masterData from "../routes/masterData.js";
import { machineMutation } from "../lib/machineAvailability.js";

function request(router, method, url, body) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers: {}, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("workshop and checkout lifecycle preserve machine availability", async (t) => {
  const keys = ["machine", "machineAssignment", "maintenanceIssue", "workOrder", "worker", "auditLog", "parcel", "$transaction", "$executeRaw"];
  const originals = Object.fromEntries(keys.map((key) => [key, prisma[key]]));
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let state, tail, locked, failAudit, failOrder;
  const reset = () => {
    state = { machine: { id: "m", name: "Tractor", status: "SLOBODNA", isActive: true, currentHours: 10, currentFuelLiters: 50, tankCapacityLiters: 200 },
      issues: [], orders: [], assignments: [], audit: [] };
    tail = Promise.resolve(); locked = false; failAudit = false; failOrder = false;
  };
  const matches = (row, where) => Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" ? (value.in ? value.in.includes(row[key]) : value.startsWith ? row[key]?.startsWith(value.startsWith) : false) : row[key] === value);
  const related = (row, model) => row ? structuredClone({ ...row, machine: state.machine,
    ...(model === "issues" ? { workOrder: state.orders.find((order) => order.maintenanceId === row.id) || null } : {}) }) : null;
  const delegate = (model) => ({
    async findUnique({ where }) { assert.equal(locked, true); return related(state[model].find((row) => matches(row, where)), model); },
    async findFirst({ where }) { assert.equal(locked, true); return related(state[model].find((row) => matches(row, where)), model); },
    async findMany({ where }) { assert.equal(locked, true); return state[model].filter((row) => matches(row, where)).map((row) => related(row, model)); },
    async create({ data }) {
      assert.equal(locked, true);
      if (model === "orders" && failOrder) throw new Error("Order creation failed");
      const row = { id: `${model}-${state[model].length}`, status: model === "issues" ? "OTVOREN" : "DODELJEN", ...data };
      state[model].push(row); return related(row, model);
    },
    async update({ where, data }) {
      assert.equal(locked, true);
      const row = state[model].find((row) => matches(row, where));
      if (!row) throw Object.assign(new Error("Stale record"), { code: "P2025" });
      Object.assign(row, data); return related(row, model);
    },
  });
  prisma.machine = {
    async findUnique() { assert.equal(locked, true); return structuredClone(state.machine); },
    async update({ data }) { assert.equal(locked, true); Object.assign(state.machine, data); return structuredClone(state.machine); },
  };
  prisma.worker = { async findUnique() { return { id: "w", isActive: true }; } };
  prisma.parcel = { async findUnique() { return { id: "p", name: "Field", areaHa: 10 }; } };
  prisma.machineAssignment = delegate("assignments");
  prisma.maintenanceIssue = delegate("issues");
  prisma.workOrder = delegate("orders");
  prisma.auditLog = { async create({ data }) { if (failAudit) throw new Error("Audit failed"); state.audit.push(data); return data; } };
  prisma.$executeRaw = async () => { locked = true; return 1; };
  prisma.$transaction = async (callback, options) => {
    assert.equal(typeof callback, "function");
    assert.equal(options.isolationLevel, "ReadCommitted");
    const previous = tail; let unlock;
    tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone(state);
    try { return await callback(prisma); }
    catch (error) { state = snapshot; throw error; }
    finally { locked = false; unlock(); }
  };
  const addIssue = (id, serviceType = "KVAR_NJIVA") => state.issues.push({ id, machineId: "m", serviceType, status: "OTVOREN", machine: state.machine });
  const addOrder = (id, orderType = "RAD_NJIVA", maintenanceId = null) => state.orders.push({ id, machineId: "m", workerId: "w", parcelId: "p", workTypeId: "type", status: "DODELJEN", orderNumber: id, orderType, maintenanceId });
  const checkout = () => request(assignments, "POST", "/checkout", { machineId: "m", workerId: "w" });
  const accept = (id = "o") => request(orders, "POST", `/${id}/accept`, { startFuelLiters: 20 });
  const resolve = (id) => request(maintenance, "POST", `/issues/${id}/resolve`, { repairNotes: "Repaired" });
  const cancel = (id) => request(maintenance, "PUT", `/issues/${id}/status`, { status: "OTKAZAN" });
  try {
    await t.test("broken/service machines and stale free status with an open issue or remont cannot be checked out", async () => {
      for (const blocker of ["U_KVARU", "SERVIS", "issue", "order"]) {
        reset(); addOrder("o");
        if (blocker === "issue") addIssue("i");
        else if (blocker === "order") addOrder("r", "REMONT_SERVIS");
        else state.machine.status = blocker;
        const before = structuredClone(state);
        assert.equal((await checkout()).status, 409);
        assert.equal((await accept()).status, 409);
        assert.deepEqual(state, before);
      }
    });
    await t.test("remont acceptance keeps service status and never changes fuel/hours or creates a checkout", async () => {
      reset(); addIssue("i", "GENERALNI_REMONT"); addOrder("o", "REMONT_SERVIS", "i"); state.machine.status = "SERVIS";
      assert.equal((await accept()).status, 200);
      assert.equal(state.orders[0].status, "U_TOKU");
      assert.equal(state.issues[0].status, "U_RADU");
      assert.equal(state.machine.status, "SERVIS");
      assert.equal(state.machine.currentFuelLiters, 50);
      assert.equal(state.machine.currentHours, 10);
      assert.equal(state.assignments.length, 0);
      assert.equal((await checkout()).status, 409);
    });
    await t.test("new remont blocks immediately, can be accepted without fuel, and stays blocked when waiting for parts or reopened", async () => {
      reset();
      const created = await request(maintenance, "POST", "/remont-order", { machineId: "m", workerId: "w", orderDate: "2026-10-30", instructions: "General repair" });
      assert.equal(created.status, 201);
      assert.equal(state.machine.status, "SERVIS");
      assert.equal((await checkout()).status, 409);
      const orderId = state.orders[0].id, issueId = state.issues[0].id;
      assert.equal((await request(orders, "POST", `/${orderId}/accept`, {})).status, 200);
      assert.equal((await request(maintenance, "PUT", `/issues/${issueId}/status`, { status: "CEKA_DELOVE" })).status, 200);
      assert.equal((await checkout()).status, 409);
      assert.equal((await resolve(issueId)).status, 200);
      assert.equal(state.machine.status, "SLOBODNA");
      assert.equal((await request(maintenance, "POST", `/issues/${issueId}/reopen`, {})).status, 200);
      assert.equal(state.machine.status, "SERVIS");
      assert.equal(state.orders[0].status, "U_TOKU");
      assert.equal((await checkout()).status, 409);
    });
    await t.test("closing or cancelling one issue keeps other issues and independent remont orders blocking", async () => {
      for (const close of [resolve, cancel]) {
        for (const remaining of ["issue", "order"]) {
          reset(); addIssue("i"); addOrder("o", "REMONT_SERVIS", "i");
          if (remaining === "issue") addIssue("other", "GENERALNI_REMONT");
          else addOrder("other", "REMONT_SERVIS");
          const result = await close("i");
          assert.equal(result.status, 200);
          assert.equal(state.machine.status, "SERVIS");
          if (close === resolve) assert.match(result.body.message, /SERVIS/);
          assert.equal((await checkout()).status, 409);
        }
      }
    });
    await t.test("last repair frees the machine; an outstanding operator checkout keeps it assigned", async () => {
      for (const assigned of [false, true]) {
        reset(); addIssue("i"); addOrder("o", "REMONT_SERVIS", "i");
        if (assigned) state.assignments.push({ id: "a", machineId: "m", workerId: "w", status: "ZADUZENA" });
        assert.equal((await resolve("i")).status, 200);
        assert.equal(state.orders[0].status, "ZAVRSEN");
        assert.equal(state.machine.status, assigned ? "ZADUZENA" : "SLOBODNA");
        assert.equal((await checkout()).status, assigned ? 409 : 201);
      }
    });
    await t.test("returned damaged machine stays unavailable while repaired, then becomes available", async () => {
      reset(); state.machine.status = "ZADUZENA";
      state.assignments.push({ id: "a", machineId: "m", workerId: "w", status: "ZADUZENA", startHours: 10 });
      assert.equal((await request(assignments, "POST", "/checkin", { assignmentId: "a", endHours: 12, isOperational: false })).status, 200);
      assert.equal(state.assignments[0].status, "VRACENA_SA_KVAROM");
      assert.equal(state.machine.status, "U_KVARU");
      const id = state.issues[0].id;
      assert.equal((await checkout()).status, 409);
      assert.equal((await request(maintenance, "PUT", `/issues/${id}/status`, { status: "U_RADU" })).status, 200);
      assert.equal(state.machine.status, "SERVIS");
      assert.equal((await checkout()).status, 409);
      assert.equal((await resolve(id)).status, 200);
      assert.equal((await checkout()).status, 201);
    });
    await t.test("normal checkin cannot free a machine with another open service", async () => {
      reset(); addIssue("i", "GENERALNI_REMONT"); state.machine.status = "SERVIS";
      state.assignments.push({ id: "a", machineId: "m", workerId: "w", status: "ZADUZENA", startHours: 10 });
      const result = await request(assignments, "POST", "/checkin", { assignmentId: "a", endHours: 12 });
      assert.equal(result.status, 200);
      assert.equal(state.machine.status, "SERVIS");
      assert.match(result.body.message, /SERVIS/);
    });
    await t.test("field-work order cannot bypass the workshop block", async () => {
      reset(); addIssue("i"); addOrder("o");
      const before = structuredClone(state);
      const result = await request(fieldWork, "POST", "/", { machineId: "m", workerId: "w", parcelId: "p", workTypeId: "type", workOrderId: "o", areaDoneHa: 1 });
      assert.equal(result.status, 409);
      assert.deepEqual(state, before);
    });
    await t.test("work-order cancellation and generic completion cannot prematurely free a serviced machine", async () => {
      reset(); addIssue("i"); addIssue("other", "GENERALNI_REMONT"); addOrder("o", "REMONT_SERVIS", "i");
      assert.equal((await request(orders, "PATCH", "/o/status", { status: "ZAVRSEN" })).status, 409);
      assert.equal((await request(orders, "PATCH", "/o/status", { status: "OTKAZAN" })).status, 200);
      assert.equal(state.machine.status, "SERVIS");
      assert.equal((await checkout()).status, 409);
    });
    await t.test("manual catalogue edits cannot mark an assigned or serviced machine free", async () => {
      for (const blocker of ["issue", "assignment"]) {
        reset();
        if (blocker === "issue") addIssue("i");
        else state.assignments.push({ id: "a", machineId: "m", status: "ZADUZENA" });
        const before = structuredClone(state);
        assert.equal((await request(masterData, "PUT", "/machines/m", { status: "SLOBODNA" })).status, 409);
        assert.deepEqual(state, before);
      }
    });
    await t.test("failed repair audit rolls back the issue, order and machine", async () => {
      reset(); addIssue("i"); addOrder("o", "REMONT_SERVIS", "i"); state.machine.status = "SERVIS";
      const before = structuredClone(state); failAudit = true;
      assert.equal((await resolve("i")).status, 500);
      assert.deepEqual(state, before);
    });
    await t.test("failed remont order creation leaves no orphan issue or changed machine", async () => {
      reset(); const before = structuredClone(state); failOrder = true;
      const result = await request(maintenance, "POST", "/remont-order", { machineId: "m", workerId: "w", orderDate: "2026-10-30", instructions: "General repair" });
      assert.equal(result.status, 500);
      assert.deepEqual(state, before);
    });
    await t.test("service creation racing checkout always leaves the machine unavailable", async () => {
      for (const serviceFirst of [false, true]) {
        reset();
        const service = () => request(maintenance, "POST", "/issues", { machineId: "m", title: "Repair", serviceType: "GENERALNI_REMONT" });
        const results = await Promise.all(serviceFirst ? [service(), checkout()] : [checkout(), service()]);
        assert.equal(results[serviceFirst ? 0 : 1].status, 201);
        assert.equal(state.machine.status, "SERVIS");
        assert.equal((await checkout()).status, 409);
      }
    });
  } finally {
    session.mock.restore(); logging.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

test("PostgreSQL serializes workshop and assignment mutations before their first read", { skip: process.env.TEST_ASSIGNMENT_DB !== "1" }, async () => {
  let release, entered, firstPid, secondEntered = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  const firstResponse = response(), secondResponse = response();
  const first = machineMutation(async (req, res, tx) => {
    firstPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
    entered(); await gate; res.json({ ok: true });
  })({}, firstResponse);
  let second;
  try {
    await started;
    second = machineMutation(async (req, res) => { secondEntered = true; res.json({ ok: true }); })({}, secondResponse);
    let waiting = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_locks
        WHERE locktype = 'advisory' AND classid = 1312902724 AND objid = 5 AND objsubid = 2
          AND NOT granted AND pid <> ${firstPid}`;
      if (rows[0].count > 0) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, "second transaction must wait on the real PostgreSQL lock");
    assert.equal(secondEntered, false);
  } finally {
    release(); await first; if (second) await second;
  }
  assert.equal(secondEntered, true);
  assert.equal(firstResponse.code, 200);
  assert.equal(secondResponse.code, 200);
});

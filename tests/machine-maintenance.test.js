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
import {
  backfillLegacyRemontOrders,
  previewLegacyRemontBackfill,
} from "../lib/remontBackfill.js";

function request(router, method, url, body) {
  body = { expectedMachineUpdatedAt: "2026-11-01T00:00:00.000Z", ...body };
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers: {}, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("workshop and checkout lifecycle preserve machine availability", async (t) => {
  const keys = ["workType", "machine", "machineAssignment", "maintenanceIssue", "workOrder", "worker", "auditLog", "parcel", "$transaction", "$executeRaw", "$queryRaw"];
  const originals = Object.fromEntries(keys.map((key) => [key, prisma[key]]));
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let state, tail, locked, failAudit, failOrder;
  const reset = () => {
    state = { machine: { id: "m", name: "Tractor", status: "SLOBODNA", isActive: true, currentHours: 10, currentFuelLiters: 50, tankCapacityLiters: 200, updatedAt: new Date("2026-11-01T00:00:00.000Z") },
      issues: [], orders: [], assignments: [], audit: [], counters: {} };
    tail = Promise.resolve(); locked = false; failAudit = false; failOrder = false;
  };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((cond) => matches(row, cond));
    if (key === "OR") return value.some((cond) => matches(row, cond));
    if (value === null) return row[key] == null;
    if (value && typeof value === "object") {
      if (value.in) return value.in.includes(row[key]);
      if (value.startsWith) return row[key]?.startsWith(value.startsWith);
      if (value.gte instanceof Date) return row[key] instanceof Date && row[key].getTime() >= value.gte.getTime();
      if ("not" in value) return value.not === null ? row[key] != null : row[key] !== value.not;
      return false;
    }
    return row[key] === value;
  });
  const related = (row, model) => row ? structuredClone({ ...row, machine: state.machine,
    ...(model === "issues" ? { workOrder: state.orders.find((order) => order.maintenanceId === row.id) || null }
      : model === "orders" ? { worker: { id: "w", name: "Worker" }, maintenance: state.issues.find((issue) => issue.id === row.maintenanceId) || null } : {}) }) : null;
  const delegate = (model) => ({
    async findUnique({ where }) { assert.equal(locked, true); return related(state[model].find((row) => matches(row, where)), model); },
    async findFirst({ where }) { assert.equal(locked, true); return related(state[model].find((row) => matches(row, where)), model); },
    async findMany({ where } = {}) { return state[model].filter((row) => matches(row, where)).map((row) => related(row, model)); },
    async count({ where } = {}) { return state[model].filter((row) => matches(row, where)).length; },
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
    async updateMany({ where, data }) {
      assert.equal(locked, true);
      let count = 0;
      for (const row of state[model]) {
        if (matches(row, where)) { Object.assign(row, data); count++; }
      }
      return { count };
    },
    async delete({ where }) {
      assert.equal(locked, true);
      const idx = state[model].findIndex((row) => matches(row, where));
      if (idx === -1) throw Object.assign(new Error("Missing record"), { code: "P2025" });
      const [removed] = state[model].splice(idx, 1);
      return related(removed, model);
    },
  });
  prisma.machine = {
    async findUnique() { assert.equal(locked, true); return structuredClone(state.machine); },
    async update({ data }) { assert.equal(locked, true); Object.assign(state.machine, data); return structuredClone(state.machine); },
  };
  prisma.worker = { async findUnique() { return { id: "w", isActive: true }; } };
  prisma.workType = { async findUnique() { return { materialKind: null, materialRequired: false }; } };
  prisma.parcel = { async findUnique() { return { id: "p", name: "Field", areaHa: 10 }; } };
  prisma.machineAssignment = delegate("assignments");
  prisma.maintenanceIssue = delegate("issues");
  prisma.workOrder = delegate("orders");
  prisma.$queryRaw = async (strings, prefix) => {
    assert.equal(locked, true);
    state.counters[prefix] = (state.counters[prefix] || 0n) + 1n;
    return [{ lastValue: state.counters[prefix] }];
  };
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
    await t.test("optional photos persist on orders, issues, and damaged checkin", async () => {
      const photoUrl = `https://${process.env.BUNNY_PULL_ZONE_HOSTNAME || 'nandra.b-cdn.net'}/fotografije/2026/11/foto_12345678-1234-1234-1234-123456789abc.jpg`;
      reset();
      assert.equal((await request(orders, "POST", "/", { workerId: "w", orderType: "OSTALO", orderDate: "2026-11-04", photoUrl })).status, 201);
      assert.equal(state.orders[0].photoUrl, photoUrl);
      reset();
      assert.equal((await request(maintenance, "POST", "/issues", { machineId: "m", title: "Curenje ulja", photoUrl })).status, 201);
      assert.equal(state.issues[0].photoUrl, photoUrl);
      reset();
      assert.equal((await request(maintenance, "POST", "/remont-order", { machineId: "m", workerId: "w", orderDate: "2026-11-04", instructions: "Provera", photoUrl })).status, 201);
      assert.equal(state.orders[0].photoUrl, photoUrl);
      assert.equal(state.issues[0].photoUrl, photoUrl);
      reset();
      state.assignments.push({ id: "a", machineId: "m", workerId: "w", status: "ZADUZENA", startHours: 10 });
      assert.equal((await request(assignments, "POST", "/checkin", { assignmentId: "a", endHours: 12, isOperational: false, photoUrl })).status, 200);
      assert.equal(state.assignments[0].photoUrl, photoUrl);
      assert.equal(state.issues[0].photoUrl, photoUrl);
    });
    await t.test("ordinary and workshop creation share one transactional RN counter past 9999", async () => {
      reset();
      const prefix = `RN-${new Date().getFullYear()}-`;
      state.counters[prefix] = 9999n;
      const results = await Promise.all([
        request(orders, "POST", "/", { workerId: "w", orderType: "OSTALO", orderDate: "2026-10-31" }),
        request(maintenance, "POST", "/remont-order", { machineId: "m", workerId: "w", orderDate: "2026-10-31", instructions: "General repair" }),
      ]);
      assert.deepEqual(results.map((result) => result.status), [201, 201]);
      assert.deepEqual(state.orders.map((order) => order.orderNumber).sort(), [`${prefix}10000`, `${prefix}10001`]);
      assert.equal(state.counters[prefix], 10001n);
    });
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
    await t.test("resolve rejects already resolved (POPRAVLJENO) and canceled (OTKAZAN) issues with 409", async () => {
      reset();
      addIssue("i");
      state.machine.status = "SERVIS";
      const pastRepairedAt = new Date("2026-05-15T10:00:00Z");

      // 1. First resolution succeeds
      const firstResolve = await request(maintenance, "POST", "/issues/i/resolve", {
        repairNotes: "Prva popravka",
        partsCost: 15000,
        laborCost: 5000,
      });
      assert.equal(firstResolve.status, 200);
      assert.equal(state.issues[0].status, "POPRAVLJENO");
      assert.equal(state.issues[0].partsCost, 15000);
      assert.equal(state.issues[0].totalCost, 20000);

      // Postavimo istorijski datum kako bismo proverili da li ostaje nepromenjen
      state.issues[0].repairedAt = pastRepairedAt;

      // 2. Second resolve on already resolved issue must return 409 Conflict
      const secondResolve = await request(maintenance, "POST", "/issues/i/resolve", {
        repairNotes: "Slučajan dupli klik bez troškova",
      });
      assert.equal(secondResolve.status, 409);
      assert.match(secondResolve.body.error, /već završen/);
      assert.deepEqual(state.issues[0].repairedAt, pastRepairedAt, "repairedAt must not be overwritten");
      assert.equal(state.issues[0].partsCost, 15000, "partsCost must not be reset to 0");
      assert.equal(state.issues[0].totalCost, 20000, "totalCost must not be reset to 0");

      // 3. Resolve on canceled issue must return 409 Conflict
      addIssue("canceled-issue");
      state.issues.find((x) => x.id === "canceled-issue").status = "OTKAZAN";
      const canceledResolve = await request(maintenance, "POST", "/issues/canceled-issue/resolve", {
        repairNotes: "Pokušaj rešavanja otkazanog",
      });
      assert.equal(canceledResolve.status, 409);
      assert.match(canceledResolve.body.error, /otkazan/);

      // 4. PUT /issues/:id/resolve on non-resolved issue returns 400
      addIssue("open-issue");
      const invalidPut = await request(maintenance, "PUT", "/issues/open-issue/resolve", {
        repairNotes: "Izmena pre završetka",
      });
      assert.equal(invalidPut.status, 400);

      // 5. POST /issues/:id/reopen on non-resolved issue returns 400
      const invalidReopen = await request(maintenance, "POST", "/issues/open-issue/reopen", {});
      assert.equal(invalidReopen.status, 400);
    });

    await t.test("work-order REMONT_SERVIS persists and updates serviceType, priority, and photo on MaintenanceIssue", async () => {
      const photoUrl = `https://${process.env.BUNNY_PULL_ZONE_HOSTNAME || 'nandra.b-cdn.net'}/fotografije/2026/11/foto_12345678-1234-1234-1234-123456789abc.jpg`;
      reset();
      const created = await request(orders, "POST", "/", {
        workerId: "w",
        machineId: "m",
        orderType: "REMONT_SERVIS",
        serviceType: "GENERALNI_REMONT",
        priority: "KRITICNA",
        orderDate: "2026-11-18",
        instructions: "Generalni remont menjača i zamena ulja",
        photoUrl,
      });
      assert.equal(created.status, 201);
      assert.equal(state.orders.length, 1);
      assert.equal(state.issues.length, 1);
      assert.equal(state.issues[0].serviceType, "GENERALNI_REMONT");
      assert.equal(state.issues[0].priority, "KRITICNA");
      assert.equal(state.issues[0].photoUrl, photoUrl);
      assert.equal(state.machine.status, "SERVIS");

      const orderId = state.orders[0].id;
      const updated = await request(orders, "PUT", `/${orderId}`, {
        serviceType: "KVAR_NJIVA",
        priority: "VISOKA",
        instructions: "Hitna intervencija na hidraulici",
      });
      assert.equal(updated.status, 200);
      assert.equal(state.issues[0].serviceType, "KVAR_NJIVA");
      assert.equal(state.issues[0].priority, "VISOKA");
      assert.equal(state.issues[0].description, "Hitna intervencija na hidraulici");
      assert.equal(state.machine.status, "U_KVARU");
    });

    await t.test("deleting a REMONT_SERVIS order cleans up its uncompleted issue and frees the machine, and issuer is recorded as reporter", async () => {
      const origWorkerFind = prisma.worker.findUnique;
      prisma.worker.findUnique = async ({ where }) => {
        if (where.userId === "manager") return { id: "manager-worker", isActive: true };
        return { id: where.id || "w", isActive: true };
      };
      try {
        reset();
        const created = await request(orders, "POST", "/", {
          workerId: "w",
          machineId: "m",
          orderType: "REMONT_SERVIS",
          serviceType: "REDOVAN_SERVIS",
          priority: "VISOKA",
          orderDate: "2026-11-18",
          instructions: "Test remont nalog",
        });
        assert.equal(created.status, 201);
        assert.equal(state.issues[0].reportedById, "manager-worker");
        assert.equal(state.issues[0].mechanicId, "w");
        assert.equal(state.machine.status, "SERVIS");

        const deleted = await request(orders, "DELETE", `/${state.orders[0].id}`, {});
        assert.equal(deleted.status, 200);
        assert.equal(state.orders.length, 0);
        assert.equal(state.issues.length, 0);
        assert.equal(state.machine.status, "SLOBODNA");

        // Resolved maintenance issue prevents permanent deletion
        reset();
        addIssue("resolved-issue", "REDOVAN_SERVIS");
        state.issues[0].status = "POPRAVLJENO";
        addOrder("done-order", "REMONT_SERVIS", "resolved-issue");
        const blocked = await request(orders, "DELETE", "/done-order", {});
        assert.equal(blocked.status, 409);
        assert.equal(state.orders.length, 1);
        assert.equal(state.issues.length, 1);

        // Manager without a linked Worker record can cancel an orphaned issue and permanently delete it
        prisma.worker.findUnique = async () => null;
        reset();
        addIssue("orphan-issue", "REDOVAN_SERVIS");
        state.machine.status = "SERVIS";
        assert.equal((await request(maintenance, "DELETE", "/issues/orphan-issue", {})).status, 409);
        const cancelled = await request(maintenance, "PUT", "/issues/orphan-issue/status", { status: "OTKAZAN" });
        assert.equal(cancelled.status, 200);
        assert.equal(state.issues[0].status, "OTKAZAN");
        assert.equal(state.machine.status, "SLOBODNA");
        assert.equal((await request(maintenance, "DELETE", "/issues/orphan-issue", {})).status, 200);
        assert.equal(state.issues.length, 0);

        // Deleting a cancelled issue with a linked WorkOrder deletes both
        reset();
        addIssue("linked-issue", "REDOVAN_SERVIS");
        state.issues[0].status = "OTKAZAN";
        addOrder("linked-order", "REMONT_SERVIS", "linked-issue");
        state.orders[0].status = "OTKAZAN";
        assert.equal((await request(maintenance, "DELETE", "/issues/linked-issue", {})).status, 200);
        assert.equal(state.issues.length, 0);
        assert.equal(state.orders.length, 0);
        assert.equal(state.machine.status, "SLOBODNA");
      } finally {
        prisma.worker.findUnique = origWorkerFind;
      }
    });

    await t.test("GET /issues scopes Tab 1 to direct reports and KVAR_NJIVA, keeping planned REMONT_SERVIS orders in Tab 2", async () => {
      const origFindMany = prisma.maintenanceIssue.findMany;
      const origCount = prisma.maintenanceIssue.count;
      let capturedWhere = null;
      prisma.maintenanceIssue.findMany = async ({ where }) => { capturedWhere = where; return []; };
      prisma.maintenanceIssue.count = async () => 0;
      try {
        const res = await request(maintenance, "GET", "/issues", {});
        assert.equal(res.status, 200);
        assert.deepEqual(capturedWhere, {
          AND: [
            { OR: [{ workOrder: { is: null } }, { serviceType: "KVAR_NJIVA" }] },
          ],
        });
      } finally {
        prisma.maintenanceIssue.findMany = origFindMany;
        prisma.maintenanceIssue.count = origCount;
      }
    });

    await t.test("workshop and general work-order creation produce identical machine statuses for KVAR_NJIVA and REDOVAN_SERVIS", async () => {
      for (const [serviceType, expectedStatus] of [
        ["KVAR_NJIVA", "U_KVARU"],
        ["REDOVAN_SERVIS", "SERVIS"],
        ["GENERALNI_REMONT", "SERVIS"],
      ]) {
        reset();
        const fromWorkshop = await request(maintenance, "POST", "/remont-order", {
          machineId: "m",
          workerId: "w",
          orderDate: "2026-11-19",
          serviceType,
          priority: "VISOKA",
          instructions: `Workshop ${serviceType}`,
        });
        assert.equal(fromWorkshop.status, 201);
        assert.equal(state.machine.status, expectedStatus);
        assert.equal(fromWorkshop.body.workOrder.machine.status, expectedStatus);
        assert.equal(state.issues[0].serviceType, serviceType);

        reset();
        const fromOrders = await request(orders, "POST", "/", {
          machineId: "m",
          workerId: "w",
          orderType: "REMONT_SERVIS",
          orderDate: "2026-11-19",
          serviceType,
          priority: "VISOKA",
          instructions: `Orders ${serviceType}`,
        });
        assert.equal(fromOrders.status, 201);
        assert.equal(state.machine.status, expectedStatus);
        assert.equal(fromOrders.body.workOrder.machine.status, expectedStatus);
        assert.equal(state.issues[0].serviceType, serviceType);
      }
    });

    await t.test("two concurrent interventions keep U_KVARU while an open KVAR_NJIVA exists and resolve to the right remaining status", async () => {
      // KVAR_NJIVA issued first, then REDOVAN_SERVIS from either entry point must NOT downgrade U_KVARU to SERVIS
      for (const issueSecond of [
        () => request(maintenance, "POST", "/remont-order", { machineId: "m", workerId: "w", orderDate: "2026-11-19", serviceType: "REDOVAN_SERVIS", instructions: "Redovan servis" }),
        () => request(orders, "POST", "/", { machineId: "m", workerId: "w", orderType: "REMONT_SERVIS", orderDate: "2026-11-19", serviceType: "REDOVAN_SERVIS", instructions: "Redovan servis" }),
        () => request(maintenance, "POST", "/issues", { machineId: "m", serviceType: "REDOVAN_SERVIS", title: "Direktan servis" }),
      ]) {
        reset();
        const breakdown = await request(maintenance, "POST", "/remont-order", {
          machineId: "m", workerId: "w", orderDate: "2026-11-19", serviceType: "KVAR_NJIVA", instructions: "Kvar na njivi",
        });
        assert.equal(breakdown.status, 201);
        assert.equal(state.machine.status, "U_KVARU");

        const service = await issueSecond();
        assert.equal(service.status, 201);
        assert.equal(state.machine.status, "U_KVARU", "adding a regular service must not downgrade an open breakdown");

        const breakdownIssueId = state.issues[0].id;
        const serviceIssueId = state.issues[1].id;

        // Resolving the regular service first leaves the open KVAR_NJIVA -> stays U_KVARU
        assert.equal((await resolve(serviceIssueId)).status, 200);
        assert.equal(state.machine.status, "U_KVARU");

        // Reopening the regular service while KVAR_NJIVA is still open must also keep U_KVARU
        assert.equal((await request(maintenance, "POST", `/issues/${serviceIssueId}/reopen`, {})).status, 200);
        assert.equal(state.machine.status, "U_KVARU");

        // Resolving the breakdown while regular service is active transitions to SERVIS
        assert.equal((await resolve(breakdownIssueId)).status, 200);
        assert.equal(state.machine.status, "SERVIS");

        // Resolving the remaining service frees the machine
        assert.equal((await resolve(serviceIssueId)).status, 200);
        assert.equal(state.machine.status, "SLOBODNA");
      }
    });

    await t.test("GET /remont-orders is strictly read-only even with unlinked legacy orders", async () => {
      reset();
      state.orders.push({
        id: "legacy-open",
        orderNumber: "RN-2025-0001",
        orderType: "REMONT_SERVIS",
        status: "DODELJEN",
        priority: "HITNO",
        workerId: "w",
        machineId: "m",
        maintenanceId: null,
        instructions: "Stari nalog bez servisa",
        orderDate: new Date("2025-10-01T00:00:00.000Z"),
        updatedAt: new Date("2025-10-01T00:00:00.000Z"),
      });
      const before = structuredClone(state);

      const first = await request(maintenance, "GET", "/remont-orders", {});
      assert.equal(first.status, 200);
      assert.equal(first.body.orders.length, 1);
      assert.equal(first.body.orders[0].maintenance, null);
      assert.deepEqual(state, before, "first GET must not create issues or mutate machine status");

      const second = await request(maintenance, "GET", "/remont-orders", {});
      assert.equal(second.status, 200);
      assert.deepEqual(state, before, "repeated GET must remain strictly read-only");
    });

    await t.test("legacy remont backfill previews counts, applies once with proper status mapping, and is idempotent", async () => {
      reset();
      state.orders.push(
        {
          id: "legacy-active",
          orderNumber: "RN-2025-0010",
          orderType: "REMONT_SERVIS",
          status: "DODELJEN",
          priority: "KRITICNO",
          workerId: "w",
          machineId: "m",
          maintenanceId: null,
          instructions: "Aktivni stari remont",
          orderDate: new Date("2025-10-10T00:00:00.000Z"),
          updatedAt: new Date("2025-10-10T00:00:00.000Z"),
        },
        {
          id: "legacy-done",
          orderNumber: "RN-2025-0011",
          orderType: "REMONT_SERVIS",
          status: "ZAVRSEN",
          priority: "NORMALNO",
          workerId: "w",
          machineId: "m",
          maintenanceId: null,
          instructions: "Zavrseni stari remont",
          orderDate: new Date("2025-09-01T00:00:00.000Z"),
          updatedAt: new Date("2025-09-02T00:00:00.000Z"),
        },
        {
          id: "legacy-cancelled",
          orderNumber: "RN-2025-0012",
          orderType: "REMONT_SERVIS",
          status: "OTKAZAN",
          priority: "HITNO",
          workerId: "w",
          machineId: "m",
          maintenanceId: null,
          instructions: "Otkazani stari remont",
          orderDate: new Date("2025-08-01T00:00:00.000Z"),
          updatedAt: new Date("2025-08-02T00:00:00.000Z"),
        },
        {
          id: "legacy-no-machine",
          orderNumber: "RN-2025-0013",
          orderType: "REMONT_SERVIS",
          status: "DODELJEN",
          priority: "NORMALNO",
          workerId: "w",
          machineId: null,
          maintenanceId: null,
          instructions: "Stari nalog bez masine",
          orderDate: new Date("2025-07-01T00:00:00.000Z"),
          updatedAt: new Date("2025-07-01T00:00:00.000Z"),
        }
      );

      const snapshotBeforePreview = structuredClone(state);
      const preview = await previewLegacyRemontBackfill(prisma);
      assert.equal(preview.dryRun, true);
      assert.equal(preview.totalUnlinked, 4);
      assert.equal(preview.eligibleOrders, 3);
      assert.equal(preview.skippedWithoutMachine, 1);
      assert.deepEqual(preview.byStatus, { active: 1, completed: 1, cancelled: 1 });
      assert.deepEqual(state, snapshotBeforePreview, "preview must be read-only");

      const applied = await backfillLegacyRemontOrders(prisma);
      assert.equal(applied.dryRun, false);
      assert.equal(applied.createdIssues, 3);
      assert.equal(applied.machinesSynced, 1);
      assert.equal(applied.skippedWithoutMachine, 1);
      assert.equal(state.issues.length, 3);

      const activeIssue = state.issues.find((i) => i.id === state.orders[0].maintenanceId);
      const doneIssue = state.issues.find((i) => i.id === state.orders[1].maintenanceId);
      const cancelledIssue = state.issues.find((i) => i.id === state.orders[2].maintenanceId);
      assert.equal(activeIssue.status, "OTVOREN");
      assert.equal(activeIssue.priority, "KRITICNA");
      assert.equal(doneIssue.status, "POPRAVLJENO");
      assert.equal(cancelledIssue.status, "OTKAZAN");
      assert.equal(state.orders[3].maintenanceId, null);
      assert.equal(state.machine.status, "SERVIS");

      // Second run must be a complete no-op
      const snapshotAfterFirst = structuredClone(state);
      const secondRun = await backfillLegacyRemontOrders(prisma);
      assert.equal(secondRun.createdIssues, 0);
      assert.equal(secondRun.machinesSynced, 0);
      assert.equal(secondRun.eligibleOrders, 0);
      assert.equal(secondRun.skippedWithoutMachine, 1);
      assert.deepEqual(state, snapshotAfterFirst);
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

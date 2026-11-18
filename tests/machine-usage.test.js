import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import router from "../routes/machineUsage.js";
import orderRouter from "../routes/workOrders.js";
import { usageContext, usageChangeSchema } from "../lib/machineUsageService.js";
import { completeMachineUsage } from "../lib/completeMachineUsage.js";
import { assertGenericOrderEdit, assertOrderTransition, sameWorkDay } from "../lib/workOrderStatusService.js";

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(w => matches(row, w));
    if (key === "AND") return value.every(w => matches(row, w));
    const actual = row[key];
    if (value === null) return actual == null;
    if (value instanceof Date) return +new Date(actual) === +value;
    if (value && typeof value === "object") return Object.entries(value).every(([op, v]) => {
      const a = v instanceof Date ? +new Date(actual) : actual, b = v instanceof Date ? +v : v;
      return op === "not" ? a !== b : op === "in" ? v.includes(a) : op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : op === "lte" ? a <= b : false;
    });
    return actual === value;
  });
}
function fixture({ finished = false, standalone = false } = {}) {
  const now = new Date(), started = new Date(now.getTime() - 4 * 3600000), ended = new Date(now.getTime() - 2 * 3600000);
  const state = { machine: [
    { id: "X", name: "X", status: finished ? "SLOBODNA" : "ZADUZENA", currentHours: finished ? 12 : 10, currentFuelLiters: finished ? 30 : 50, tankCapacityLiters: 200, updatedAt: now },
    { id: "Y", name: "Y", status: "SLOBODNA", currentHours: 100, currentFuelLiters: 80, tankCapacityLiters: 200, updatedAt: now },
  ], machineAssignment: [{ id: "old", machineId: "X", workerId: "worker", parcelId: "parcel", workOrderId: standalone ? null : "order",
    fieldWorkId: finished ? "work" : null, assignedAt: started, returnedAt: finished ? ended : null, startHours: 10,
    endHours: finished ? 12 : null, startFuelLiters: 50, endFuelLiters: finished ? 30 : null,
    status: finished ? "RAZDUZENA" : "ZADUZENA", areaDoneHa: finished ? 10 : null,
    machineStateBefore: { currentHours: 9, currentFuelLiters: 60 }, createdById: "user", updatedAt: now }],
    workOrder: standalone ? [] : [{ id: "order", orderType: "RAD_NJIVA", machineId: "X", workerId: "worker", parcelId: "parcel", workTypeId: "type",
      status: finished ? "ZAVRSEN" : "U_TOKU", fieldWorkId: finished ? "work" : null, orderDate: now }],
    fieldWork: finished ? [{ id: "work", machineId: "X", workerId: "worker", parcelId: "parcel", status: "ZAVRSENO", date: now, areaDoneHa: 10, workHours: 2 }] : [],
    maintenanceIssue: [], fuelEntry: [], auditLog: [], receipts: [], parcel: [{ id: "parcel", areaHa: 100 }],
  };
  let failAudit = false;
  const db = {};
  for (const model of Object.keys(state).filter(k => k !== "receipts")) {
    const decorate = (row, include) => !row ? null : structuredClone({ ...row,
      ...(include?.machine && { machine: state.machine.find(m => m.id === row.machineId) }),
    });
    db[model] = {
      async findUnique({ where, include }) { return decorate(state[model].find(r => matches(r, where)), include); },
      async findFirst({ where, include }) { return decorate(state[model].find(r => matches(r, where)), include); },
      async findMany({ where, include } = {}) { return state[model].filter(r => matches(r, where)).map(r => decorate(r, include)); },
      async create({ data }) {
        if (model === "auditLog" && failAudit) throw new Error("Audit unavailable");
        if (model === "machineAssignment" && data.status === "ZADUZENA" && state.machineAssignment.some(a => a.machineId === data.machineId && a.status === "ZADUZENA")) throw new Error("Duplicate active checkout");
        const row = { id: `${model}-${state[model].length}`, ...data, updatedAt: new Date() }; state[model].push(row); return structuredClone(row);
      },
      async update({ where, data }) {
        const row = state[model].find(r => matches(r, where)); if (!row) throw new Error(`Missing ${model}`);
        Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))); row.updatedAt = new Date(); return structuredClone(row);
      },
      async updateMany({ where, data }) { for (const row of state[model].filter(r => matches(r, where))) Object.assign(row, data); },
    };
  }
  db.$transaction = async fn => { const before = structuredClone(state); try { return await fn(db); } catch (e) { Object.assign(state, before); throw e; } };
  db.$queryRaw = async (_strings, userId, key) => state.receipts.filter(r => r.userId === userId && r.key === key);
  db.$executeRaw = async (strings, ...values) => {
    if (strings.join("").includes("INSERT INTO")) {
      const [userId, key, route, fingerprint, statusCode, response] = values;
      state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
    }
    return 1;
  };
  const req = { user: { id: "user", role: "RUKOVODILAC", name: "Manager" }, worker: { id: "worker" } };
  const contextType = standalone ? finished ? "work" : "assignment" : "order", contextId = standalone ? finished ? "work" : "old" : "order";
  const input = async (patch = {}) => ({ contextType, contextId, version: (await usageContext(db, contextType, contextId, req)).version,
    mode: "CORRECT", sourceId: "old", machineId: "Y", reason: "Pogresno izabrana masina", expectedMachineUpdatedAt: state.machine[1].updatedAt.toISOString(),
    startedAt: started.toISOString(), ...(finished && { endedAt: ended.toISOString(), endHours: 102, endFuelLiters: 60, areaDoneHa: 10 }),
    startHours: 100, startFuelLiters: 80, ...patch });
  return { state, db, req, input, now, started, ended, setFailAudit: value => { failAudit = value; } };
}

async function post(f, path, body, key, targetRouter = router) {
  const originals = Object.fromEntries(Object.keys(f.db).map(k => [k, prisma[k]]));
  Object.assign(prisma, f.db);
  let result;
  try {
    const handler = targetRouter.stack.find(l => l.route?.path === path && l.route.methods.post).route.stack[0].handle;
    await handler({ ...f.req, params: { id: "order" }, method: "POST", url: path, body, headers: key ? { "idempotency-key": key } : {} }, {
      status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; },
    });
    return result;
  } finally { Object.assign(prisma, originals); }
}

test("wrong selection correction transfers the active checkout, restores the untouched machine and records the actor", async () => {
  const f = fixture(); const result = await post(f, "/change", await f.input());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.machineAssignment[0].status, "PONISTENA");
  assert.equal(f.state.machine[0].currentHours, 9); assert.equal(f.state.machine[0].currentFuelLiters, 60);
  assert.equal(f.state.machine[0].status, "SLOBODNA"); assert.equal(f.state.machine[1].status, "ZADUZENA");
  assert.equal(f.state.workOrder[0].machineId, "Y"); assert.equal(f.state.workOrder[0].status, "U_TOKU");
  assert.equal(f.state.machineAssignment[1].workerId, "worker"); assert.equal(f.state.auditLog[0].userId, "user");
});
test("real replacement retains two hours on X and continues on Y atomically", async () => {
  const f = fixture(); const result = await post(f, "/change", await f.input({ mode: "REPLACE", startedAt: f.ended.toISOString(),
    previousEndHours: 12, previousEndFuelLiters: 30, previousAreaDoneHa: 4, areaDoneHa: 6 }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.machineAssignment[0].endHours - f.state.machineAssignment[0].startHours, 2);
  assert.equal(f.state.machineAssignment[0].status, "RAZDUZENA");
  assert.equal(f.state.machineAssignment[1].status, "ZADUZENA");
  assert.equal(f.state.machine[0].currentHours, 12);
});
test("both correction types work after completion without reopening the order or creating an active checkout", async () => {
  for (const mode of ["CORRECT", "REPLACE"]) {
    const f = fixture({ finished: true });
    const result = await post(f, "/change", await f.input({ mode, ...(mode === "REPLACE" ? {
      startedAt: new Date(+f.started + 3600000).toISOString(), previousEndHours: 11, previousEndFuelLiters: 40, previousAreaDoneHa: 4, areaDoneHa: 6,
    } : {}) }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(f.state.workOrder[0].status, "ZAVRSEN"); assert.equal(f.state.fieldWork[0].areaDoneHa, 10);
    assert.ok(f.state.machineAssignment.every(a => a.status !== "ZADUZENA"));
    assert.equal(f.state.machineAssignment.filter(a => !a.voidedAt).reduce((n, a) => n + a.areaDoneHa, 0), 10);
  }
});
test("standalone checkout and standalone finished work use the same correction", async () => {
  for (const finished of [false, true]) {
    const f = fixture({ standalone: true, finished });
    assert.equal((await post(f, "/change", await f.input())).status, 200);
    assert.equal(f.state.machineAssignment[1].workOrderId, null);
    if (finished) assert.equal(f.state.fieldWork[0].machineId, "Y");
  }
});
test("additional machine preserves the first and reallocates, rather than duplicates, hectares", async () => {
  const f = fixture({ finished: true });
  const result = await post(f, "/change", await f.input({ mode: "ADD", previousAreaDoneHa: 4, areaDoneHa: 6 }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.machineAssignment[0].status, "RAZDUZENA");
  assert.equal(f.state.machineAssignment[0].areaDoneHa, 4); assert.equal(f.state.machineAssignment[1].areaDoneHa, 6);
  assert.equal(f.state.fieldWork[0].workHours, 2);
});
test("unavailable target, interval conflicts, invalid readings and bad allocations leave all original state intact", async () => {
  for (const problem of ["busy", "overlap", "tank", "hours", "area", "future", "stale"]) {
    const f = fixture({ finished: problem !== "busy" }); let patch = {};
    if (problem === "busy") f.state.machine[1].status = "SERVIS";
    if (problem === "overlap") f.state.machineAssignment.push({ id: "other", machineId: "Y", workerId: "other", assignedAt: f.started, returnedAt: f.ended });
    if (problem === "tank") patch.startFuelLiters = 201;
    if (problem === "hours") patch.endHours = 99;
    if (problem === "area") patch.areaDoneHa = 20;
    if (problem === "future") patch.startedAt = new Date(+f.now + 3600000).toISOString();
    if (problem === "stale") patch.version = "stale";
    const body = await f.input(patch), before = structuredClone(f.state);
    assert.ok([400, 409].includes((await post(f, "/change", body)).status), problem);
    assert.deepEqual(f.state, before, problem);
  }
});
test("later history is preserved and historical availability is checked at the corrected interval", async () => {
  const f = fixture({ finished: true });
  f.state.machineAssignment.push({ id: "later-x", machineId: "X", workerId: "other", assignedAt: new Date(+f.ended + 1000), returnedAt: null, status: "ZADUZENA" },
    { id: "later-y", machineId: "Y", workerId: "other", assignedAt: new Date(+f.ended + 1000), returnedAt: null, status: "ZADUZENA" });
  f.state.machine[0].currentHours = 30; f.state.machine[0].currentFuelLiters = 100;
  f.state.machine[1].currentHours = 120; f.state.machine[1].currentFuelLiters = 150;
  f.state.machine.forEach(m => { m.status = "ZADUZENA"; });
  assert.equal((await post(f, "/change", await f.input())).status, 200);
  assert.deepEqual(f.state.machine.map(m => [m.currentHours, m.currentFuelLiters, m.status]), [[30, 100, "ZADUZENA"], [120, 150, "ZADUZENA"]]);
});
test("fuel events and reported breakdowns cannot silently disappear during correction", async () => {
  for (const breakdown of [false, true]) {
    const f = fixture({ finished: true });
    if (breakdown) f.state.machineAssignment[0].status = "VRACENA_SA_KVAROM";
    else f.state.fuelEntry.push({ id: "refuel", machineId: "X", date: new Date(+f.started + 1000), liters: 20 });
    const before = structuredClone(f.state);
    assert.equal((await post(f, "/change", await f.input())).status, 409);
    assert.deepEqual(f.state, before);
  }
});
test("operator corrections are own-day only and role bypasses are denied", async () => {
  for (const scenario of ["own", "other", "yesterday", "mechanic"]) {
    const f = fixture(); f.req.user.role = scenario === "mechanic" ? "MEHANICAR" : "OPERATER";
    f.state.machineAssignment[0].assignedAt = f.now;
    if (scenario === "other") f.req.worker.id = "other";
    if (scenario === "yesterday") f.state.machineAssignment[0].assignedAt = new Date(+f.started - 86400000);
    const body = await f.input({ startedAt: f.state.machineAssignment[0].assignedAt.toISOString() }).catch(() => null);
    if (scenario === "other") { assert.equal(body, null); continue; }
    const result = await post(f, "/change", body);
    assert.equal(result.status, scenario === "own" ? 200 : 403);
  }
  assert.equal(sameWorkDay("2026-11-09T23:15:00Z", new Date("2026-11-10T00:15:00Z")), true);
  assert.equal(sameWorkDay("2026-11-09T22:15:00Z", new Date("2026-11-09T23:15:00Z")), false);
});
test("replay returns the original successful correction; stale second requests cannot duplicate it", async () => {
  const f = fixture(), body = await f.input();
  const first = await post(f, "/change", body, "correction-once");
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(await post(f, "/change", body, "correction-once"))), JSON.parse(JSON.stringify(first)));
  assert.equal((await post(f, "/change", body, "different-key")).status, 409);
  assert.equal(f.state.machineAssignment.length, 2);
});
test("an audit write failure rolls back source, target, order, and allocation", async () => {
  const f = fixture(); f.setFailAudit(true); const body = await f.input(), before = structuredClone(f.state);
  assert.equal((await post(f, "/change", body)).status, 500);
  assert.deepEqual(f.state, before);
});
test("all active machines are returned together and worker hours are not summed from machine hours", async () => {
  const f = fixture();
  f.state.machineAssignment[0].areaDoneHa = 4;
  f.state.machineAssignment.push({ id: "second", machineId: "Y", workerId: "worker", workOrderId: "order", parcelId: "parcel", assignedAt: f.started, startHours: 100, status: "ZADUZENA", areaDoneHa: 6 });
  const work = { id: "work", workerId: "worker", parcelId: "parcel", areaDoneHa: 10, workHours: 2 };
  const args = { work, order: f.state.workOrder[0], machine: f.state.machine[0], activeAssignment: f.state.machineAssignment[0],
    input: { endHours: 12, endFuelLiters: 30, expectedMachineUpdatedAt: f.now.toISOString() }, workHours: 2 };
  const before = structuredClone(f.state);
  await assert.rejects(f.db.$transaction(db => completeMachineUsage(db, { ...f.req, body: {} }, args)), /svaku aktivnu/);
  assert.deepEqual(f.state, before);
  args.machine = f.state.machine[0];
  args.order = f.state.workOrder[0];
  args.input.machineReturns = [{ assignmentId: "second", endHours: 103, endFuelLiters: 60, expectedMachineUpdatedAt: f.now.toISOString() }];
  await f.db.$transaction(db => completeMachineUsage(db, { ...f.req, body: {} }, args));
  assert.equal(f.state.workOrder[0].status, "ZAVRSEN");
  assert.ok(f.state.machineAssignment.every(a => a.status === "RAZDUZENA" && a.fieldWorkId === "work"));
  assert.equal(work.workHours, 2);
});
test("generic status and identity edits cannot bypass acceptance, completion or replacement", () => {
  const order = { status: "DODELJEN", machineId: "X" };
  assert.throws(() => assertOrderTransition(order, "ZAVRSEN", "generic"));
  assert.throws(() => assertOrderTransition(order, "ZAVRSEN", "complete"));
  assert.throws(() => assertGenericOrderEdit(order, { status: "U_TOKU" }));
  assert.doesNotThrow(() => assertGenericOrderEdit(order, { machineId: "Y" }, false));
  assert.throws(() => assertGenericOrderEdit(order, { machineId: "Y" }, true));
  assert.throws(() => assertGenericOrderEdit({ ...order, status: "ZAVRSEN" }, { machineId: "Y" }));
  assert.equal(usageChangeSchema.safeParse({ endHours: Infinity }).success, false);
});

test("legacy work adopts only the explicitly selected matching checkout", async () => {
  const f = fixture({ finished: true, standalone: true });
  f.state.machineAssignment[0].fieldWorkId = null;
  const context = await usageContext(f.db, "work", "work", f.req);
  assert.equal(context.assignments.length, 0);
  assert.deepEqual(context.unlinkedAssignments.map(a => a.id), ["old"]);
  assert.equal(f.state.machineAssignment[0].fieldWorkId, null);
  const result = await post(f, "/change", await f.input());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(f.state.machineAssignment.every(a => a.fieldWorkId === "work"));
  assert.equal(f.state.machineAssignment[0].status, "PONISTENA");
});

test("adding a machine to standalone checkout keeps both segments in the same completion context", async () => {
  const f = fixture({ standalone: true });
  assert.equal((await post(f, "/change", await f.input({ mode: "ADD" }))).status, 200);
  for (const assignment of f.state.machineAssignment) {
    const context = await usageContext(f.db, "assignment", assignment.id, f.req);
    assert.equal(context.assignments.length, 2);
    assert.equal(context.terminal, false);
  }
});

test("canceling the remainder closes machines and preserves actual work and later corrections", async () => {
  const f = fixture();
  const work = { id: "work", workerId: "worker", parcelId: "parcel", machineId: "X", date: f.now, status: "ZAVRSENO", areaDoneHa: 4, workHours: 2 };
  f.state.fieldWork.push(work);
  await f.db.$transaction(db => completeMachineUsage(db, { ...f.req, body: {} }, {
    work, order: f.state.workOrder[0], machine: f.state.machine[0], activeAssignment: f.state.machineAssignment[0], workHours: 2,
    input: { cancelRemainder: true, endHours: 12, endFuelLiters: 30, expectedMachineUpdatedAt: f.now.toISOString() },
  }));
  assert.equal(f.state.workOrder[0].status, "OTKAZAN");
  assert.equal(f.state.workOrder[0].fieldWorkId, "work");
  assert.equal(f.state.machineAssignment[0].status, "RAZDUZENA");
  assert.equal(f.state.machineAssignment[0].areaDoneHa, 4);
  const result = await post(f, "/change", await f.input({ endedAt: f.state.machineAssignment[0].returnedAt.toISOString(), endHours: 102, endFuelLiters: 60, areaDoneHa: 4 }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.workOrder[0].status, "OTKAZAN");
  assert.ok(f.state.machineAssignment.every(a => a.status !== "ZADUZENA"));
});

test("other-order completion requires accepted work, returned machines and cannot bypass field work", async () => {
  for (const scenario of ["field", "unaccepted", "active", "valid"]) {
    const f = fixture();
    f.state.workOrder[0].orderType = scenario === "field" ? "RAD_NJIVA" : "OSTALO";
    if (scenario === "unaccepted") f.state.workOrder[0].status = "DODELJEN";
    if (scenario === "valid") f.state.machineAssignment[0].status = "RAZDUZENA";
    const before = structuredClone(f.state);
    const result = await post(f, "/:id/complete", { notes: "Prevoz opreme", workHours: 2 }, undefined, orderRouter);
    assert.equal(result.status, scenario === "valid" ? 200 : 409, JSON.stringify(result.body));
    if (scenario === "valid") {
      assert.equal(f.state.workOrder[0].status, "ZAVRSEN");
      assert.equal(f.state.auditLog[0].newValues.workerId, "worker");
      assert.equal(f.state.auditLog[0].newValues.workHours, 2);
    } else assert.deepEqual(f.state, before);
  }
});

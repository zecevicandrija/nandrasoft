import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import ordersRouter from "../routes/workOrders.js";
import fieldRouter from "../routes/fieldWork.js";
import assignmentsRouter from "../routes/assignments.js";

function request(router, method, url, body, headers = {}) {
  body = { expectedMachineUpdatedAt: "2026-11-01T00:00:00.000Z", ...body };
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
  const originals = Object.fromEntries(["workType", "contractor", "maintenanceIssue", "onionLot", "$queryRaw", "$executeRaw", "worker", "workOrder", "machine", "machineAssignment", "fieldWork", "parcel", "auditLog", "$transaction"].map((key) => [key, prisma[key]]));
  const sessionMock = mock.method(auth.api, "getSession", async () => ({ user, session: {} }));
  const logMock = mock.method(console, "error", () => {});
  const reset = () => {
    state = {
      orders: [
        { id: "own", workerId: "worker-a", machineId: "machine-a", parcelId: "parcel-a", workTypeId: "type-a", attachmentId: null, status: "DODELJEN", orderNumber: "RN-OWN" },
        { id: "other", workerId: "worker-b", machineId: "machine-b", parcelId: "parcel-b", workTypeId: "type-b", attachmentId: null, status: "DODELJEN", orderNumber: "RN-OTHER" },
      ],
      machines: ["machine-a", "machine-b"].map((id) => ({ id, name: id, status: "SLOBODNA", currentHours: 10, tankCapacityLiters: 200, updatedAt: new Date("2026-11-01T00:00:00.000Z") })),
      assignments: [], works: [], audit: [], receipts: [],
    };
    failOrderUpdate = false;
    beforeTransaction = null;
  };
  const matches = (row, where) => Object.entries(where).every(([key, value]) =>
    value === null ? row[key] == null : value instanceof Date && row[key] instanceof Date ? row[key].getTime() === value.getTime() : row[key] === value);
  const update = (rows, { where, data }) => {
    const row = rows.find((candidate) => matches(candidate, where));
    if (!row) throw Object.assign(new Error("Stale record"), { code: "P2025" });
    Object.assign(row, data);
    return { ...row };
  };
  prisma.$queryRaw = async (strings, userId, key) => state.receipts.filter((row) => row.userId === userId && row.key === key);
  prisma.$executeRaw = async (strings, ...values) => {
    if (strings.join("").includes('INSERT INTO "mutation_receipt"')) {
      const [userId, key, route, fingerprint, statusCode, response] = values;
      state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
    }
    return 1;
  };
  prisma.maintenanceIssue = { async findFirst() { return null; }, async findMany() { return []; } };
  prisma.worker = { async findUnique({ where }) {
    return { id: where.id || "worker-a", userId: "user-a", isActive: true, type: "STALNI", user: { role: "MAGACIN", isActive: true } };
  } };
  prisma.onionLot = {
    async findUnique({ where }) {
      return where.id === "lot-1" ? {
        id: "lot-1",
        lotNumber: "LOT-20261119-P01-01",
        rawStockKg: 5000,
        storageEntries: [{ chamberId: "ch-1", locationOrChamber: "Komora 1", currentQuantityKg: 5000 }],
      } : null;
    },
  };
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
    async findMany({ where }) { return state.assignments.filter(row => matches(row, where)).map(row => ({ ...row })); },
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
  prisma.fieldWork = {
    async findUnique({ where }) {
      const work = state.works.find(work => work.id === where.id);
      return work ? { ...work, contractor: work.contractorId ? { name: "Kooperant A" } : null } : null;
    },
    async update({ where, data }) {
      const { contractor, ...fields } = data;
      if (contractor) fields.contractorId = contractor.connect?.id ?? null;
      return update(state.works, { where, data: fields });
    },
    async create({ data }) {
    const work = { id: `work-${state.works.length}`, ...data };
    state.works.push(work);
    return work;
  } };
  prisma.workType = { async findUnique() { return { materialKind: null, materialRequired: false }; } };
  prisma.parcel = { async findUnique({ where }) { return { id: where.id, name: where.id, areaHa: 100 }; } };
  prisma.contractor = { async findUnique({ where }) { return where.id === "contractor-a" ? { id: where.id, name: "Kooperant A" } : null; } };
  prisma.auditLog = { async create({ data }) { state.audit.push(data); return data; } };
  prisma.$transaction = async (operations) => {
    if (Array.isArray(operations)) return Promise.all(operations);
    if (beforeTransaction) { beforeTransaction(); beforeTransaction = null; }
    const snapshot = structuredClone(state);
    try { return await operations(prisma); } catch (error) { state = snapshot; throw error; }
  };
  const prepareCompletion = () => {
    state.orders[0].status = "U_TOKU";
    if (!state.assignments.some(a => a.workOrderId === "own" && a.status === "ZADUZENA")) {
      state.assignments.push({ id: "own-assignment", machineId: "machine-a", workerId: "worker-a", parcelId: "parcel-a",
        workOrderId: "own", status: "ZADUZENA", startHours: 10, assignedAt: new Date() });
    }
  };
  const workBody = { workOrderId: "own", machineId: "machine-a", parcelId: "parcel-a", workTypeId: "type-a", areaDoneHa: 1, status: "ZAVRSENO" };
  try {
    await t.test("order photo can be replaced and cleared; field completion also keeps its photo on checkin", async () => {
      const photoUrl = `https://${process.env.BUNNY_PULL_ZONE_HOSTNAME || 'nandra.b-cdn.net'}/fotografije/2026/11/foto_12345678-1234-1234-1234-123456789abc.jpg`;
      reset(); user.role = "RUKOVODILAC";
      assert.equal((await request(ordersRouter, "PUT", "/own", { photoUrl })).status, 200);
      assert.equal(state.orders[0].photoUrl, photoUrl);
      assert.equal((await request(ordersRouter, "PUT", "/own", { instructions: "Updated" })).status, 200);
      assert.equal(state.orders[0].photoUrl, photoUrl);
      assert.equal((await request(ordersRouter, "PUT", "/own", { photoUrl: "https://untrusted.test/a.jpg" })).status, 400);
      assert.equal((await request(ordersRouter, "PUT", "/own", { photoUrl: null })).status, 200);
      assert.equal(state.orders[0].photoUrl, null);
      for (const existing of [false, true]) {
        reset(); user.role = "OPERATER";
        if (existing) state.assignments.push({ id: "a", workerId: "worker-a", machineId: "machine-a", workOrderId: "own", parcelId: "parcel-a", startHours: 10, status: "ZADUZENA" });
      prepareCompletion();
        assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, photoUrl })).status, 201);
        assert.equal(state.works[0].photoUrl, photoUrl);
        assert.equal(state.assignments[0].photoUrl, photoUrl);
      }
    });
    await t.test("manager can choose, replace, and clear the optional contractor on a field order", async () => {
      reset(); user.role = "RUKOVODILAC";
      state.orders[0].orderType = "RAD_NJIVA";
      assert.equal((await request(ordersRouter, "PUT", "/own", { contractorId: "contractor-a" })).status, 200);
      assert.equal(state.orders[0].contractorId, "contractor-a");
      assert.equal((await request(ordersRouter, "PUT", "/own", { instructions: "Promena napomene" })).status, 200);
      assert.equal(state.orders[0].contractorId, "contractor-a");
      assert.equal((await request(ordersRouter, "PUT", "/own", { contractorId: null })).status, 200);
      assert.equal(state.orders[0].contractorId, null);
      const before = structuredClone(state);
      assert.equal((await request(ordersRouter, "PUT", "/own", { contractorId: "missing" })).status, 400);
      assert.deepEqual(state, before);
    });

    await t.test("manager can add and remove a contractor on recorded work", async () => {
      reset(); user.role = "OPERATER";
      prepareCompletion();
      assert.equal((await request(fieldRouter, "POST", "/", workBody)).status, 201);
      user.role = "RUKOVODILAC";
      const url = `/${state.works[0].id}`;
      assert.equal((await request(fieldRouter, "PUT", url, { contractorId: "contractor-a" })).status, 200);
      assert.equal(state.works[0].contractorId, "contractor-a");
      assert.equal((await request(fieldRouter, "PUT", url, { contractorId: null })).status, 200);
      assert.equal(state.works[0].contractorId, null);
    });

    await t.test("field work inherits a contractor from the order, supports no contractor, and validates explicit choices", async () => {
      user.role = "OPERATER";
      reset();
      state.orders[0].contractorId = "contractor-a";
      prepareCompletion();
      assert.equal((await request(fieldRouter, "POST", "/", workBody)).status, 201);
      assert.equal(state.works[0].contractorId, "contractor-a");
      reset();
      state.orders[0].contractorId = "contractor-a";
      prepareCompletion();
      assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, contractorId: null })).status, 201);
      assert.equal(state.works[0].contractorId, null);
      reset();
      prepareCompletion();
      assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, contractorId: "contractor-a" })).status, 201);
      assert.equal(state.works[0].contractorId, "contractor-a");
      reset();
      const before = structuredClone(state);
      assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, contractorId: "missing" })).status, 400);
      assert.deepEqual(state, before);
    });

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
        assert.equal((await request(ordersRouter, "PATCH", "/own/status", { status: "U_TOKU" })).status, 409);
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
        assert.equal((await request(ordersRouter, "PATCH", "/other/status", { status: "ZAVRSEN" })).status, 409);
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

    await t.test("field-work fuel outside the tank capacity rejects both checkout paths without any writes", async () => {
      user.role = "OPERATER";
      for (const assigned of [false, true]) {
        for (const endFuelLiters of [200.01, 500, -1, "100", NaN, Infinity]) {
          reset();
          state.machines[0].currentFuelLiters = 50;
          if (assigned) {
            state.machines[0].status = "ZADUZENA";
            state.assignments.push({ id: "own-assignment", machineId: "machine-a", workerId: "worker-a", parcelId: "parcel-a", workOrderId: "own", status: "ZADUZENA", startHours: 10 });
          }
          const before = structuredClone(state);
          const result = await request(fieldRouter, "POST", "/", { ...workBody, endFuelLiters });
          assert.equal(result.status, 400, `assigned=${assigned}, fuel=${endFuelLiters}`);
          if (endFuelLiters > 200 && Number.isFinite(endFuelLiters)) assert.match(result.data.error, /200 L/);
          assert.deepEqual(state, before);
        }
      }
    });

    await t.test("valid field-work fuel including empty and full tanks is saved through both checkout paths", async () => {
      user.role = "OPERATER";
      for (const assigned of [false, true]) {
        for (const endFuelLiters of [0, 125.5, 200, null, undefined]) {
          reset();
          state.machines[0].currentFuelLiters = 50;
          if (assigned) {
            state.machines[0].status = "ZADUZENA";
            state.assignments.push({ id: "own-assignment", machineId: "machine-a", workerId: "worker-a", parcelId: "parcel-a", workOrderId: "own", status: "ZADUZENA", startHours: 10 });
          }
      prepareCompletion();
          const result = await request(fieldRouter, "POST", "/", { ...workBody, endFuelLiters, endHours: 12 });
          assert.equal(result.status, 201, `assigned=${assigned}, fuel=${endFuelLiters}`);
          assert.equal(state.works.length, 1);
          assert.equal(state.assignments.length, 1);
          assert.equal(state.assignments[0].status, "RAZDUZENA");
          assert.equal(state.assignments[0].endFuelLiters, endFuelLiters ?? null);
          assert.equal(state.machines[0].currentFuelLiters, endFuelLiters ?? 50);
          assert.equal(state.machines[0].currentHours, 12);
          assert.equal(state.machines[0].status, "SLOBODNA");
          assert.equal(state.orders[0].status, "ZAVRSEN");
        }
      }
    });

    await t.test("field-work fuel uses the machine capacity and the default only when it is missing", async () => {
      user.role = "OPERATER";
      for (const [capacity, accepted, rejected] of [[80, 80, 80.01], [500, 500, 500.01], [0, 0, 0.01], [null, 200, 200.01], [undefined, 200, 200.01]]) {
        for (const [endFuelLiters, expected] of [[accepted, 201], [rejected, 400]]) {
          reset();
          state.machines[0].tankCapacityLiters = capacity;
          prepareCompletion();
          const before = structuredClone(state);
          assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, endFuelLiters })).status, expected);
          if (expected === 400) assert.deepEqual(state, before);
          else assert.equal(state.machines[0].currentFuelLiters, accepted);
        }
      }
    });

    await t.test("invalid fuel cannot bypass validation without an order, automatic checkout or finished status", async () => {
      user.role = "OPERATER";
      for (const patch of [{ workOrderId: undefined }, { autoAssignMachine: false }, { status: "U_TOKU" }, { status: "STORNO" }]) {
        reset();
        const before = structuredClone(state);
        assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, ...patch, endFuelLiters: 201 })).status, 400);
        assert.deepEqual(state, before);
      }
    });

    await t.test("only finished work completes the matching order", async () => {
      reset(); user.role = "OPERATER";
      assert.equal((await request(fieldRouter, "POST", "/", { ...workBody, status: "U_TOKU" })).status, 400);
      assert.equal(state.orders[0].status, "DODELJEN");
      reset();
      state.assignments.push({ id: "own-assignment", machineId: "machine-a", workerId: "worker-a", parcelId: "parcel-a", workOrderId: "own", status: "ZADUZENA", startHours: 10 });
      prepareCompletion();
      assert.equal((await request(fieldRouter, "POST", "/", workBody)).status, 201);
      assert.equal(state.orders[0].status, "ZAVRSEN");
      assert.equal(state.orders[0].fieldWorkId, state.works[0].id);
      assert.equal(state.orders[1].status, "DODELJEN");
      assert.equal(state.assignments[0].status, "RAZDUZENA");
      assert.equal(state.machines[0].status, "SLOBODNA");
    });

    await t.test("failed completion rolls back work and machine changes, and terminal orders are rejected", async () => {
      reset(); prepareCompletion(); failOrderUpdate = true;
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
      prepareCompletion();
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
    await t.test("concurrent packing plan edits preserve the first saved change and reject stale snapshots with 409", async () => {
      reset();
      user.role = "RUKOVODILAC";
      const makePlan = (packageCount, qualityQuantityKg, inputQuantityKg) => ({
        entryMode: "both",
        sortingForm: { inputQuantityKg, qualityQuantityKg, smallQuantityKg: "80", wasteQuantityKg: "15", plevaKg: "5" },
        packagingForm: {
          date: "2026-11-20",
          lotId: "lot-1",
          sourceKey: "id:ch-1",
          sourceName: "Komora 1",
          packageType: "DZAK_10KG",
          unitWeightKg: "10",
          palletsCount: "1",
          packageCount,
          palletNumber: "P-1",
          packerCount: "4",
          packerNotes: "",
          responsiblePerson: "Bojan Ćorović",
          notes: "",
        },
      });
      const initialUpdatedAt = new Date("2026-11-19T08:00:00.000Z");
      const initialPlan = makePlan("100", "1000", "1100");
      state.orders.push({
        id: "packing-order",
        orderNumber: "RN-2026-0099",
        orderType: "PAKOVANJE",
        status: "DODELJEN",
        workerId: "worker-a",
        orderDate: new Date("2026-11-20T00:00:00.000Z"),
        packingPlan: initialPlan,
        updatedAt: initialUpdatedAt,
      });

      const firstOpenedVersion = initialUpdatedAt.toISOString();
      const firstEditPlan = makePlan("150", "1500", "1600");
      const firstRes = await request(ordersRouter, "PUT", "/packing-order", {
        orderType: "PAKOVANJE",
        workerId: "worker-a",
        orderUpdatedAt: firstOpenedVersion,
        packingPlan: firstEditPlan,
      });
      assert.equal(firstRes.status, 200);
      assert.equal(state.orders[2].packingPlan.packagingForm.packageCount, "150");
      assert.ok(state.orders[2].updatedAt.getTime() > initialUpdatedAt.getTime());

      // Second manager opened the order earlier and submits a worker change with the stale plan
      const staleRes = await request(ordersRouter, "PUT", "/packing-order", {
        orderType: "PAKOVANJE",
        workerId: "worker-b",
        orderUpdatedAt: firstOpenedVersion,
        packingPlan: initialPlan,
      });
      assert.equal(staleRes.status, 409);
      assert.equal(state.orders[2].packingPlan.packagingForm.packageCount, "150");
      assert.equal(state.orders[2].workerId, "worker-a");
      assert.equal(staleRes.data.workOrder.packingPlan.packagingForm.packageCount, "150");

      // Missing version on a packing order edit is also rejected with 409
      const missingVersionRes = await request(ordersRouter, "PUT", "/packing-order", {
        orderType: "PAKOVANJE",
        workerId: "worker-b",
        packingPlan: initialPlan,
      });
      assert.equal(missingVersionRes.status, 409);
      assert.equal(state.orders[2].workerId, "worker-a");

      // Second manager reloads the current plan and saves the worker change on top of it
      const reloaded = await request(ordersRouter, "GET", "/packing-order");
      assert.equal(reloaded.status, 200);
      const secondRes = await request(ordersRouter, "PUT", "/packing-order", {
        orderType: "PAKOVANJE",
        workerId: "worker-b",
        orderUpdatedAt: reloaded.data.workOrder.updatedAt.toISOString(),
        packingPlan: reloaded.data.workOrder.packingPlan,
      });
      assert.equal(secondRes.status, 200);
      assert.equal(state.orders[2].packingPlan.packagingForm.packageCount, "150");
      assert.equal(state.orders[2].workerId, "worker-b");
    });

    await t.test("field-work completion preserves work-order shift when omitted and honors explicit shift", async () => {
      for (const orderShift of ["DRUGA", "TRECA"]) {
        reset();
        user.role = "OPERATER";
        state.orders[0].shift = orderShift;
        prepareCompletion();
        const omittedRes = await request(fieldRouter, "POST", "/", { ...workBody });
        assert.equal(omittedRes.status, 201);
        assert.equal(state.works[0].shift, orderShift);
        assert.equal(omittedRes.data.work.shift, orderShift);
        assert.equal(state.orders[0].status, "ZAVRSEN");

        reset();
        user.role = "OPERATER";
        state.orders[0].shift = orderShift;
        prepareCompletion();
        const explicitRes = await request(fieldRouter, "POST", "/", { ...workBody, shift: "PRVA" });
        assert.equal(explicitRes.status, 201);
        assert.equal(state.works[0].shift, "PRVA");
      }
    });
  } finally {
    sessionMock.mock.restore(); logMock.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

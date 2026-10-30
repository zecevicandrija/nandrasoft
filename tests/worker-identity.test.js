import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import assignments from "../routes/assignments.js";
import fuel from "../routes/fuel.js";
import fieldWork from "../routes/fieldWork.js";
import tolls from "../routes/tolls.js";
import workOrders from "../routes/workOrders.js";
import maintenance from "../routes/maintenance.js";
import notifications from "../routes/notifications.js";
import users from "../routes/users.js";

function request(router, method, url, body, query = {}) {
  return new Promise((resolve, reject) => {
    router.handle({ method, url, body, query, headers: {} }, {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
    }, (error) => reject(error || new Error("Unhandled request")));
  });
}

test("worker identity is based on immutable IDs across business routes", async (t) => {
  let user = { id: "mine", name: "Same Name", role: "OPERATER", isActive: true };
  // The other employee appears first and has the same (mutable) display name.
  const workers = [
    { id: "other-worker", userId: "other", name: "Same Name", isActive: true },
    { id: "my-worker", userId: "mine", name: "Original Name", isActive: true },
    { id: "unclaimed", userId: null, name: "Same Name", isActive: true },
  ];
  const writes = [];
  const filters = [];
  const assignedWorkerId = "other-worker";
  let activeAssignment = null;
  const machine = { id: "machine", name: "Truck", status: "SLOBODNA", type: "KAMION", currentHours: 10, tankCapacityLiters: 500 };
  const originals = Object.fromEntries(["maintenanceIssue", "$executeRaw", "worker", "machine", "machineAssignment", "fuelEntry", "fieldWork", "workOrder", "parcel", "auditLog", "pushSubscription", "user", "$transaction", "$executeRaw"].map((key) => [key, prisma[key]]));
  prisma.$executeRaw = async () => 1;
  const sessionMock = mock.method(auth.api, "getSession", async () => ({ user, session: {} }));
  prisma.$executeRaw = async () => 1;
  prisma.maintenanceIssue = { async findFirst() { return null; }, async findMany() { return []; } };
  prisma.worker = {
    async findUnique({ where }) {
      assert.equal(Object.keys(where).length, 1);
      assert.ok("userId" in where || "id" in where);
      return workers.find((worker) => "userId" in where ? worker.userId === where.userId : worker.id === where.id) || null;
    },
    async findFirst() { throw new Error("Identity must never use findFirst or names"); },
    async create() { throw new Error("Business routes must not auto-provision profiles"); },
    async update() { throw new Error("Business routes must not reassign identities"); },
    async updateMany({ where, data }) {
      const worker = workers.find((worker) => worker.id === where.id && worker.userId === where.userId && worker.isActive === where.isActive);
      if (!worker) return { count: 0 };
      Object.assign(worker, data);
      writes.push({ type: "link", ...data });
      return { count: 1 };
    },
  };
  prisma.machine = {
    async findUnique() { return machine; },
    async update(args) { writes.push({ type: "machine", ...args.data }); return machine; },
  };
  prisma.machineAssignment = {
    async findFirst() { return activeAssignment; },
    async findUnique() { return { id: "assignment", workerId: assignedWorkerId, status: "ZADUZENA", startHours: 0, machine }; },
    async count({ where }) { filters.push(where); return 0; },
    async findMany({ where }) { filters.push(where); return []; },
    async create({ data }) { writes.push({ type: "assignment", ...data }); return { id: "new-assignment", ...data }; },
  };
  prisma.fuelEntry = {
    async findUnique() { return { id: "fuel", workerId: "other-worker", createdById: "other", date: new Date() }; },
    async count({ where }) { filters.push(where); return 0; },
    async findMany({ where }) { filters.push(where); return []; },
    async create({ data }) { writes.push({ type: "fuel", ...data }); return { id: "new-fuel", ...data }; },
  };
  prisma.fieldWork = { async findFirst() { return null; } };
  prisma.workOrder = {
    async findFirst() { return null; },
    async findUnique() { return { id: "other-order", workerId: "other-worker" }; },
  };
  prisma.parcel = { async findUnique() { return { id: "parcel", areaHa: 10 }; } };
  prisma.auditLog = { async create() { return {}; } };
  prisma.pushSubscription = { async upsert() { return { id: "subscription" }; } };
  prisma.user = { async findUnique({ where }) { return { id: where.id }; } };
  prisma.$transaction = async (operations) => typeof operations === "function" ? operations(prisma) : Promise.all(operations);
  const fuelBody = { machineId: "machine", fuelSource: "PUMPA", gasStation: "PETROL", liters: 5, totalCost: 1000 };
  const workBody = { machineId: "machine", parcelId: "parcel", workTypeId: "work-type", areaDoneHa: 1 };
  try {
    await t.test("missing and inactive worker links fail closed even with a matching name or supplied workerId", async () => {
      user = { ...user, id: "unlinked" };
      for (const [router, path, body] of [
        [assignments, "/checkout", { machineId: "machine", workerId: "other-worker" }],
        [fuel, "/entries", { ...fuelBody, workerId: "other-worker" }],
        [fieldWork, "/", workBody], [tolls, "/entries", {}],
        [workOrders, "/my-today", {}], [maintenance, "/stats", {}],
      ]) {
        assert.equal((await request(router, router === workOrders || router === maintenance ? "GET" : "POST", path, body)).status, 403);
      }
      assert.equal(workers[2].userId, null);
      assert.equal(writes.length, 0);
      user = { ...user, id: "mine" };
      workers[1].isActive = false;
      assert.equal((await request(assignments, "POST", "/checkout", { machineId: "machine" })).status, 403);
      workers[1].isActive = true;
    });

    await t.test("same name and profile rename cannot redirect assignments or fuel", async () => {
      for (const name of ["Same Name", "Completely Changed"]) {
        user.name = name;
        const assignment = await request(assignments, "POST", "/checkout", { machineId: "machine" });
        assert.equal(assignment.status, 201);
        assert.equal(assignment.data.assignment.workerId, "my-worker");
        const receipt = await request(fuel, "POST", "/entries", fuelBody);
        assert.equal(receipt.status, 201);
        assert.equal(receipt.data.entry.workerId, "my-worker");
      }
      assert.equal(workers[0].userId, "other");
      assert.equal(workers[2].userId, null);
    });

    await t.test("workers cannot submit another worker ID or change a colleague's records", async () => {
      const before = writes.length;
      assert.equal((await request(assignments, "POST", "/checkout", { machineId: "machine", workerId: "other-worker" })).status, 403);
      assert.equal((await request(fuel, "POST", "/entries", { ...fuelBody, workerId: "other-worker" })).status, 403);
      assert.equal((await request(fieldWork, "POST", "/", { ...workBody, workerId: "other-worker" })).status, 403);
      assert.equal((await request(assignments, "POST", "/checkin", { assignmentId: "assignment", endHours: 20 })).status, 403);
      assert.equal((await request(fuel, "PUT", "/entries/fuel", { liters: 7 })).status, 403);
      assert.equal(writes.length, before);
    });

    await t.test("field work cannot close another worker's assignment or work order", async () => {
      const before = writes.length;
      activeAssignment = { id: "other-assignment", workerId: "other-worker", startHours: 10 };
      assert.equal((await request(fieldWork, "POST", "/", workBody)).status, 403);
      activeAssignment = null;
      assert.equal((await request(fieldWork, "POST", "/", { ...workBody, workOrderId: "other-order" })).status, 403);
      assert.equal(writes.length, before);
    });

    await t.test("worker lists are scoped by the linked worker ID", async () => {
      assert.equal((await request(fuel, "GET", "/entries", undefined, { workerId: "other-worker" })).status, 200);
      assert.equal(filters.at(-1).workerId, "my-worker");
      assert.equal((await request(assignments, "GET", "/active")).status, 200);
      assert.equal(filters.at(-1).AND[0].workerId, "my-worker");
    });

    await t.test("push subscription cannot claim a matching worker profile", async () => {
      user = { ...user, id: "unlinked" };
      const response = await request(notifications, "POST", "/subscribe", {
        endpoint: "https://push.example.test/device", keys: { p256dh: "test-key", auth: "test-auth" },
      });
      assert.equal(response.status, 201);
      assert.equal(workers[2].userId, null);
    });

    await t.test("only directors can link explicit unclaimed IDs and existing links cannot be replaced", async () => {
      assert.equal((await request(users, "PUT", "/new-user/worker", { workerId: "unclaimed" })).status, 403);
      user = { ...user, id: "admin", role: "DIREKTOR" };
      assert.equal((await request(users, "PUT", "/new-user/worker", { workerId: "other-worker" })).status, 409);
      assert.equal((await request(users, "PUT", "/mine/worker", { workerId: "unclaimed" })).status, 409);
      assert.equal((await request(users, "PUT", "/new-user/worker", { workerId: "unclaimed" })).status, 200);
      assert.equal(workers[2].userId, "new-user");
      assert.equal((await request(users, "PUT", "/new-user/worker", { workerId: "unclaimed" })).status, 200);
      assert.equal((await request(users, "PUT", "/another-user/worker", { workerId: "unclaimed" })).status, 409);
    });

    await t.test("managers can still explicitly assign another active worker", async () => {
      const assignment = await request(assignments, "POST", "/checkout", { machineId: "machine", workerId: "other-worker" });
      assert.equal(assignment.status, 201);
      assert.equal(assignment.data.assignment.workerId, "other-worker");
      const receipt = await request(fuel, "POST", "/entries", { ...fuelBody, workerId: "other-worker" });
      assert.equal(receipt.status, 201);
      assert.equal(receipt.data.entry.workerId, "other-worker");
    });
  } finally {
    sessionMock.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

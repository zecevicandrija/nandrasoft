import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import ordersRouter from "../routes/workOrders.js";

function request(router, url, query = {}) {
  return new Promise((resolve, reject) => router.handle({ method: "GET", url, body: {}, query, headers: {} }, {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, data }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("GET /work-orders aggregates status counts in one groupBy query and projects minimal safe relations", async () => {
  let user = { id: "dir-1", role: "DIREKTOR", isActive: true, name: "Direktor" };
  const originals = {
    worker: prisma.worker,
    workOrder: prisma.workOrder,
  };
  const sessionMock = mock.method(auth.api, "getSession", async () => ({ user, session: {} }));

  const calls = { groupBy: [], findMany: [], count: 0 };
  const statusRows = [
    { status: "PLANIRAN", _count: { _all: 2 } },
    { status: "DODELJEN", _count: { _all: 3 } },
    { status: "U_TOKU", _count: { _all: 4 } },
    { status: "ZAVRSEN", _count: { _all: 10 } },
    { status: "OTKAZAN", _count: { _all: 1 } },
  ];

  prisma.worker = {
    async findUnique() {
      return { id: "worker-1", userId: user.id, isActive: true };
    },
  };
  prisma.workOrder = {
    async count() {
      calls.count++;
      return 0;
    },
    async groupBy(args) {
      calls.groupBy.push(args);
      return statusRows;
    },
    async findMany(args) {
      calls.findMany.push(args);
      return [{ id: "wo-1", orderNumber: "RN-2026-0001", status: "DODELJEN" }];
    },
  };

  try {
    // 1. Manager unfiltered list
    const allRes = await request(ordersRouter, "/", { page: "2", limit: "25" });
    assert.equal(allRes.status, 200);
    assert.equal(calls.count, 0);
    assert.equal(calls.groupBy.length, 1);
    assert.equal(calls.findMany.length, 1);
    assert.deepEqual(allRes.data.stats, {
      totalOrders: 20,
      pendingOrders: 5,
      inProgressOrders: 4,
      completedOrders: 10,
    });
    assert.deepEqual(allRes.data.pagination, { total: 20, page: 2, limit: 25, totalPages: 1 });

    // Verify slim relation projections (no pricing or JSON state snapshots)
    const include = calls.findMany[0].include;
    assert.deepEqual(include.worker, { select: { id: true, name: true } });
    assert.deepEqual(include.workType, { select: { id: true, name: true } });
    assert.equal(include.machineAssignments.select.machineStateBefore, undefined);
    assert.deepEqual(include.machineAssignments.select.machine, { select: { name: true } });

    // 2. Filtered by ZAVRSEN: total reflects filtered count, stats reflect all statuses for scope
    const doneRes = await request(ordersRouter, "/", { status: "ZAVRSEN" });
    assert.equal(doneRes.status, 200);
    assert.equal(doneRes.data.pagination.total, 10);
    assert.equal(doneRes.data.stats.totalOrders, 20);
    assert.equal(calls.groupBy[1].where.status, undefined);

    // 3. Date filter uses explicit UTC day boundaries
    const dateRes = await request(ordersRouter, "/", { date: "2026-11-12", type: "RAD_NJIVA" });
    assert.equal(dateRes.status, 200);
    const dateWhere = calls.findMany[2].where;
    assert.equal(dateWhere.orderType, "RAD_NJIVA");
    assert.equal(dateWhere.orderDate.gte.toISOString(), "2026-11-12T00:00:00.000Z");
    assert.equal(dateWhere.orderDate.lte.toISOString(), "2026-11-12T23:59:59.999Z");

    // 4. Operator defaults to AKTIVNI (PLANIRAN + DODELJEN + U_TOKU)
    user = { id: "op-1", role: "OPERATER", isActive: true, name: "Operater" };
    const opRes = await request(ordersRouter, "/", {});
    assert.equal(opRes.status, 200);
    assert.equal(opRes.data.pagination.total, 9);
    assert.equal(calls.findMany[3].where.workerId, "worker-1");
    assert.deepEqual(calls.findMany[3].where.status, { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] });

    // 5. Invalid query params return 400 instead of 500
    assert.equal((await request(ordersRouter, "/", { date: "not-a-date" })).status, 400);
    assert.equal((await request(ordersRouter, "/", { status: "BOGUS" })).status, 400);
    assert.equal((await request(ordersRouter, "/", { type: "BOGUS" })).status, 400);
  } finally {
    sessionMock.mock.restore();
    prisma.worker = originals.worker;
    prisma.workOrder = originals.workOrder;
  }
});

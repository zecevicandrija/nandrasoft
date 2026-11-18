import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import assignments from "../routes/assignments.js";

function getRequest(url, query = {}) {
  return new Promise((resolve, reject) =>
    assignments.handle(
      { method: "GET", url, headers: {}, query },
      {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ status: this.statusCode, body });
        },
      },
      (error) => reject(error || new Error("Unhandled request"))
    )
  );
}

test("GET /stats aggregates assignment and machine counts in two queries", async () => {
  const originals = {
    $queryRaw: prisma.$queryRaw,
    groupBy: prisma.machine.groupBy,
    workerFindUnique: prisma.worker.findUnique,
  };
  const session = mock.method(auth.api, "getSession", async () => ({
    user: { id: "dir-1", name: "Direktor", role: "DIREKTOR", isActive: true },
    session: {},
  }));

  let queryRawCalls = 0;
  let groupByArgs = null;

  prisma.worker.findUnique = async () => ({ id: "w-dir", isActive: true });
  prisma.$queryRaw = async () => {
    queryRawCalls += 1;
    return [{ activeAssignments: 3, totalToday: 5 }];
  };
  prisma.machine.groupBy = async (args) => {
    groupByArgs = args;
    return [
      { status: "SLOBODNA", _count: { _all: 7 } },
      { status: "U_KVARU", _count: { _all: 2 } },
    ];
  };

  try {
    const res = await getRequest("/stats");
    assert.equal(res.status, 200);
    assert.equal(queryRawCalls, 1);
    assert.deepEqual(groupByArgs, {
      by: ["status"],
      where: { isActive: true, status: { in: ["SLOBODNA", "U_KVARU"] } },
      _count: { _all: true },
    });
    assert.deepEqual(res.body, {
      activeAssignments: 3,
      freeMachines: 7,
      brokenMachines: 2,
      totalToday: 5,
    });
  } finally {
    session.mock.restore();
    prisma.$queryRaw = originals.$queryRaw;
    prisma.machine.groupBy = originals.groupBy;
    prisma.worker.findUnique = originals.workerFindUnique;
  }
});

test("GET /active and GET / restrict selected relation fields and isolate operators", async () => {
  const originals = {
    count: prisma.machineAssignment.count,
    findMany: prisma.machineAssignment.findMany,
    workerFindUnique: prisma.worker.findUnique,
  };
  let role = "OPERATER";
  const session = mock.method(auth.api, "getSession", async () => ({
    user: { id: "user-1", name: "User", role, isActive: true },
    session: {},
  }));

  let lastCountArgs = null;
  let lastFindManyArgs = null;

  prisma.worker.findUnique = async () => ({ id: "worker-42", isActive: true });
  prisma.machineAssignment.count = async (args) => {
    lastCountArgs = args;
    return 1;
  };
  prisma.machineAssignment.findMany = async (args) => {
    lastFindManyArgs = args;
    return [{ id: "assign-1", status: "ZADUZENA" }];
  };

  try {
    const opActive = await getRequest("/active", { page: "0", limit: "200" });
    assert.equal(opActive.status, 200);
    assert.equal(opActive.body.page, 1);
    assert.equal(opActive.body.totalPages, 1);
    assert.deepEqual(lastCountArgs.where, {
      status: "ZADUZENA",
      AND: [{ workerId: "worker-42" }],
    });
    assert.equal(lastFindManyArgs.take, 100);
    assert.equal(lastFindManyArgs.skip, 0);
    assert.deepEqual(lastFindManyArgs.include.worker, {
      select: { id: true, name: true, type: true, role: true },
    });
    assert.equal(lastFindManyArgs.include.worker.select.jmbg, undefined);
    assert.equal(lastFindManyArgs.include.worker.select.dailyWage, undefined);
    assert.equal(lastFindManyArgs.include.worker.select.hourlyRate, undefined);
    assert.deepEqual(lastFindManyArgs.include.parcel, {
      select: { id: true, code: true, name: true },
    });

    role = "DIREKTOR";
    const mgrHistory = await getRequest("/", { status: "RAZDUZENA", page: "2", limit: "25" });
    assert.equal(mgrHistory.status, 200);
    assert.deepEqual(lastCountArgs.where, { status: "RAZDUZENA" });
    assert.equal(lastFindManyArgs.skip, 25);
    assert.equal(lastFindManyArgs.take, 25);
    assert.equal(lastFindManyArgs.include.machine.select.notes, undefined);
    assert.equal(lastFindManyArgs.include.machine.select.enpTagNumber, undefined);
  } finally {
    session.mock.restore();
    prisma.machineAssignment.count = originals.count;
    prisma.machineAssignment.findMany = originals.findMany;
    prisma.worker.findUnique = originals.workerFindUnique;
  }
});

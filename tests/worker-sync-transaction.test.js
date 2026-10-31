import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import master from "../routes/masterData.js";
import seasonal from "../routes/seasonalWorkers.js";

function request(router, method, url, body) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers: {}, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("worker, user and seasonal profile synchronization commits or rolls back together", async (t) => {
  const original = prisma.$transaction;
  let role = "DIREKTOR", state, failure;
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", role, isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let tail = Promise.resolve();
  const reset = (isSeasonal = false) => {
    role = "DIREKTOR"; failure = null;
    state = {
      user: { id: "user", name: "Old name", role: "OPERATER" },
      workers: [{ id: "worker", userId: isSeasonal ? null : "user", name: "Old name", role: isSeasonal ? null : "OPERATER", type: isSeasonal ? "SEZONAC" : "STALNI", isActive: true }],
      audit: [],
      seasonal: isSeasonal ? [{ id: "seasonal", name: "Old name", isActive: true, dailyWage: 3000 }] : [],
    };
  };
  prisma.$transaction = async (callback) => {
    const previous = tail; let unlock;
    tail = new Promise((resolve) => { unlock = resolve; }); await previous;
    const snapshot = structuredClone(state);
    let locked = false;
    const check = (operation) => { assert.equal(locked, true); if (failure === operation) throw new Error(operation); };
    const withUser = (row) => row ? structuredClone({ ...row, user: row.userId ? state.user : null }) : null;
    const tx = {
      auditLog: { async create({ data }) { check("audit.create"); state.audit.push(data); return data; } },
      async $executeRaw(strings, namespace, key) {
        if (strings.join("").includes("pg_advisory_xact_lock")) { assert.equal(key, 7); locked = true; }
        return 1;
      },
      worker: {
        async findUnique({ where }) { check("worker.read"); return withUser(state.workers.find((row) => row.id === where.id)); },
        async findFirst() { check("worker.read"); return withUser(state.workers[0]); },
        async create({ data }) { check("worker.create"); const row = { id: "new-worker", ...data }; state.workers.push(row); return withUser(row); },
        async update({ where, data }) { check("worker.update"); const row = state.workers.find((row) => row.id === where.id); Object.assign(row, data); return withUser(row); },
      },
      user: { async update({ data }) { check("user.update"); Object.assign(state.user, data); return structuredClone(state.user); } },
      seasonalWorker: {
        async findFirst() { check("seasonal.read"); return structuredClone(state.seasonal[0] || null); },
        async findUnique() { check("seasonal.read"); return structuredClone(state.seasonal[0] || null); },
        async create({ data }) { check("seasonal.create"); const row = { id: "new-seasonal", ...data }; state.seasonal.push(row); return structuredClone(row); },
        async update({ data }) { check("seasonal.update"); Object.assign(state.seasonal[0], data); return structuredClone(state.seasonal[0]); },
      },
    };
    try {
      const result = await callback(tx);
      if (failure === "commit") throw new Error("Commit failure");
      return result;
    } catch (error) { state = snapshot; throw error; }
    finally { unlock(); }
  };
  try {
    await t.test("successful worker rename and role change return the updated user role", async () => {
      reset();
      const result = await request(master, "PUT", "/workers/worker", { name: "New name", role: "MEHANICAR" });
      assert.equal(result.status, 200);
      assert.equal(state.workers[0].name, "New name");
      assert.equal(state.workers[0].role, "MEHANICAR");
      assert.equal(state.user.role, "MEHANICAR");
      assert.equal(result.body.worker.user.role, "MEHANICAR");
    });
    await t.test("failure updating either the worker or user, including commit, leaves both unchanged", async () => {
      for (const operation of ["worker.update", "user.update", "audit.create", "commit"]) {
        reset(); failure = operation; const before = structuredClone(state);
        assert.equal((await request(master, "PUT", "/workers/worker", { name: "New name", role: "MEHANICAR" })).status, 500);
        assert.deepEqual(state, before);
      }
    });
    await t.test("failure updating or creating the seasonal profile rolls back the general worker", async () => {
      for (const operation of ["seasonal.update", "seasonal.create"]) {
        reset(true);
        if (operation === "seasonal.create") state.seasonal = [];
        failure = operation; const before = structuredClone(state);
        assert.equal((await request(master, "PUT", "/workers/worker", { name: "New name", dailyWage: 4000 })).status, 500);
        assert.deepEqual(state, before);
      }
    });
    await t.test("seasonal creation in either UI cannot leave an orphan profile", async () => {
      for (const [router, operation, body] of [
        [master, "seasonal.create", { name: "New worker", role: "SEZONAC", city: "Town" }],
        [seasonal, "worker.create", { name: "New worker", dailyWage: 3000 }],
      ]) {
        reset(); failure = operation; const before = structuredClone(state);
        assert.equal((await request(router, "POST", "/workers", body)).status, 500);
        assert.deepEqual(state, before);
      }
    });
    await t.test("reverse seasonal edits also roll back when general-worker synchronization fails", async () => {
      reset(true); failure = "worker.update"; const before = structuredClone(state);
      assert.equal((await request(seasonal, "PUT", "/workers/seasonal", { name: "New name", dailyWage: 4000 })).status, 500);
      assert.deepEqual(state, before);
    });
    await t.test("worker permissions are checked inside the same transaction before any change", async () => {
      reset(); role = "RUKOVODILAC";
      state.user.role = "RUKOVODILAC"; state.workers[0].role = "RUKOVODILAC";
      const before = structuredClone(state);
      assert.equal((await request(master, "PUT", "/workers/worker", { name: "New name" })).status, 403);
      assert.deepEqual(state, before);
    });
  } finally {
    prisma.$transaction = original; session.mock.restore(); logging.mock.restore();
  }
});

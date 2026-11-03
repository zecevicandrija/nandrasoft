import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import seasonal from "../routes/seasonalWorkers.js";

function update(body) {
  return new Promise((resolve, reject) => seasonal.handle({
    method: "PUT", url: "/workers/seasonal", body, headers: {}, query: {},
  }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, data }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("seasonal default hourly rates are editable by both management roles and synchronized atomically", async (t) => {
  let role = "DIREKTOR", failSync = false;
  let worker = { id: "seasonal", name: "Test Worker", hourlyRate: 400, isActive: true };
  let general = { id: "general", name: "Test Worker", hourlyRate: 400 };
  let audits = [];
  mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", role, isActive: true }, session: {} }));
  mock.method(console, "error", () => {});
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async (callback) => {
    const before = structuredClone({ worker, general, audits });
    try {
      return await callback({
        $executeRaw: async () => 1,
        seasonalWorker: {
          findUnique: async () => ({ ...worker }),
          update: async ({ data }) => { worker = { ...worker, ...data }; return worker; },
        },
        worker: {
          findFirst: async () => ({ ...general }),
          update: async ({ data }) => { if (failSync) throw new Error("Sync failed"); general = { ...general, ...data }; return general; },
        },
        auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
      });
    } catch (error) { ({ worker, general, audits } = before); throw error; }
  };
  t.after(() => { prisma.$transaction = originalTransaction; mock.restoreAll(); });
  for (const managementRole of ["DIREKTOR", "RUKOVODILAC"]) {
    role = managementRole;
    assert.equal((await update({ hourlyRate: 450.5 })).status, 200);
    assert.equal(worker.hourlyRate, 450.5);
    assert.equal(general.hourlyRate, 450.5);
  }
  assert.equal(audits.length, 2);
  failSync = true;
  assert.equal((await update({ hourlyRate: 700 })).status, 500);
  assert.equal(worker.hourlyRate, 450.5);
  assert.equal(general.hourlyRate, 450.5);
  assert.equal(audits.length, 2);
  failSync = false;
  role = "OPERATER";
  assert.equal((await update({ hourlyRate: 800 })).status, 403);
  assert.equal(worker.hourlyRate, 450.5);
});

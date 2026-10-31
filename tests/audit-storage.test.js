import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { compactAuditData, prepareAuditInsert, auditEvent } from "../lib/audit.js";
import { storageThreshold, readStorageUsage, startStorageMonitor } from "../lib/storageUsage.js";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import router from "../routes/auditLog.js";

test("audit stores only changed supplied fields and historical relation identities", () => {
  const oldValues = { id: "w", orderNumber: "RN-12", status: "OPEN", quantity: 10, note: "keep", workerId: "a", worker: { id: "a", name: "Earlier name", phone: "private", dailyWage: 5000 } };
  const data = { entityType: "WorkOrder", oldValues, newValues: { status: "DONE", quantity: 10, workerId: "b" } };
  const unchanged = structuredClone(data);
  const result = compactAuditData(data);
  assert.deepEqual(data, unchanged);
  assert.deepEqual(result.oldValues, { status: "OPEN", workerId: "a" });
  assert.deepEqual(result.newValues, { status: "DONE", workerId: "b" });
  assert.equal(result.formatVersion, 2);
  assert.equal(result.context.orderNumber, "RN-12");
  assert.deepEqual(result.context.references, { before: { worker: { id: "a", name: "Earlier name" } }, after: { worker: { id: "b" } } });
  const partial = compactAuditData({ ...data, newValues: { note: null } });
  assert.deepEqual(partial.newValues, { note: null });
  assert.deepEqual(partial.oldValues, { note: "keep" });
  assert.deepEqual(partial.context.references.before.worker, { id: "a", name: "Earlier name" });
  assert.equal(partial.context.references.after, undefined);
});

test("creation/deletion keep scalar snapshots, normalize dates/decimals and preserve essential shipment lines", () => {
  const values = { id: "s", totalCost: new Prisma.Decimal("1.01"), date: new Date("2026-10-31T00:00:00Z"), password: "secret", updatedAt: new Date(), items: [{ id: "line", packagingId: "p", packageCount: 2, totalWeightKg: 40, packaging: { unrelated: "large" } }], unrelated: [{ nested: true }] };
  const created = compactAuditData({ entityType: "OnionShipment", newValues: values });
  assert.deepEqual(created.newValues, { id: "s", totalCost: "1.01", date: "2026-10-31T00:00:00.000Z", items: [{ id: "line", packagingId: "p", packageCount: 2, totalWeightKg: 40 }] });
  const deleted = compactAuditData({ entityType: "OnionShipment", oldValues: values });
  assert.deepEqual(deleted.oldValues, created.newValues);
});

test("only new audit inserts are compacted and application history is append-only", () => {
  const args = { where: { id: "legacy" } };
  assert.equal(prepareAuditInsert("AuditLog", "findUnique", args), args);
  assert.equal(prepareAuditInsert("Worker", "update", args), args);
  for (const operation of ["delete", "deleteMany", "update", "updateMany", "upsert"]) assert.throws(() => prepareAuditInsert("AuditLog", operation, args), /cannot be modified/);
  assert.equal(prepareAuditInsert("AuditLog", "createMany", { data: [{ newValues: { hours: 8 } }] }).data[0].formatVersion, 2);
  const event = auditEvent({ user: { id: "actor", name: "Actor", role: "DIREKTOR" }, auditOperationId: "op" }, { userId: "forged", context: { workerName: "Worker" } });
  assert.equal(event.userId, "actor");
  assert.deepEqual(event.context, { workerName: "Worker", operationId: "op" });
  assert.throws(() => auditEvent({}, {}), /authenticated/);
});

test("storage thresholds use disk quota and failed monitoring never exposes database errors", async () => {
  for (const [bytes, expected] of [[4799999999, "ok"], [4800000000, "warning"], [5400000000, "critical"]]) assert.equal(storageThreshold(bytes, 6000000000), expected);
  assert.throws(() => storageThreshold(1, 0));
  const db = { async $queryRaw() { return [{ databaseBytes: "4800000000", auditBytes: "1024", receiptBytes: "512" }]; } };
  const usage = await readStorageUsage(db, {});
  assert.equal(usage.usedPercent, 80);
  assert.equal(usage.auditBytes, 1024);
  assert.equal(usage.level, "warning");
  await assert.rejects(readStorageUsage(db, { DB_STORAGE_QUOTA_BYTES: "invalid" }));
  const errors = [];
  const stop = startStorageMonitor({ async $queryRaw() { throw new Error("secret connection"); } }, { logger: { warn() {}, error(...args) { errors.push(args); } } });
  await new Promise((resolve) => setImmediate(resolve)); stop();
  assert.deepEqual(errors, [["DATABASE_STORAGE_MONITOR_UNAVAILABLE"]]);
});

test("audit list omits snapshots, detail supports legacy records, all routes require manager role", async () => {
  let role = "DIREKTOR";
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "actor", role, isActive: true }, session: {} }));
  const original = prisma.auditLog;
  const legacy = { id: "legacy", formatVersion: 1, oldValues: { nested: { complete: true } }, newValues: { value: 2 } };
  prisma.auditLog = { async count() { return 0; }, async findMany(args) { assert.equal(args.select.oldValues, undefined); assert.equal(args.select.newValues, undefined); return []; }, async findUnique({ where }) { return where.id === "legacy" ? legacy : null; } };
  const request = (url) => new Promise((resolve, reject) => router.handle({ method: "GET", url, query: {}, headers: {} }, { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } }, (error) => reject(error || new Error("Unhandled request"))));
  try {
    assert.equal((await request("/")).status, 200);
    assert.deepEqual((await request("/legacy")).body.log, legacy);
    assert.equal((await request("/missing")).status, 404);
    role = "OPERATER";
    for (const path of ["/", "/legacy", "/storage"]) assert.equal((await request(path)).status, 403);
  } finally { prisma.auditLog = original; session.mock.restore(); }
});

test("real Prisma transaction compacts once and rolls back audit records", { skip: process.env.TEST_ASSIGNMENT_DB !== "1" }, async () => {
  const id = `audit-test-${randomUUID()}`;
  const rollback = new Error("intentional rollback");
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const event = auditEvent({ user: { id: "synthetic", name: "Test actor", role: "DIREKTOR" }, auditOperationId: "test-op" }, { id, entityType: "WorkOrder", entityId: "test-only", action: "IZMENA", description: "Rollback-only test", oldValues: { status: "OPEN", worker: { id: "w", name: "Historical name" } }, newValues: { status: "DONE" } });
      const row = await tx.auditLog.create({ data: event });
      assert.equal(row.formatVersion, 2);
      assert.deepEqual(row.oldValues, { status: "OPEN" });
      assert.deepEqual(row.newValues, { status: "DONE" });
      assert.equal(row.context.references.before.worker.name, "Historical name");
      assert.equal(row.context.operationId, "test-op");
      throw rollback;
    }), (error) => error === rollback);
    assert.equal(await prisma.auditLog.findUnique({ where: { id } }), null);
  } finally { await prisma.$disconnect(); }
});

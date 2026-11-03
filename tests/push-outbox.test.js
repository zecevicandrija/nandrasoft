import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createServer } from "node:http";
import { once } from "node:events";
import { Prisma } from "@prisma/client";
import { enqueueWorkOrderPush, claimPushJobs, processPushJob, startPushOutboxWorker } from "../lib/pushOutbox.js";
import "dotenv/config";

function fixture() {
  const now = new Date("2026-10-31T10:00:00Z");
  const job = { id: "job", workOrderId: "order", workerId: "worker", userId: "user", subscriptionId: "phone",
    createdAt: now, status: "PROCESSING", attempts: 1, leaseToken: "lease" };
  const order = { id: "order", orderNumber: "RN-1", workerId: "worker", status: "DODELJEN",
    worker: { userId: "user", isActive: true, user: { isActive: true } } };
  let sends = 0, deleted = 0;
  const db = {
    workOrder: { async findUnique() { return order; } },
    pushSubscription: {
      async findUnique() { return { id: "phone", userId: "user" }; },
      async deleteMany() { deleted++; },
    },
    pushOutbox: {
      async findFirst({ where }) { return job.status === where.status && job.leaseToken === where.leaseToken ? { id: job.id } : null; },
      async updateMany({ where, data }) {
        if (where.status !== job.status || where.leaseToken !== job.leaseToken) return { count: 0 };
        Object.assign(job, data); return { count: 1 };
      },
    },
  };
  const send = async () => { sends++; };
  return { db, job, order, send, now, counts: () => ({ sends, deleted }), options: { now: () => now, logger: { error() {} } } };
}

test("pending orders send; accepted, completed, cancelled, reassigned and inactive recipients are skipped", async () => {
  for (const status of ["PLANIRAN", "DODELJEN", "U_TOKU", "ZAVRSEN", "OTKAZAN"]) {
    const f = fixture(); f.order.status = status;
    await processPushJob(f.db, f.job, f.send, f.options);
    const pending = ["PLANIRAN", "DODELJEN"].includes(status);
    assert.equal(f.job.status, pending ? "SENT" : "SKIPPED");
    assert.equal(f.counts().sends, pending ? 1 : 0);
  }
  for (const mutate of [
    (f) => { f.order.workerId = "other-worker"; },
    (f) => { f.order.worker.userId = "other-user"; },
    (f) => { f.order.worker.isActive = false; },
    (f) => { f.order.worker.user.isActive = false; },
    (f) => { f.db.workOrder.findUnique = async () => null; },
    (f) => { f.db.pushSubscription.findUnique = async () => null; },
    (f) => { f.db.pushSubscription.findUnique = async () => ({ userId: "other-user" }); },
  ]) {
    const f = fixture(); mutate(f);
    await processPushJob(f.db, f.job, f.send, f.options);
    assert.equal(f.job.status, "SKIPPED"); assert.equal(f.counts().sends, 0);
  }
});

test("a retry rechecks acceptance instead of sending an already accepted work order", async () => {
  const f = fixture();
  await processPushJob(f.db, f.job, async () => { throw new Error("offline"); }, f.options);
  assert.equal(f.job.status, "PENDING");
  assert.equal(f.job.nextAttemptAt.getTime() - f.now.getTime(), 30_000);
  Object.assign(f.job, { status: "PROCESSING", leaseToken: "next-lease", attempts: 2 });
  f.order.status = "U_TOKU";
  await processPushJob(f.db, f.job, f.send, f.options);
  assert.equal(f.job.status, "SKIPPED"); assert.equal(f.counts().sends, 0);
});

test("transient failures retry after 30s, 2min, 10min and stop after four attempts", async () => {
  const f = fixture();
  for (let attempt = 1; attempt <= 4; attempt++) {
    Object.assign(f.job, { status: "PROCESSING", leaseToken: `lease-${attempt}`, attempts: attempt });
    await processPushJob(f.db, f.job, async () => { throw Object.assign(new Error("private endpoint details"), { statusCode: 503 }); }, f.options);
    assert.equal(f.job.status, attempt === 4 ? "FAILED" : "PENDING");
    if (attempt < 4) assert.equal(f.job.nextAttemptAt.getTime() - f.now.getTime(), [30_000, 120_000, 600_000][attempt - 1]);
    assert.equal(f.job.lastError, "HTTP_503");
  }
});

test("expired subscriptions are removed; permanent failures, superseded jobs and old notifications do not retry", async () => {
  for (const code of [400, 401, 403, 404, 410]) {
    const f = fixture();
    await processPushJob(f.db, f.job, async () => { throw Object.assign(new Error(), { statusCode: code }); }, f.options);
    const expired = [404, 410].includes(code);
    assert.equal(f.job.status, expired ? "SKIPPED" : "FAILED");
    assert.equal(f.counts().deleted, expired ? 1 : 0);
  }
  const f = fixture(); f.job.createdAt = new Date(f.now.getTime() - 86400_000);
  await processPushJob(f.db, f.job, f.send, f.options);
  assert.equal(f.job.lastError, "expired");
  const other = fixture(); other.job.status = "SKIPPED";
  await processPushJob(other.db, other.job, other.send, other.options);
  assert.equal(other.counts().sends, 0);
});

test("background worker returns immediately, limits concurrency and waits for running sends at shutdown", async () => {
  const f = fixture();
  // This scheduler test needs fresh jobs regardless of the calendar date.
  f.job.createdAt = new Date();
  let release, claimed = 0, active = 0, peak = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  f.db.$queryRaw = async () => { claimed++; return [f.job, { ...f.job, id: "second" }]; };
  f.db.$executeRaw = async () => 0;
  const stop = startPushOutboxWorker(f.db, async () => { active++; peak = Math.max(peak, active); await gate; active--; }, { intervalMs: 5 });
  await new Promise(setImmediate);
  assert.equal(peak, 2);
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await new Promise(setImmediate); assert.equal(stopped, false);
  release(); await stopping;
  assert.equal(active, 0); assert.equal(claimed, 1);
});

test("push transport enforces a 3-second wall-clock deadline and preserves provider status", async (t) => {
  const webpush = (await import("web-push")).default;
  const keys = webpush.generateVAPIDKeys();
  const saved = { VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY };
  process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  t.after(() => { for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const { sendPushSubscription } = await import(`../lib/pushNotification.js?transport-test=${randomUUID()}`);
  const server = createServer((req, res) => {
    if (req.url === '/slow') return;
    res.writeHead(req.url === '/gone' ? 410 : 201); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.mock.method(webpush, 'generateRequestDetails', (sub, body, options) => {
    assert.equal(options.TTL, 86400); assert.equal(options.urgency, 'high');
    return { endpoint: sub.endpoint, method: 'POST', headers: {}, body };
  });
  await sendPushSubscription({ endpoint: `${base}/ok` }, { orderId: 'order' });
  await assert.rejects(sendPushSubscription({ endpoint: `${base}/gone` }, {}), { statusCode: 410 });
  const started = Date.now();
  await assert.rejects(sendPushSubscription({ endpoint: `${base}/slow` }, {}), { name: 'TimeoutError' });
  assert.ok(Date.now() - started >= 2500 && Date.now() - started < 5000);
});

test("PostgreSQL outbox is atomic with orders, claims are exclusive and expired leases recover after restart", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 30000,
}, async () => {
  const schema = `nandra_push_test_${randomUUID().replaceAll("-", "")}`;
  const a = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const b = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await a.connect(); await b.connect();
  const db = (client) => ({
    async $executeRaw(strings, ...values) { const sql = Prisma.sql(strings, ...values); return (await client.query(sql.text, sql.values)).rowCount; },
    async $queryRaw(strings, ...values) { const sql = Prisma.sql(strings, ...values); return (await client.query(sql.text, sql.values)).rows; },
  });
  try {
    await a.query(`CREATE SCHEMA "${schema}"`);
    await a.query(`SET search_path TO "${schema}"`); await b.query(`SET search_path TO "${schema}"`);
    await a.query(await readFile(new URL("../prisma/migrations/20261031008000_push_outbox/migration.sql", import.meta.url), "utf8"));
    await a.query(`CREATE TABLE worker (id text, "userId" text, "isActive" boolean);
      CREATE TABLE "user" (id text, "isActive" boolean);
      CREATE TABLE push_subscription (id text, "userId" text);
      CREATE TABLE work_order (id text PRIMARY KEY);
      INSERT INTO worker VALUES ('worker','user',true); INSERT INTO "user" VALUES ('user',true);
      INSERT INTO push_subscription VALUES ('phone','user'), ('laptop','user'), ('other','other');`);
    const order = { id: "order", workerId: "worker", status: "DODELJEN" };
    await a.query("BEGIN"); await a.query("INSERT INTO work_order VALUES ('order')");
    await enqueueWorkOrderPush(db(a), order);
    assert.equal((await b.query('SELECT COUNT(*)::int AS count FROM push_outbox')).rows[0].count, 0, 'uncommitted jobs must not be visible');
    await a.query("ROLLBACK");
    assert.equal((await a.query('SELECT COUNT(*)::int AS count FROM push_outbox')).rows[0].count, 0);
    await a.query("BEGIN"); await a.query("INSERT INTO work_order VALUES ('order')"); await enqueueWorkOrderPush(db(a), order); await a.query("COMMIT");
    const batches = await Promise.all([claimPushJobs(db(a)), claimPushJobs(db(b))]);
    assert.equal(batches.flat().length, 2);
    assert.equal(new Set(batches.flat().map((job) => job.id)).size, 2);
    await a.query(`UPDATE push_outbox SET "lockedUntil" = NOW() - INTERVAL '1 second'`);
    const recovered = await claimPushJobs(db(b));
    assert.equal(recovered.length, 2); assert.ok(recovered.every((job) => job.attempts === 2));
    await a.query(`UPDATE push_outbox SET status='SENT', "completedAt"=NOW() WHERE "subscriptionId"='phone'`);
    await a.query(`UPDATE push_outbox SET status='PENDING', "nextAttemptAt"=NOW(), "lockedUntil"=NULL WHERE "subscriptionId"='laptop'`);
    const retry = await claimPushJobs(db(a));
    assert.equal(retry.length, 1); assert.equal(retry[0].subscriptionId, "laptop");
    await enqueueWorkOrderPush(db(a), { ...order, status: "U_TOKU" });
    assert.equal((await a.query(`SELECT COUNT(*)::int AS count FROM push_outbox WHERE status IN ('PENDING','PROCESSING')`)).rows[0].count, 0);
  } finally {
    await a.query(`DROP SCHEMA "${schema}" CASCADE`); await a.end(); await b.end();
  }
});

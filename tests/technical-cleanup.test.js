import "dotenv/config";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { cleanupTechnicalRecords, previewTechnicalCleanup, startTechnicalCleanup } from "../lib/technicalCleanup.js";

const now = new Date("2026-11-01T12:00:00Z");
const cutoff = new Date("2026-10-02T12:00:00Z");
const beforeCutoff = new Date(cutoff.getTime() - 1);
function fixture() {
  let state = {
    sessions: [
      { id: "old", expiresAt: beforeCutoff },
      { id: "boundary", expiresAt: cutoff },
      { id: "recently-expired", expiresAt: new Date("2026-10-31T12:00Z") },
      { id: "active", expiresAt: new Date("2026-12-01T12:00Z"), createdAt: new Date("2026-01-01") },
    ],
    push: [
      { id: "old-sent", status: "SENT", completedAt: beforeCutoff },
      { id: "boundary-sent", status: "SENT", completedAt: cutoff },
      { id: "recent-sent", status: "SENT", completedAt: now },
      { id: "unknown-sent", status: "SENT", completedAt: null },
      ...["PENDING", "PROCESSING", "FAILED", "SKIPPED"].map((status) => ({ id: status, status, completedAt: beforeCutoff })),
    ],
  };
  const calls = [];
  let acquired = true, failPush = false;
  const db = { async $transaction(callback) {
    const snapshot = structuredClone(state);
    const eligibleSession = (row, date) => row.expiresAt < date;
    const eligiblePush = (row, date) => row.status === "SENT" && row.completedAt !== null && row.completedAt < date;
    try { return await callback({
      async $queryRaw(strings, ...values) {
        const sql = strings.join(""); calls.push(sql);
        if (sql.includes("pg_try_advisory")) return [{ acquired }];
        return [{ sessions: state.sessions.filter((row) => eligibleSession(row, values[0])).length,
          sentPush: state.push.filter((row) => eligiblePush(row, values[1])).length }];
      },
      async $executeRaw(strings, ...values) {
        const sql = strings.join(""); calls.push(sql);
        if (!sql.includes("DELETE")) return 0;
        assert.ok(sql.includes("FOR UPDATE SKIP LOCKED"));
        const [date, limit, recheckDate] = values;
        assert.equal(date.getTime(), recheckDate.getTime());
        const key = sql.includes('"session"') ? "sessions" : "push";
        if (key === "push" && failPush) throw new Error("SQL private token secret");
        const eligible = key === "sessions" ? eligibleSession : eligiblePush;
        const ids = new Set(state[key].filter((row) => eligible(row, date)).slice(0, limit).map((row) => row.id));
        state[key] = state[key].filter((row) => !ids.has(row.id));
        return ids.size;
      },
    }); } catch (error) { state = snapshot; throw error; }
  } };
  return { db, calls, get state() { return state; }, set busy(value) { acquired = !value; }, set failPush(value) { failPush = value; } };
}

test("cleanup deletes only sessions expired over 30 days ago and old successful pushes", async () => {
  const f = fixture();
  const result = await cleanupTechnicalRecords(f.db, { now });
  assert.equal(result.sessionsDeleted, 1);
  assert.equal(result.sentPushDeleted, 1);
  assert.deepEqual(f.state.sessions.map((row) => row.id), ["boundary", "recently-expired", "active"]);
  assert.deepEqual(f.state.push.map((row) => row.id), ["boundary-sent", "recent-sent", "unknown-sent", "PENDING", "PROCESSING", "FAILED", "SKIPPED"]);
  assert.ok(f.calls.filter((sql) => sql.includes("DELETE")).every((sql) => /DELETE FROM "session"|DELETE FROM push_outbox/.test(sql)));
  const repeated = await cleanupTechnicalRecords(f.db, { now });
  assert.equal(repeated.sessionsDeleted + repeated.sentPushDeleted, 0);
});

test("preview is read-only and uses the same retention boundaries", async () => {
  const f = fixture(), before = structuredClone(f.state);
  assert.deepEqual(await previewTechnicalCleanup(f.db, { now }), { dryRun: true, cutoff: cutoff.toISOString(), sessions: 1, sentPush: 1 });
  assert.deepEqual(f.state, before);
  assert.ok(f.calls.some((sql) => sql.includes("SET TRANSACTION READ ONLY")));
  assert.ok(f.calls.every((sql) => !sql.includes("DELETE")));
});

test("cleanup is bounded, skips a concurrent maintenance job and rolls back a failed batch", async () => {
  const f = fixture();
  f.state.sessions = Array.from({ length: 20 }, (_, i) => ({ id: String(i), expiresAt: beforeCutoff }));
  const result = await cleanupTechnicalRecords(f.db, { now, batchSize: 2, maxBatches: 3 });
  assert.equal(result.sessionsDeleted, 6);
  assert.equal(result.batches, 3);
  f.busy = true;
  const before = structuredClone(f.state);
  assert.equal((await cleanupTechnicalRecords(f.db, { now })).busy, true);
  assert.deepEqual(f.state, before);
  f.busy = false; f.failPush = true;
  await assert.rejects(cleanupTechnicalRecords(f.db, { now }));
  assert.deepEqual(f.state, before);
  for (const options of [{ batchSize: 0 }, { batchSize: 501 }, { maxBatches: 11 }, { now: new Date("invalid") }]) {
    await assert.rejects(cleanupTechnicalRecords(f.db, options));
  }
});

test("scheduler runs independently of push configuration, never overlaps, and drains on shutdown", async () => {
  let tick, released, transactions = 0, cleared = false;
  const gate = new Promise((resolve) => { released = resolve; });
  const timer = mock.method(globalThis, "setInterval", (callback, interval) => {
    tick = callback; assert.equal(interval, 86400000); return { unref() {} };
  });
  const cancel = mock.method(globalThis, "clearInterval", () => { cleared = true; });
  const f = fixture();
  const db = { async $transaction(fn, options) { transactions++; await gate; return f.db.$transaction(fn, options); } };
  try {
    const stop = startTechnicalCleanup(db, { logger: { info() {}, error() {} } });
    assert.equal(transactions, 1);
    tick(); tick(); assert.equal(transactions, 1);
    let done = false;
    const stopping = stop().then(() => { done = true; });
    await Promise.resolve(); assert.equal(done, false);
    released(); await stopping;
    assert.equal(cleared, true);
    tick(); assert.equal(transactions, 1);
    const disabled = startTechnicalCleanup(db, { enabled: false });
    await disabled(); assert.equal(transactions, 1);
  } finally { released(); timer.mock.restore(); cancel.mock.restore(); }
});

test("scheduler retries later after errors and logs no raw SQL, tokens or session details", async () => {
  const f = fixture(), errors = [];
  let tick;
  const timer = mock.method(globalThis, "setInterval", (callback) => { tick = callback; return { unref() {} }; });
  const cancel = mock.method(globalThis, "clearInterval", () => {});
  f.failPush = true;
  let stop;
  try {
    stop = startTechnicalCleanup(f.db, { logger: { info() {}, error(...args) { errors.push(args); } } });
    await new Promise(setImmediate);
    assert.deepEqual(errors, [["TECHNICAL_CLEANUP_UNAVAILABLE"]]);
    f.failPush = false; tick();
    await new Promise(setImmediate);
    assert.ok(!f.state.sessions.some((row) => row.id === "old"));
  } finally { await stop?.(); timer.mock.restore(); cancel.mock.restore(); }
});

test("PostgreSQL cleanup only changes eligible session-local fixture rows", { skip: process.env.TEST_CLEANUP_DB !== "1" }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query('CREATE TEMP TABLE "session" (id text PRIMARY KEY, "expiresAt" timestamp NOT NULL); CREATE TEMP TABLE push_outbox (id text PRIMARY KEY, status text, "completedAt" timestamptz)');
    const migration = await readFile(new URL("../prisma/migrations/20261101000000_session_expiry_cleanup_index/migration.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration);
    const indexes = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname = (SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()) AND indexname='session_expiresAt_id_idx'");
    assert.equal(indexes.rows.length, 1);
    await client.query('INSERT INTO "session" VALUES ($1,$2),($3,$4),($5,$6)', ["old", beforeCutoff, "boundary", cutoff, "active", new Date("2026-12-01")]);
    await client.query("INSERT INTO push_outbox VALUES ('sent','SENT',$1),('failed','FAILED',$1),('pending','PENDING',$1),('processing','PROCESSING',$1),('skipped','SKIPPED',$1),('boundary','SENT',$2)", [beforeCutoff, cutoff]);
    const query = (strings, values) => client.query(strings.reduce((sql, part, i) => sql + (i ? `$${i}` : "") + part, ""), values);
    const db = { async $transaction(fn) {
      await client.query("BEGIN");
      try {
        const result = await fn({
          async $queryRaw(strings, ...values) { return (await query(strings, values)).rows; },
          async $executeRaw(strings, ...values) { return (await query(strings, values)).rowCount; },
        });
        await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    } };
    const preview = await previewTechnicalCleanup(db, { now });
    assert.equal(preview.sessions, 1); assert.equal(preview.sentPush, 1);
    const result = await cleanupTechnicalRecords(db, { now, batchSize: 1 });
    assert.equal(result.sessionsDeleted, 1); assert.equal(result.sentPushDeleted, 1);
    assert.deepEqual((await client.query('SELECT id FROM "session" ORDER BY id')).rows.map((row) => row.id), ["active", "boundary"]);
    assert.deepEqual((await client.query('SELECT id FROM push_outbox ORDER BY id')).rows.map((row) => row.id), ["boundary", "failed", "pending", "processing", "skipped"]);
    assert.equal((await cleanupTechnicalRecords(db, { now })).sessionsDeleted, 0);
  } finally { await client.end(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolConfig } from "../lib/databaseConfig.js";
import { installGracefulShutdown } from "../lib/shutdown.js";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";

test("database pool has a bounded size and finite connection/acquisition timeout", async () => {
  const config = databasePoolConfig({ DATABASE_URL: "postgres://test@localhost/test" });
  assert.equal(config.max, 8);
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.idleTimeoutMillis, 10000);
  assert.equal(databasePoolConfig({ DB_POOL_MAX: "6" }).max, 6);
  assert.equal(databasePoolConfig({ DB_POOL_MAX: "10" }).max, 10);
  for (const value of ["0", "-1", "11", "12", "1.5", "8oops", "", "Infinity"]) {
    assert.throws(() => databasePoolConfig({ DB_POOL_MAX: value }), /DB_POOL_MAX/);
  }
  // Exercise the installed adapter; creating the empty pool opens no connection.
  const adapter = await new PrismaPg(config).connect();
  try {
    assert.equal(adapter.underlyingDriver().options.max, 8);
    assert.equal(adapter.underlyingDriver().options.connectionTimeoutMillis, 5000);
    assert.equal(adapter.underlyingDriver().totalCount, 0);
  } finally { await adapter.dispose(); }
});

test("Better Auth queries the same Prisma delegate used by business routes", async () => {
  let calls = 0;
  const originalUser = prisma.user;
  prisma.user = { async findFirst() { calls++; return null; } };
  try {
    const context = await auth.$context;
    assert.equal(await context.adapter.findOne({ model: "user", where: [{ field: "id", value: "shared-client-probe" }] }), null);
    assert.equal(calls, 1);
  } finally { prisma.user = originalUser; }
});

test("shutdown drains requests before disconnecting and handles repeated signals once", async () => {
  const processRef = new EventEmitter();
  const events = [];
  processRef.exit = (code) => { events.push(["exit", code]); };
  let drained;
  const server = { close(callback) { events.push("close"); drained = callback; } };
  const db = { async $disconnect() { events.push("disconnect"); } };
  installGracefulShutdown(server, db, { processRef });
  processRef.emit("SIGTERM"); processRef.emit("SIGINT");
  assert.deepEqual(events, ["close"]);
  await drained();
  assert.deepEqual(events, ["close", "disconnect", ["exit", 0]]);
});

test("an exhausted PostgreSQL pool rejects acquisition after five seconds and can recover", { skip: process.env.TEST_ASSIGNMENT_DB !== "1" }, async () => {
  const adapter = await new PrismaPg({ ...databasePoolConfig(), max: 1 }).connect();
  const pool = adapter.underlyingDriver();
  let held;
  try {
    held = await pool.connect();
    await held.query("SELECT 1");
    const started = Date.now();
    await assert.rejects(pool.connect(), /timeout/i);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 4500 && elapsed < 10000, `acquisition took ${elapsed}ms`);
    assert.equal(pool.totalCount, 1);
    held.release(); held = null;
    assert.equal((await pool.query("SELECT 1 AS value")).rows[0].value, 1);
  } finally { held?.release(); await adapter.dispose(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { createServer, get } from "node:http";
import express from "express";
import { createHealthCheck, rejectWhileDraining, runDatabaseProbe } from "../lib/health.js";
import { installGracefulShutdown } from "../lib/shutdown.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const response = () => ({
  code: 200, headers: {},
  set(key, value) { this.headers[key] = value; return this; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});
const fakeProcess = () => {
  const processRef = new EventEmitter();
  processRef.exits = [];
  processRef.exit = (code) => { processRef.exits.push(code); processRef.emit("exitCalled", code); };
  return processRef;
};

const probeDb = (queryClient) => ({
  async $transaction(callback, options) {
    assert.ok(options.maxWait > 0 && options.maxWait <= 2000);
    assert.ok(options.timeout > 0 && options.timeout <= 2000);
    return callback({ ...queryClient, async $executeRaw(strings, milliseconds) {
      assert.equal(strings.join('?'), "SELECT set_config('statement_timeout', ?, true)");
      assert.ok(Number(milliseconds) > 0 && Number(milliseconds) <= options.timeout);
    } });
  },
});

test("health verifies SELECT 1; database errors return 503 without internal details", async () => {
  for (const up of [true, false]) {
    const handler = createHealthCheck(probeDb({ async $queryRaw(strings) {
      assert.equal(strings.join(""), "SELECT 1");
      if (!up) throw new Error("secret connection string");
      return [{ value: 1 }];
    } }));
    const res = response();
    await handler({}, res);
    assert.equal(res.code, up ? 200 : 503);
    assert.equal(res.body.database, up ? "up" : "down");
    assert.equal(res.body.status, up ? "ok" : "unavailable");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.ok(Number.isFinite(Date.parse(res.body.timestamp)));
    assert.ok(!JSON.stringify(res.body).includes("secret"));
  }
});

test("health timeout is bounded and overlapping probes share one outstanding DB query", async () => {
  const pending = deferred();
  let calls = 0;
  const handler = createHealthCheck(probeDb({ $queryRaw() { calls++; return calls === 1 ? pending.promise : Promise.resolve([]); } }), { timeoutMs: 20 });
  const first = response(), second = response();
  await Promise.all([handler({}, first), handler({}, second)]);
  assert.equal(calls, 1);
  assert.equal(first.code, 503);
  assert.equal(second.body.database, "timeout");
  await handler({}, response());
  assert.equal(calls, 1, "polling must not enqueue more work while a timed-out query is unresolved");
  pending.resolve([]);
  await new Promise(setImmediate);
  const recovered = response();
  await handler({}, recovered);
  assert.equal(calls, 2);
  assert.equal(recovered.code, 200);
});

test("health skips obsolete SQL when pool acquisition or timeout setup consumes the deadline", async () => {
  for (const stage of ['acquisition','setup']) {
    let selects=0;
    const db={ async $transaction(callback, options) {
      assert.equal(options.maxWait,20); assert.equal(options.timeout,20);
      if (stage === 'acquisition') await new Promise(resolve => setTimeout(resolve,30));
      return callback({ async $executeRaw() { if (stage === 'setup') await new Promise(resolve => setTimeout(resolve,30)); },
        async $queryRaw() { selects++; } });
    } };
    await assert.rejects(runDatabaseProbe(db,{ timeoutMs:20 }), { code:'HEALTH_TIMEOUT' });
    assert.equal(selects,0);
  }
});

test("readiness stays unavailable when shutdown begins before or during the DB probe", async () => {
  let stopping = true, calls = 0;
  const pending = deferred();
  const handler = createHealthCheck(probeDb({ $queryRaw() { calls++; return pending.promise; } }), { isStopping: () => stopping });
  const first = response();
  await handler({}, first);
  assert.equal(first.code, 503);
  assert.equal(calls, 0);
  stopping = false;
  const second = response();
  const work = handler({}, second);
  stopping = true;
  pending.resolve([]);
  await work;
  assert.equal(second.code, 503);
  assert.equal(second.body.status, "shutting_down");
});

test("drain middleware rejects new application work without invoking downstream handlers", () => {
  let stopping = false, calls = 0;
  const middleware = rejectWhileDraining(() => stopping);
  middleware({}, response(), () => calls++);
  stopping = true;
  const res = response();
  middleware({}, res, () => calls++);
  assert.equal(calls, 1);
  assert.equal(res.code, 503);
  assert.equal(res.headers.Connection, "close");
});

test("real HTTP shutdown completes an active response before DB disconnect and ignores repeated signals", async (t) => {
  const started = deferred(), release = deferred(), exited = deferred();
  const events = [];
  const processRef = fakeProcess();
  processRef.on("exitCalled", exited.resolve);
  const app = express();
  app.use(rejectWhileDraining(() => lifecycle.isStopping()));
  app.get("/work", async (_req, res) => {
    events.push("work-start");
    started.resolve();
    await release.promise;
    events.push("work-end");
    res.json({ committed: true });
  });
  const server = createServer(app);
  const lifecycle = installGracefulShutdown(server, { async $disconnect() { events.push("disconnect"); } }, {
    processRef, timeoutMs: 2000, onShutdown() { events.push("stop-background"); },
  });
  t.after(() => { release.resolve(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const result = new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/work`, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ code: res.statusCode, body: JSON.parse(body) }));
    }).on("error", reject);
  });
  await started.promise;
  processRef.emit("SIGTERM"); processRef.emit("SIGTERM"); processRef.emit("SIGINT");
  assert.equal(lifecycle.isStopping(), true);
  assert.deepEqual(events, ["work-start", "stop-background"]);
  assert.deepEqual(processRef.exits, []);
  release.resolve();
  assert.deepEqual(await result, { code: 200, body: { committed: true } });
  assert.equal(await exited.promise, 0);
  assert.deepEqual(events, ["work-start", "stop-background", "work-end", "disconnect"]);
  assert.deepEqual(processRef.exits, [0]);
});

test("deadline forces one failure exit for hanging requests or DB disconnect", async () => {
  for (const hungDatabase of [false, true]) {
    const processRef = fakeProcess(), exited = deferred();
    processRef.once("exitCalled", exited.resolve);
    let closed = 0;
    const server = {
      close(callback) { if (hungDatabase) void callback(); },
      closeAllConnections() { closed++; },
    };
    installGracefulShutdown(server, { $disconnect() { return new Promise(() => {}); } }, {
      processRef, timeoutMs: 20, logger: { error() {} },
    });
    processRef.emit("SIGINT");
    assert.equal(await exited.promise, 1);
    assert.equal(closed, 1);
    assert.deepEqual(processRef.exits, [1]);
  }
});

test("DB disconnect errors exit unsuccessfully instead of reporting a clean stop", async () => {
  const processRef = fakeProcess(), exited = deferred();
  processRef.once("exitCalled", exited.resolve);
  installGracefulShutdown({ close(callback) { void callback(); } }, {
    async $disconnect() { throw new Error("disconnect failed"); },
  }, { processRef, logger: { error() {} } });
  processRef.emit("SIGTERM");
  assert.equal(await exited.promise, 1);
});

test("shutdown waits for asynchronous background delivery cleanup before closing the pool", async () => {
  const processRef = fakeProcess(), background = deferred(), exited = deferred();
  processRef.once("exitCalled", exited.resolve);
  let disconnected = false;
  installGracefulShutdown({ close(callback) { void callback(); } }, {
    async $disconnect() { disconnected = true; },
  }, { processRef, onShutdown: () => background.promise });
  processRef.emit("SIGTERM");
  await new Promise(setImmediate);
  assert.equal(disconnected, false);
  background.resolve();
  assert.equal(await exited.promise, 0);
  assert.equal(disconnected, true);
});

test("health SELECT 1 succeeds through the actual shared Prisma pool", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1",
}, async () => {
  const { prisma } = await import("../lib/prisma.js");
  try {
    const res = response();
    await createHealthCheck(prisma)({}, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.database, "up");
  } finally { await prisma.$disconnect(); }
});


test("health SQL is cancelled by PostgreSQL within two seconds and the shared pool remains usable", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 12000,
}, async () => {
  const { prisma } = await import("../lib/prisma.js");
  let pid, finishedAt, statementError;
  const started = Date.now();
  const slowDb = { $transaction: (callback, options) => prisma.$transaction(async tx => {
    [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
    return callback({
      $executeRaw: tx.$executeRaw.bind(tx),
      async $queryRaw() {
        try { return await tx.$queryRaw`SELECT pg_sleep(10) /* readiness_timeout_test */`; }
        catch (error) { statementError = error; throw error; }
        finally { finishedAt = Date.now(); }
      },
    });
  }, options) };
  try {
    const res = response();
    await createHealthCheck(slowDb)({}, res);
    assert.equal(res.code, 503); assert.equal(res.body.database, "timeout");
    const deadline = Date.now() + 1500;
    while (!finishedAt && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(finishedAt && finishedAt - started < 3000, "SQL must stop, not keep pg_sleep running for ten seconds");
    assert.ok(statementError);
    assert.match(JSON.stringify(statementError), /57014/, 'PostgreSQL must report query cancellation');
    const active = await prisma.$queryRaw`SELECT pid FROM pg_stat_activity WHERE pid = ${pid} AND pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%pg_sleep%'`;
    assert.equal(active.length, 0);
    const good = response(); await createHealthCheck(prisma)({}, good); assert.equal(good.code, 200);
  } finally { await prisma.$disconnect(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeSentryEvent } from "../lib/sentryPolicy.js";

const exec = promisify(execFile);
const cwd = new URL("../", import.meta.url);
const run = (source, env = {}) => exec(process.execPath, ["--input-type=module", "-e", source], {
  cwd, env: { ...process.env, SENTRY_ENABLED: "", SENTRY_DSN: "", ...env }, timeout: 15000,
});

test("without production opt-in Sentry adds no process handlers", async () => {
  for (const env of [{}, { SENTRY_ENABLED: "true", NODE_ENV: "development", SENTRY_DSN: "http://key@127.0.0.1:1/1" }]) {
    await run(`
      import assert from 'node:assert/strict';
      const before = process.listenerCount('uncaughtException');
      const { sentryRequestScope, flushSentry } = await import('./lib/sentry.js');
      let calls = 0;
      sentryRequestScope({}, {}, () => calls++);
      assert.equal(calls, 1);
      assert.equal(process.listenerCount('uncaughtException'), before);
      await flushSentry();
    `, env);
  }
});

test("privacy policy drops payloads and database parameters, ignores plain console output", () => {
  const error = Object.assign(new Error("INSERT secret-password"), { name: "PrismaClientKnownRequestError" });
  const event = sanitizeSentryEvent({
    request: { data: "secret" }, user: { email: "private@example.com" }, extra: { arguments: [error] },
    breadcrumbs: [{ message: "secret" }], contexts: { arbitrary: "secret" },
    exception: { values: [{ value: error.message, stacktrace: { frames: [] } }] },
  }, { originalException: error });
  assert.doesNotMatch(JSON.stringify(event), /secret|private/);
  assert.ok(event.exception.values[0].stacktrace);
  assert.equal(sanitizeSentryEvent({ logger: "console", message: "payload" }, { originalException: "payload" }), null);
  assert.equal(sanitizeSentryEvent({}, { originalException: Object.assign(new Error('validation'), { status: 422 }) }), null);
});

test("real SDK sends caught and uncaught Express errors without changing API responses", async (t) => {
  const events = [];
  const ingestion = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const lines = body.trim().split("\n");
      for (let i = 1; i + 1 < lines.length; i += 2) {
        if (JSON.parse(lines[i]).type === "event") events.push(JSON.parse(lines[i + 1]));
      }
      res.writeHead(200).end("{}");
    });
  });
  await new Promise((resolve) => ingestion.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => ingestion.close(resolve)));
  await run(`
    import assert from 'node:assert/strict';
    const { sentryRequestScope, sentryErrorHandler, flushSentry } = await import('./lib/sentry.js');
    const { default: express } = await import('express');
    const app = express();
    app.use(sentryRequestScope);
    app.get('/caught/:id', async (_req, res) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      console.error('Existing route logger', new Error('caught failure'), { secret: 'payload-secret' });
      res.status(500).json({ error: 'existing response' });
    });
    app.get('/thrown', () => { throw new Error('thrown failure'); });
    app.get('/expected', () => { throw Object.assign(new Error('validation'), { status: 400 }); });
    app.use(sentryErrorHandler);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: 'existing handler' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const [caught, thrown, expected] = await Promise.all([
      fetch(base + '/caught/private-id?token=query-secret'), fetch(base + '/thrown'), fetch(base + '/expected'),
    ]);
    assert.equal(caught.status, 500);
    assert.deepEqual(await caught.json(), { error: 'existing response' });
    assert.equal(thrown.status, 500);
    assert.equal(expected.status, 400);
    await new Promise(resolve => server.close(resolve));
    await flushSentry();
  `, { NODE_ENV: "production", SENTRY_ENABLED: "true", SENTRY_DSN: `http://key@127.0.0.1:${ingestion.address().port}/1` });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.transaction).sort(), ["GET /caught/:id", "GET /thrown"]);
  assert.doesNotMatch(JSON.stringify(events), /payload-secret|query-secret|private-id|validation/);
});

test("unreachable monitoring service does not prevent application work or bounded shutdown", async () => {
  await run(`
    import assert from 'node:assert/strict';
    const { flushSentry } = await import('./lib/sentry.js');
    const start = Date.now();
    console.error(new Error('offline monitoring'));
    assert.equal(2 + 2, 4);
    await flushSentry();
    assert.ok(Date.now() - start < 5000);
  `, { NODE_ENV: "production", SENTRY_ENABLED: "true", SENTRY_DSN: "http://key@127.0.0.1:1/1" });
});

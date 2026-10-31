import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import express from "express";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../routes/auth.js";
import { requireAuth } from "../middlewares/auth.js";
import { installApiAccess, createUserLimiter, createLoginLimiter } from "../lib/rateLimiting.js";

async function fixture(t, { userLimit = 2, loginLimit = 2, productionLogin = false, delayMs = 0, authGate } = {}) {
  let sessionReads = 0;
  t.mock.method(auth.api, "getSession", async ({ headers, query }) => {
    sessionReads++;
    assert.equal(query.disableCookieCache, true);
    // Only test session tokens are accepted. Spoofed identity headers are ignored.
    const token = /^token=(worker-\d+|inactive)$/.exec(headers.cookie || "")?.[1];
    return token ? { user: { id: token, role: "OPERATER", isActive: token !== "inactive" }, session: {} } : null;
  });
  const app = express();
  app.set("trust proxy", 1);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  installApiAccess(app, async (req, res) => {
    if (req.path.startsWith('/api/auth/get-session')) return res.json({ session: null });
    if (authGate) await authGate;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    res.status(req.headers['test-valid-login'] === 'true' ? 200 : 401).json({});
  }, { userLimiter: createUserLimiter({ limit: userLimit }), loginLimiter: createLoginLimiter(productionLogin ? {} : { limit: loginLimit }) });
  app.get("/api/work", requireAuth, (req, res) => res.json({ id: req.user.id }));
  app.get("/api/fuel", requireAuth, (req, res) => res.json({ id: req.user.id }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, headers = {}, body) => {
    const response = await fetch(base + path, { headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      ...(body && { method: 'POST', body: JSON.stringify(body) }) });
    await response.json();
    return response;
  };
  return { request, reads: () => sessionReads };
}

test("50 workers behind the same IP each receive a separate application quota", async (t) => {
  const { request, reads } = await fixture(t);
  for (let i = 0; i < 50; i++) {
    const headers = { cookie: `token=worker-${i}`, 'x-forwarded-for': '192.0.2.10' };
    assert.equal((await request('/api/work', headers)).status, 200);
    assert.equal((await request('/api/fuel', headers)).status, 200);
  }
  assert.equal(reads(), 100, 'app and router guards must share one request-scoped session verification');
  const limited = await request('/api/work', { cookie: 'token=worker-0', 'x-forwarded-for': '192.0.2.10' });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.ok(limited.headers.get('ratelimit-limit'));
  assert.equal((await request('/api/work', { cookie: 'token=worker-50', 'x-forwarded-for': '192.0.2.10' })).status, 200);
});

test("changing IP or supplying forged user IDs cannot reset a logged-in user's quota", async (t) => {
  const { request } = await fixture(t, { userLimit: 1 });
  assert.equal((await request('/api/work', { cookie: 'token=worker-1', 'x-forwarded-for': '192.0.2.11' })).status, 200);
  assert.equal((await request('/api/work?userId=forged', {
    cookie: 'token=worker-1', 'x-forwarded-for': '192.0.2.12', 'x-user-id': 'forged',
  })).status, 429);
  assert.equal((await request('/api/work', { 'x-user-id': 'worker-2' })).status, 401);
  assert.equal((await request('/api/work', { cookie: 'token=inactive' })).status, 403);
  assert.equal((await request('/api/health')).status, 200);
});

test("successful logins do not consume IP quota; failed sign-in/signup attempts share a strict IP limit", async (t) => {
  const { request } = await fixture(t);
  const ip = { 'x-forwarded-for': '192.0.2.20' };
  for (let i = 0; i < 50; i++) {
    assert.equal((await request('/api/auth/sign-in/email', { ...ip, 'test-valid-login': 'true' })).status, 200);
  }
  assert.equal((await request('/api/auth/sign-in/email', ip)).status, 401);
  assert.equal((await request('/api/auth/sign-up/email', ip)).status, 401);
  assert.equal((await request('/api/auth/sign-in/email', ip)).status, 429);
  assert.equal((await request('/api/auth/sign-in/email', { 'x-forwarded-for': '192.0.2.21' })).status, 401);
  assert.equal((await request('/api/work', { ...ip, cookie: 'token=worker-1' })).status, 200);
  assert.equal((await request('/api/auth/get-session', ip)).status, 200);
});

for (const count of [100, 150]) {
  test(`a burst of ${count} concurrent successful shift logins fits the production NAT quota`, async t => {
    const { request } = await fixture(t, { productionLogin: true, delayMs: 40 });
    const responses = await Promise.all(Array.from({ length: count }, (_, index) => request('/api/auth/sign-in/email', {
      'x-forwarded-for': '192.0.2.22', 'test-valid-login': 'true',
    }, { email: `worker-${index}@example.com`, password: 'valid-password' })));
    assert.ok(responses.every(response => response.status === 200));
  });
}

test("the production NAT bucket caps in-flight requests at 150 and advertises a five-minute retry window", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { request } = await fixture(t, { productionLogin: true, authGate: gate });
  const pending = Array.from({ length:151 }, (_, i) => request('/api/auth/sign-in/email', {
    'x-forwarded-for':'192.0.2.25', 'test-valid-login':'true',
  }, { email:`worker-${i}@example.com`, password:'valid-password' }));
  let timer;
  try {
    const blocked = await Promise.race([Promise.race(pending), new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('No request was limited')),2500); })]);
    assert.equal(blocked.status,429); assert.equal(blocked.headers.get('ratelimit-limit'),'150');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0 && Number(blocked.headers.get('retry-after')) <= 300);
  } finally { clearTimeout(timer); release(); }
  const responses = await Promise.all(pending);
  assert.equal(responses.filter(r => r.status === 429).length,1);
  assert.equal(responses.filter(r => r.status === 200).length,150);
});

test("five failed logins block one account across IP/case changes while colleagues can still log in", async t => {
  const { request } = await fixture(t, { productionLogin: true });
  const headers = { 'x-forwarded-for': '192.0.2.23' };
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/auth/sign-in/email', headers, { email: 'worker@example.com', password: 'wrong' })).status, 401);
  const blocked = await request('/api/auth/sign-in/email', { 'x-forwarded-for': '192.0.2.24', 'test-valid-login': 'true' }, { email: ' WORKER@EXAMPLE.COM ', password: 'valid-password' });
  assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after'));
  assert.equal((await request('/api/auth/sign-in/email', { ...headers, 'test-valid-login': 'true' }, { email: 'colleague@example.com', password: 'valid-password' })).status, 200);
  assert.equal((await request('/api/auth/get-session', headers)).status, 200);
});

test("Better Auth production rules do not impose a second NAT quota on successful logins or session reads", async () => {
  const database = { user: [], session: [], account: [], verification: [] };
  const instance = betterAuth({
    baseURL: "http://localhost:5000", secret: "test-only-secret-at-least-thirty-two-characters",
    database: memoryAdapter(database), emailAndPassword: { ...auth.options.emailAndPassword, disableSignUp: false },
    user: auth.options.user, rateLimit: { ...auth.options.rateLimit, enabled: true },
    trustedOrigins: ["http://localhost:5000"],
  });
  const post = (path) => instance.handler(new Request(`http://localhost:5000/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5000', 'x-forwarded-for': '192.0.2.30' },
    body: JSON.stringify({ name: 'Worker', email: 'worker@example.com', password: 'test-password-123' }),
  }));
  assert.equal((await post('sign-up/email')).status, 200);
  for (let i = 0; i < 6; i++) assert.equal((await post('sign-in/email')).status, 200);
  for (let i = 0; i < 105; i++) {
    const response = await instance.handler(new Request('http://localhost:5000/api/auth/get-session', {
      headers: { 'x-forwarded-for': '192.0.2.30' },
    }));
    assert.equal(response.status, 200);
  }
});


test("login body parsing and the account limiter work with Better Auth's real Node handler", async t => {
  const instance = betterAuth({
    baseURL: "http://localhost:5000", secret: "test-only-secret-at-least-thirty-two-characters",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { ...auth.options.emailAndPassword, disableSignUp: false },
    rateLimit: auth.options.rateLimit, trustedOrigins: ["http://localhost:5000"],
  });
  const app = express(); app.set('trust proxy',1);
  installApiAccess(app,toNodeHandler(instance));
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = async (path, email = 'worker@example.com', password = 'test-password-123') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${path}`, {
      method:'POST',headers:{ 'content-type':'application/json', origin:'http://localhost:5000', 'x-forwarded-for':'192.0.2.40' },
      body:JSON.stringify({ name:'Worker',email,password }),
    });
    await res.text(); return res;
  };
  assert.equal((await post('sign-up/email')).status,200);
  for (let i=0;i<8;i++) assert.equal((await post('sign-in/email')).status,200);
  for (let i=0;i<5;i++) assert.equal((await post('sign-in/email','worker@example.com','wrong')).status,401);
  assert.equal((await post('sign-in/email')).status,429);
});

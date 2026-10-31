import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "../lib/prisma.js";
import { machineMutation } from "../lib/machineAvailability.js";
import { inventoryMutation } from "../lib/inventoryTransaction.js";
import { mutationIdentity, findReceipt, saveReceipt } from "../lib/mutationReceipt.js";

const req = (body = { hours: 12 }, key = "request-1234", userId = "worker") => ({ method: "POST", url: "/checkout", baseUrl: "/api/assignments", user: { id: userId }, headers: { "idempotency-key": key }, body });
async function invoke(handler, request) {
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await handler(request, response); return { status: response.statusCode, body: response.body };
}

test("receipt and business writes commit atomically and replay does not execute the handler or notifications", async (t) => {
  const original = prisma.$transaction;
  let state = { writes: 0, receipts: [] }, tail = Promise.resolve(), notified = 0, failReceipt = false, failCommit = false;
  const tx = {
    async $queryRaw(strings, userId, key) { return state.receipts.filter((row) => row.userId === userId && row.key === key); },
    async $executeRaw(strings, ...values) {
      if (!strings.join("").includes("INSERT INTO")) return 1;
      if (failReceipt) throw new Error("Receipt write failed");
      const [userId, key, route, fingerprint, statusCode, response] = values;
      state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
      return 1;
    },
  };
  prisma.$transaction = async (callback) => {
    const previous = tail; let unlock;
    tail = new Promise((resolve) => { unlock = resolve; }); await previous;
    const snapshot = structuredClone(state);
    try { const result = await callback(tx); if (failCommit) throw new Error("Commit failed"); return result; }
    catch (error) { state = snapshot; throw error; }
    finally { unlock(); }
  };
  const handler = machineMutation(async (request, response, db) => {
    state.writes++;
    db.$afterCommit(() => { notified++; });
    response.status(201).json({ id: state.writes, body: request.body });
  });
  try {
    await t.test("parallel repeats and a later lost-response retry return one stored result", async () => {
      const results = await Promise.all([invoke(handler, req()), invoke(handler, req())]);
      assert.deepEqual(results[0], results[1]);
      assert.deepEqual(await invoke(handler, req()), results[0]);
      assert.equal(state.writes, 1); assert.equal(notified, 1); assert.equal(state.receipts.length, 1);
    });
    await t.test("same key cannot change body or endpoint, and is isolated between users", async () => {
      assert.equal((await invoke(handler, req({ hours: 13 }))).status, 409);
      assert.equal((await invoke(handler, { ...req(), url: "/checkin" })).status, 409);
      assert.equal(state.writes, 1);
      assert.equal((await invoke(handler, req({ hours: 12 }, "request-1234", "other-worker"))).status, 201);
      assert.equal(state.writes, 2);
    });
    await t.test("receipt write failure and commit failure roll back all writes, allowing the same key to succeed later", async () => {
      for (const failure of ["receipt", "commit"]) {
        const before = structuredClone(state), notices = notified;
        failReceipt = failure === "receipt"; failCommit = failure === "commit";
        const request = req({}, `failed-${failure}`);
        assert.equal((await invoke(handler, request)).status, 500);
        assert.deepEqual(state, before); assert.equal(notified, notices);
        failReceipt = false; failCommit = false;
        assert.equal((await invoke(handler, request)).status, 201);
        assert.equal(state.writes, before.writes + 1);
      }
    });
    await t.test("rejected business operation saves no receipt and invalid keys run no writes", async () => {
      const before = structuredClone(state);
      const rejected = machineMutation(async (request, response) => { state.writes++; response.status(400).json({ error: "Invalid hours" }); });
      assert.equal((await invoke(rejected, req({}, "rejected-123"))).status, 400);
      assert.equal((await invoke(handler, req({}, "bad"))).status, 400);
      assert.deepEqual(state, before);
    });
    assert.equal(mutationIdentity(req({ b: 1, a: [2, 3] })).fingerprint, mutationIdentity(req({ a: [2, 3], b: 1 })).fingerprint);
  } finally { prisma.$transaction = original; }
});

test("PostgreSQL stores receipts in the same transaction as business writes", { skip: process.env.TEST_ASSIGNMENT_DB !== "1" }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sql = await readFile(new URL("../prisma/migrations/20261030230000_mutation_receipts/migration.sql", import.meta.url), "utf8");
    // Only session-local tables are used; never touch live receipts/business data.
    await client.query(sql.replace('CREATE TABLE "mutation_receipt"', 'CREATE TEMP TABLE "mutation_receipt"'));
    await client.query('CREATE TEMP TABLE receipt_test_business (id int)');
    const query = (strings, values) => {
      const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
      return client.query(text, values);
    };
    const db = { $executeRaw: (strings, ...values) => query(strings, values), $queryRaw: async (strings, ...values) => (await query(strings, values)).rows };
    const identity = mutationIdentity(req());
    await client.query("BEGIN");
    await client.query("INSERT INTO receipt_test_business VALUES (1)");
    await saveReceipt(db, identity, { status: 201, body: { id: 1 } });
    await client.query("ROLLBACK");
    assert.equal(await findReceipt(db, identity), null);
    assert.equal((await client.query("SELECT * FROM receipt_test_business")).rowCount, 0);
    await client.query("BEGIN");
    await client.query("INSERT INTO receipt_test_business VALUES (1)");
    await saveReceipt(db, identity, { status: 201, body: { id: 1 } });
    await client.query("COMMIT");
    assert.deepEqual(await findReceipt(db, identity), { status: 201, body: { id: 1 } });
    assert.equal((await findReceipt(db, { ...identity, fingerprint: "different" })).status, 409);
    await assert.rejects(saveReceipt(db, identity, { status: 201, body: { id: 2 } }), { code: "23505" });
  } finally { await client.end(); }
});

test("PostgreSQL serializes financial request replays and cross-domain key reuse", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 30000,
}, async () => {
  const schema = `nandra_financial_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^nandra_financial_test_[a-f0-9]{32}$/);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
  const admin = await pool.connect();
  const original = prisma.$transaction;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query(await readFile(new URL("../prisma/migrations/20261030230000_mutation_receipts/migration.sql", import.meta.url), "utf8"));
    await admin.query('CREATE TABLE financial_business (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)');
    prisma.$transaction = async (callback) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO "${schema}"`);
        const query = (strings, values) => client.query(
          strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values,
        );
        const tx = {
          $executeRaw: async (strings, ...values) => (await query(strings, values)).rowCount,
          $queryRaw: async (strings, ...values) => (await query(strings, values)).rows,
        };
        const value = await callback(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    };
    const handler = (domain) => inventoryMutation(domain, async (request, response, tx) => {
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO financial_business (id, amount) VALUES (${id}, ${request.body.amount})`;
      response.status(201).json({ id, amount: request.body.amount });
    }, { idempotent: true });
    const fuel = handler("fuel"), seasonal = handler("seasonal");
    const financialRequest = (key, path = "/fuel") => ({
      ...req({ amount: 3000 }, key), baseUrl: "/api/financial-test", url: path,
    });
    const repeats = await Promise.all(Array.from({ length: 6 }, () => invoke(fuel, financialRequest("same-key-123"))));
    assert.ok(repeats.every((result) => result.status === 201));
    assert.ok(repeats.every((result) => JSON.stringify(result) === JSON.stringify(repeats[0])));
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_business")).rows[0].n, 1);
    const race = await Promise.all([
      invoke(fuel, financialRequest("cross-domain-123")),
      invoke(seasonal, financialRequest("cross-domain-123", "/seasonal")),
    ]);
    assert.deepEqual(race.map((result) => result.status).sort(), [201, 409]);
    assert.equal(race.find((result) => result.status === 409).body.code, "IDEMPOTENCY_MISMATCH");
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_business")).rows[0].n, 2);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM "mutation_receipt"')).rows[0].n, 2);
  } finally {
    prisma.$transaction = original;
    await admin.query("ROLLBACK");
    await admin.query('SET search_path TO "public"');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    admin.release();
    await pool.end();
  }
});

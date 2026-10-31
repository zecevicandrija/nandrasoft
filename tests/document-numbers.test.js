import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
import { generateOrderNumber, generateDispatchNumber, reserveDispatchNumber } from "../lib/documentNumbers.js";

test("document number formatting, independent years and manual high-water marks", async () => {
  const counters = new Map();
  let queries = 0;
  const db = { async $queryRaw(strings, prefix, value) {
    queries++;
    assert.match(strings.join("?"), /INSERT INTO "document_counter"/);
    assert.match(strings.join("?"), /ON CONFLICT/);
    const current = counters.get(prefix) || 0n;
    counters.set(prefix, value === undefined ? current + 1n : current > value ? current : value);
    return [{ lastValue: counters.get(prefix) }];
  } };
  const year = new Date(2026, 5, 1);
  assert.equal(await generateOrderNumber(db, year), "RN-2026-0001");
  assert.equal(await generateDispatchNumber(db, year), "OTP-2026-0001");
  assert.equal(await reserveDispatchNumber(db, "OTP-2026-9999"), "OTP-2026-9999");
  assert.equal(await generateDispatchNumber(db, year), "OTP-2026-10000");
  await reserveDispatchNumber(db, "OTP-2026-0005");
  assert.equal(await generateDispatchNumber(db, year), "OTP-2026-10001");
  assert.equal(await generateDispatchNumber(db, new Date(2027, 0, 1)), "OTP-2027-0001");
  assert.equal(await generateOrderNumber(db, year), "RN-2026-0002");
  const before = queries;
  assert.equal(await reserveDispatchNumber(db, "CUSTOM/123"), "CUSTOM/123");
  assert.equal(queries, before);
  await assert.rejects(reserveDispatchNumber(db, "OTP-2026-9223372036854775807"));
});

test("PostgreSQL counters seed existing numbers, serialize parallel transactions and roll back with documents", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 60000,
}, async () => {
  const schema = `nandra_numbers_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^nandra_numbers_test_[a-f0-9]{32}$/);
  const clients = [];
  const connect = async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
    clients.push(client);
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  };
  const dbFor = (client) => ({ async $queryRaw(strings, ...values) {
    const sql = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
    return (await client.query(sql, values)).rows;
  } });
  let admin;
  try {
    admin = await connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query('CREATE TABLE work_order ("orderNumber" TEXT UNIQUE NOT NULL)');
    await admin.query('CREATE TABLE onion_shipment ("dispatchNumber" TEXT UNIQUE NOT NULL)');
    await admin.query(`INSERT INTO work_order VALUES ('RN-2026-9999'), ('RN-2026-10000'), ('RN-2025-0008'), ('CUSTOM/1')`);
    await admin.query(`INSERT INTO onion_shipment VALUES ('OTP-2026-0001'), ('OTP-2026-0042'), ('CUSTOM/2')`);
    const migration = await readFile(new URL("../prisma/migrations/20261031002000_document_counters/migration.sql", import.meta.url), "utf8");
    await admin.query(migration);
    const db = dbFor(admin);
    // Deleting the most recent document cannot rewind a committed counter.
    await admin.query(`DELETE FROM work_order WHERE "orderNumber" = 'RN-2026-10000'`);
    assert.equal(await generateOrderNumber(db, new Date(2026, 5, 1)), "RN-2026-10001");
    assert.equal(await generateDispatchNumber(db, new Date(2026, 5, 1)), "OTP-2026-0043");

    const workers = await Promise.all(Array.from({ length: 6 }, connect));
    const numbers = await Promise.all(workers.map(async (client, index) => {
      const results = [];
      for (let i = 0; i < 4; i++) {
        await client.query("BEGIN");
        // Both existing and first-use counter rows must be safe across connections.
        const date = new Date(2040, 5, 1);
        const number = index % 2 === 0
          ? await generateOrderNumber(dbFor(client), date)
          : await generateDispatchNumber(dbFor(client), date);
        if (index % 2 === 0) await client.query('INSERT INTO work_order VALUES ($1)', [number]);
        else await client.query('INSERT INTO onion_shipment VALUES ($1)', [number]);
        await client.query("COMMIT");
        results.push(number);
      }
      return results;
    }));
    for (const prefix of ["RN", "OTP"]) {
      const issued = numbers.flat().filter((value) => value.startsWith(`${prefix}-`)).sort();
      assert.deepEqual(issued, Array.from({ length: 12 }, (_, i) => `${prefix}-2040-${String(i + 1).padStart(4, "0")}`));
    }

    // Counter advancement and failed document creation share the same rollback.
    await admin.query("BEGIN");
    const rolledBack = await generateOrderNumber(db, new Date(2040, 5, 1));
    await admin.query('INSERT INTO work_order VALUES ($1)', [rolledBack]);
    await admin.query("ROLLBACK");
    assert.equal(await generateOrderNumber(db, new Date(2040, 5, 1)), rolledBack);

    await admin.query("BEGIN");
    await reserveDispatchNumber(db, "OTP-2026-9999");
    await admin.query(`INSERT INTO onion_shipment VALUES ('OTP-2026-9999')`);
    await admin.query("COMMIT");
    assert.equal(await generateDispatchNumber(db, new Date(2026, 5, 1)), "OTP-2026-10000");
    await reserveDispatchNumber(db, "OTP-2026-0007");
    assert.equal(await generateDispatchNumber(db, new Date(2026, 5, 1)), "OTP-2026-10001");
    await admin.query("BEGIN");
    await reserveDispatchNumber(db, "OTP-2026-99999");
    await admin.query("ROLLBACK");
    assert.equal(await generateDispatchNumber(db, new Date(2026, 5, 1)), "OTP-2026-10002");
  } finally {
    await Promise.allSettled(clients.map((client) => client.query("ROLLBACK")));
    if (admin) {
      await admin.query('SET search_path TO "public"');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await Promise.allSettled(clients.map((client) => client.end()));
  }
});

import "dotenv/config";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import master from "../routes/masterData.js";
import onion from "../routes/onion.js";

function list(query) {
  return new Promise((resolve, reject) => master.handle({ method: "GET", url: "/machines", headers: {}, query }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("machine choices hide archived identities while managers can inspect the full catalogue", async () => {
  let role = "DIREKTOR";
  const original = prisma.machine;
  const rows = [{ id: "active", isActive: true }, { id: "archived", isActive: false }];
  prisma.machine = { async findMany({ where }) { return rows.filter((row) => where.isActive === undefined || row.isActive === where.isActive); } };
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "u", role, isActive: true }, session: {} }));
  try {
    assert.deepEqual((await list({})).body.machines.map((m) => m.id), ["active"]);
    assert.deepEqual((await list({ includeInactive: "true" })).body.machines.map((m) => m.id), ["active", "archived"]);
    role = "OPERATER";
    assert.deepEqual((await list({ includeInactive: "true" })).body.machines.map((m) => m.id), ["active"]);
  } finally { prisma.machine = original; session.mock.restore(); }
});

test("empty archived chambers and their name-only legacy entries do not reappear as active dashboard locations", async () => {
  const keys = ["onionLot", "onionStorageEntry", "onionChamber", "onionPackaging", "onionShipment", "onionWaste"];
  const originals = Object.fromEntries(keys.map((key) => [key, prisma[key]]));
  const entries = [
    { chamberId: "archived", locationOrChamber: "Old room", storageType: "HLADNJACA", currentQuantityKg: 0, chamber: { isActive: false } },
    { chamberId: null, locationOrChamber: "old room", storageType: "HLADNJACA", currentQuantityKg: 0, chamber: null },
  ];
  const before = structuredClone(entries);
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "u", role: "DIREKTOR", isActive: true }, session: {} }));
  prisma.onionLot = { async findMany() { return []; } };
  prisma.onionStorageEntry = { async findMany() { return structuredClone(entries); } };
  prisma.onionChamber = { async findMany({ where }) {
    assert.deepEqual(where, {});
    return [{ id: "archived", name: "Old room", isActive: false }];
  } };
  for (const key of ["onionPackaging", "onionShipment", "onionWaste"]) prisma[key] = { async findMany() { return []; } };
  try {
    const result = await new Promise((resolve, reject) => onion.handle({ method: "GET", url: "/dashboard", headers: {}, query: {} }, {
      statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    }, (error) => reject(error || new Error("Unhandled request"))));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.chambers, []);
    assert.deepEqual(result.body.chambersSummary, []);
    assert.equal(result.body.kpi.totalChambersCount, 0);
    assert.equal(result.body.kpi.maxColdStorageKg, 0);
    assert.deepEqual(entries, before);
  } finally {
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
    session.mock.restore();
  }
});

test("PostgreSQL migration preserves all history and forbids cascading deletion of referenced machines", {
  skip: process.env.TEST_ARCHIVE_DB !== "1",
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    // All relations are session-local. Persistent business records are untouched.
    await client.query(`CREATE TEMP TABLE machine (id text PRIMARY KEY, "isActive" boolean DEFAULT true);
      CREATE TEMP TABLE onion_chambers (id text PRIMARY KEY, name text);
      CREATE TEMP TABLE toll_entry (id text PRIMARY KEY, "machineId" text CONSTRAINT "toll_entry_machineId_fkey" REFERENCES machine(id) ON DELETE CASCADE);
      CREATE TEMP TABLE toll_top_up (id text PRIMARY KEY, "machineId" text CONSTRAINT "toll_top_up_machineId_fkey" REFERENCES machine(id) ON DELETE CASCADE);
      CREATE TEMP TABLE onion_storage_entry (id text PRIMARY KEY, "chamberId" text REFERENCES onion_chambers(id) ON DELETE RESTRICT, "currentQuantityKg" float8);
      INSERT INTO machine (id) VALUES ('m'); INSERT INTO onion_chambers VALUES ('ch','History room');
      INSERT INTO toll_entry VALUES ('toll','m'); INSERT INTO toll_top_up VALUES ('topup','m');
      INSERT INTO onion_storage_entry VALUES ('storage','ch',0)`);
    await client.query(await readFile(new URL("../prisma/migrations/20261101001000_archive_machines_and_chambers/migration.sql", import.meta.url), "utf8"));
    assert.equal((await client.query('SELECT is_active FROM onion_chambers')).rows[0].is_active, true);
    await client.query('UPDATE machine SET "isActive"=false; UPDATE onion_chambers SET is_active=false');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM toll_entry JOIN machine ON machine.id=toll_entry."machineId"')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM toll_top_up JOIN machine ON machine.id=toll_top_up."machineId"')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM onion_storage_entry JOIN onion_chambers ON onion_chambers.id=onion_storage_entry."chamberId"')).rows[0].n, 1);
    await assert.rejects(client.query("DELETE FROM machine WHERE id='m'"), (error) => error.code === "23503");
    await assert.rejects(client.query("DELETE FROM onion_chambers WHERE id='ch'"), (error) => error.code === "23503");
    assert.equal((await client.query('SELECT count(*)::int AS n FROM toll_entry')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM toll_top_up')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM onion_storage_entry')).rows[0].n, 1);
  } finally { await client.end(); }
});

test.after(async () => { await prisma.$disconnect(); });

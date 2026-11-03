import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import router from "../routes/onion.js";
import { resolveStorageChamber } from "../lib/storageChamber.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

function request(method, url, body = {}) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers: {}, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("chamber routes use the Prisma catalogue without runtime DDL or fabricated fallback records", async (t) => {
  const originals = Object.fromEntries(["onionChamber", "$transaction"].map((key) => [key, prisma[key]]));
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let chambers = [], entries = [], audit = [], failRead = false, failUpdate = false, failAudit = false;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((item) => matches(row, item));
    if (value && typeof value === "object" && "gt" in value) return row[key] > value.gt;
    return value && typeof value === "object" ? (value.not ? row[key] !== value.not : row[key].toLowerCase() === value.equals.toLowerCase()) : row[key] === value;
  });
  const catalogue = {
    async findUnique({ where }) { return structuredClone(chambers.find((row) => row.id === where.id) || null); },
    async findMany({ where = {} } = {}) { if (failRead) throw new Error("Missing table"); return structuredClone(chambers.filter((row) => matches(row, where))); },
    async findFirst({ where }) { return structuredClone(chambers.find((row) => matches(row, where)) || null); },
    async create({ data }) { const row = { isActive: true, ...data }; chambers.push(row); return structuredClone(row); },
    async update({ where, data }) { if (failUpdate) throw new Error("Update failed"); const row = chambers.find((row) => row.id === where.id); Object.assign(row, data); return structuredClone(row); },
    async delete() { throw new Error("Historical chamber identities must not be deleted"); },
  };
  prisma.onionChamber = catalogue;
  prisma.$transaction = async (callback) => {
    const snapshot = structuredClone({ chambers, entries, audit });
    try { return await callback({
      async $executeRaw(strings) { assert.ok(!/CREATE|INSERT|UPDATE|DELETE/i.test(strings.join(""))); return 1; },
      onionChamber: catalogue,
      auditLog: { async create({ data }) { if (failAudit) throw new Error("Audit failed"); audit.push(data); return data; } },
      onionLot: {
        async findUnique() { return { id: "lot", rawStockKg: 1000, storageEntries: entries.filter((row) => row.lotId === "lot") }; },
      },
      onionStorageEntry: {
        async create({ data }) { const row = { id: `entry-${entries.length}`, ...data }; entries.push(row); return structuredClone(row); },
        async findUnique({ where }) { return structuredClone(entries.find((row) => row.id === where.id) || null); },
        async update({ where, data }) { const row = entries.find((row) => row.id === where.id); Object.assign(row, data); return structuredClone(row); },
        async findMany({ where }) { return entries.filter((row) => matches(row, where)); },
        async updateMany({ where, data }) { for (const row of entries.filter((row) => row.chamberId === where.chamberId)) Object.assign(row, data); },
        async deleteMany() { throw new Error("Historical storage entries must not be deleted"); },
      },
    }); } catch (error) { chambers = snapshot.chambers; entries = snapshot.entries; audit = snapshot.audit; throw error; }
  };
  try {
    await t.test("GET returns the real catalogue, including empty, and missing tables are errors", async () => {
      assert.deepEqual(await request("GET", "/chambers"), { status: 200, body: { chambers: [] } });
      failRead = true;
      assert.equal((await request("GET", "/chambers")).status, 500);
      failRead = false;
    });
    await t.test("create and update preserve API names, enforce validation and propagate the chamber name atomically", async () => {
      const created = await request("POST", "/chambers", { name: "Cold room", maxBoxes: 100 });
      assert.equal(created.status, 201);
      assert.equal(created.body.chamber.maxCapacityKg, 110000);
      assert.equal((await request("POST", "/chambers", { name: "cold ROOM" })).status, 400);
      entries = [{ chamberId: chambers[0].id, locationOrChamber: "Cold room", currentQuantityKg: 20 }];
      failUpdate = true;
      assert.equal((await request("PUT", `/chambers/${chambers[0].id}`, { name: "New room" })).status, 500);
      assert.equal(entries[0].locationOrChamber, "Cold room");
      failUpdate = false;
      assert.equal((await request("PUT", `/chambers/${chambers[0].id}`, { hasEquipment: false })).status, 200);
      assert.equal(chambers[0].maxBoxes, 100);
      assert.equal(chambers[0].hasEquipment, false);
      assert.equal((await request("PUT", `/chambers/${chambers[0].id}`, { storageType: "INVALID" })).status, 400);
      assert.equal((await request("PUT", `/chambers/${chambers[0].id}`, { name: "New room", maxBoxes: 50 })).status, 200);
      assert.equal(entries[0].locationOrChamber, "New room");
      assert.equal(entries[0].chamberId, chambers[0].id);
      assert.equal(chambers[0].maxCapacityKg, 55000);
    });
    await t.test("renaming updates rows by chamber ID even if their cached names differ", async () => {
      const id = chambers[0].id;
      entries[0].locationOrChamber = "Old cached label";
      entries.push({ chamberId: null, locationOrChamber: "New room", currentQuantityKg: 0 });
      assert.equal((await request("PUT", `/chambers/${id}`, { name: "Final room" })).status, 200);
      assert.equal(entries[0].locationOrChamber, "Final room");
      assert.equal(entries[0].chamberId, id);
      assert.equal(entries[1].locationOrChamber, "New room");
    });
    await t.test("occupied chambers cannot be archived and empty ones keep their history when archived", async () => {
      assert.equal((await request("DELETE", `/chambers/${chambers[0].id}`)).status, 400);
      entries[0].currentQuantityKg = 0;
      assert.equal((await request("DELETE", `/chambers/${chambers[0].id}`)).status, 200);
      assert.equal(chambers.length, 1);
      assert.equal(chambers[0].isActive, false);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].chamberId, chambers[0].id);
      assert.deepEqual((await request("GET", "/chambers")).body.chambers, []);
      assert.equal((await request("POST", "/storage", { lotId: "lot", chamberId: chambers[0].id, storageType: "HLADNJACA", quantityKg: 50, boxCount: 1 })).status, 400);
      assert.equal(entries.length, 2);
    });
    await t.test("storage creation and edits keep chamber IDs even when clients send an old display name", async () => {
      const created = await request("POST", "/chambers", { name: "Storage chamber" });
      const chamberId = created.body.chamber.id;
      const result = await request("POST", "/storage", {
        lotId: "lot", chamberId, locationOrChamber: "Stale client label", storageType: "HLADNJACA", quantityKg: 50, boxCount: 1,
      });
      assert.equal(result.status, 201);
      assert.equal(result.body.entry.chamberId, chamberId);
      assert.equal(result.body.entry.locationOrChamber, "Storage chamber");
      const id = result.body.entry.id;
      const edited = await request("PUT", `/storage/${id}`, { chamberId, locationOrChamber: "Another stale label", notes: "Checked" });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.entry.locationOrChamber, "Storage chamber");
      assert.equal(edited.body.entry.chamberId, chamberId);
      const before = structuredClone(entries);
      assert.equal((await request("PUT", `/storage/${id}`, { chamberId: "missing", locationOrChamber: "Storage chamber" })).status, 400);
      assert.deepEqual(entries, before);
      const legacy = await request("POST", "/storage", { lotId: "lot", locationOrChamber: "storage CHAMBER", storageType: "HLADNJACA", quantityKg: 10, boxCount: 1 });
      assert.equal(legacy.status, 201);
      assert.equal(legacy.body.entry.chamberId, chamberId);
    });
    await t.test("name-only legacy stock blocks archival and disabling through PUT", async () => {
      const chamber = chambers.find((row) => row.isActive);
      const before = structuredClone(entries);
      entries.push({ chamberId: null, locationOrChamber: chamber.name.toLowerCase(), currentQuantityKg: 10 });
      assert.equal((await request("DELETE", `/chambers/${chamber.id}`)).status, 400);
      assert.equal((await request("PUT", `/chambers/${chamber.id}`, { isActive: false })).status, 400);
      assert.equal(chamber.isActive, true);
      entries = before;
    });
    await t.test("archival audit failure rolls back the chamber and retains all history", async () => {
      const chamber = chambers.find((row) => row.isActive);
      for (const entry of entries) entry.currentQuantityKg = 0;
      const before = structuredClone({ chambers, entries, audit });
      failAudit = true;
      assert.equal((await request("DELETE", `/chambers/${chamber.id}`)).status, 500);
      assert.deepEqual({ chambers, entries, audit }, before);
      failAudit = false;
    });
  } finally {
    session.mock.restore(); logging.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

test("storage resolves a stable chamber ID despite stale names and rejects unknown IDs", async () => {
  const chamber = { id: "stable-id", name: "Renamed chamber", storageType: "HLADNJACA", hasEquipment: true };
  const db = { onionChamber: {
    async findUnique({ where }) { return where.id === chamber.id ? chamber : null; },
    async findFirst({ where }) { return where.name.equals.toLowerCase() === chamber.name.toLowerCase() ? chamber : null; },
  } };
  assert.deepEqual(await resolveStorageChamber(db, { chamberId: "stable-id", locationOrChamber: "Old chamber name" }), {
    chamberId: "stable-id", locationOrChamber: "Renamed chamber", storageType: "HLADNJACA", hasEquipment: true,
  });
  assert.equal((await resolveStorageChamber(db, { locationOrChamber: "renamed CHAMBER" })).chamberId, "stable-id");
  await assert.rejects(resolveStorageChamber(db, { chamberId: "missing", locationOrChamber: "Renamed chamber" }));
  await assert.rejects(resolveStorageChamber(db, { chamberId: 0, locationOrChamber: "Renamed chamber" }));
  await assert.rejects(resolveStorageChamber(db, { locationOrChamber: "Old chamber name", storageType: "HLADNJACA" }));
  assert.equal((await resolveStorageChamber(db, { locationOrChamber: "Warehouse corner", storageType: "MAGACIN" })).chamberId, null);
});

test("PostgreSQL chamber migration backfills IDs and enforces referential integrity", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 30000,
}, async () => {
  const schema = `nandra_chamber_identity_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^nandra_chamber_identity_[a-f0-9]{32}$/);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE onion_chambers (id TEXT PRIMARY KEY, name TEXT UNIQUE)');
    await client.query('CREATE TABLE onion_storage_entry (id TEXT PRIMARY KEY, "locationOrChamber" TEXT)');
    await client.query(`INSERT INTO onion_chambers VALUES ('stable', 'Chamber'), ('duplicate', 'chamber')`);
    await client.query(`INSERT INTO onion_storage_entry VALUES ('one', ' CHAMBER '), ('free', 'Free location')`);
    const migration = await readFile(new URL("../prisma/migrations/20261031003000_storage_chamber_identity/migration.sql", import.meta.url), "utf8");
    await assert.rejects(client.query(migration), /Ambiguous onion chamber names/);
    await client.query("ROLLBACK");
    await client.query(`DELETE FROM onion_chambers WHERE id = 'duplicate'`);
    await client.query(migration);
    assert.deepEqual((await client.query('SELECT id, "chamberId" FROM onion_storage_entry ORDER BY id')).rows, [
      { id: "free", chamberId: null }, { id: "one", chamberId: "stable" },
    ]);
    await assert.rejects(client.query(`UPDATE onion_storage_entry SET "chamberId" = 'unknown' WHERE id = 'one'`), { code: "23503" });
    await assert.rejects(client.query(`DELETE FROM onion_chambers WHERE id = 'stable'`), { code: "23503" });
    // A late failure cannot leave the display label renamed on its own.
    await client.query("BEGIN");
    await client.query(`UPDATE onion_storage_entry SET "locationOrChamber" = 'Failed rename' WHERE "chamberId" = 'stable'`);
    await client.query(`INSERT INTO onion_chambers VALUES ('other', 'Taken')`);
    await assert.rejects(client.query(`UPDATE onion_chambers SET name = 'Taken' WHERE id = 'stable'`), { code: "23505" });
    await client.query("ROLLBACK");
    assert.equal((await client.query(`SELECT "locationOrChamber" FROM onion_storage_entry WHERE id = 'one'`)).rows[0].locationOrChamber, " CHAMBER ");
    await client.query(`UPDATE onion_chambers SET name = 'New name' WHERE id = 'stable'`);
    assert.equal((await client.query(`SELECT "chamberId" FROM onion_storage_entry WHERE id = 'one'`)).rows[0].chamberId, "stable");
  } finally {
    await client.query("ROLLBACK");
    await client.query('SET search_path TO "public"');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

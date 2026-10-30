import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import router from "../routes/onion.js";

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
  let chambers = [], entries = [], failRead = false, failUpdate = false;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((item) => matches(row, item));
    return value && typeof value === "object" ? (value.not ? row[key] !== value.not : row[key].toLowerCase() === value.equals.toLowerCase()) : row[key] === value;
  });
  const catalogue = {
    async findMany() { if (failRead) throw new Error("Missing table"); return structuredClone(chambers); },
    async findFirst({ where }) { return structuredClone(chambers.find((row) => matches(row, where)) || null); },
    async create({ data }) { chambers.push(data); return structuredClone(data); },
    async update({ where, data }) { if (failUpdate) throw new Error("Update failed"); Object.assign(chambers.find((row) => row.id === where.id), data); },
    async delete({ where }) { chambers = chambers.filter((row) => row.id !== where.id); },
  };
  prisma.onionChamber = catalogue;
  prisma.$transaction = async (callback) => {
    const snapshot = structuredClone({ chambers, entries });
    try { return await callback({
      async $executeRaw(strings) { assert.ok(!/CREATE|INSERT|UPDATE|DELETE/i.test(strings.join(""))); return 1; },
      onionChamber: catalogue,
      onionStorageEntry: {
        async findMany() { return entries.filter((row) => row.currentQuantityKg > 0); },
        async updateMany({ where, data }) { for (const row of entries.filter((row) => row.locationOrChamber === where.locationOrChamber)) Object.assign(row, data); },
        async deleteMany() { entries = []; },
      },
    }); } catch (error) { chambers = snapshot.chambers; entries = snapshot.entries; throw error; }
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
      entries = [{ locationOrChamber: "Cold room", currentQuantityKg: 20 }];
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
      assert.equal(chambers[0].maxCapacityKg, 55000);
    });
    await t.test("occupied chambers cannot be deleted and empty ones can", async () => {
      assert.equal((await request("DELETE", `/chambers/${chambers[0].id}`)).status, 400);
      entries[0].currentQuantityKg = 0;
      assert.equal((await request("DELETE", `/chambers/${chambers[0].id}`)).status, 200);
      assert.equal(chambers.length, 0);
    });
  } finally {
    session.mock.restore(); logging.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

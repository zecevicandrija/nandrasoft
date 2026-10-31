import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import masterData from "../routes/masterData.js";

function request(query = {}) {
  return new Promise((resolve, reject) => {
    masterData.handle({ method: "GET", url: "/workers", headers: {}, query }, {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
    }, (error) => reject(error || new Error("Unhandled request")));
  });
}

test("master worker lists protect private details using the authenticated role", async (t) => {
  let user = { id: "viewer", role: "OPERATER", isActive: true };
  const session = mock.method(auth.api, "getSession", async () => user ? { user, session: {} } : null);
  const originalWorker = prisma.worker;
  const rows = [
    { id: "one", name: "Test Worker", role: "MEHANICAR", type: "STALNI", isActive: true },
    { id: "two", name: "Linked Worker", role: null, type: "STALNI", isActive: false },
    { id: "three", name: "Seasonal Worker", role: null, type: "SEZONAC", isActive: true },
    { id: "four", name: "Unlinked Worker", role: null, type: "STALNI", isActive: true },
  ].map((row, index) => ({
    ...row, jmbg: "test-private-id", phone: "test-private-phone", dailyWage: 4000,
    hourlyRate: 500, city: "Private City", userId: index < 2 ? `user-${index}` : null,
    user: index < 2 ? { id: `user-${index}`, email: "private@example.test", role: "MAGACIN" } : null,
    futurePrivateField: "must not leak",
  }));
  let query;
  let reads = 0;
  prisma.worker = { async findMany(args) { query = args; reads++; return rows; } };
  try {
    await t.test("all non-manager roles receive only lookup fields, even with privilege query parameters", async () => {
      for (const role of ["OPERATER", "SEZONAC", "MAGACIN", "MEHANICAR", "UNKNOWN", undefined]) {
        user.role = role;
        const response = await request({ role: "DIREKTOR", includePrivate: "true" });
        assert.equal(response.status, 200);
        assert.deepEqual(query.select, {
          id: true, name: true, role: true, type: true, isActive: true,
          user: { select: { role: true } },
        });
        assert.equal(query.include, undefined);
        assert.deepEqual(response.data.workers, rows.map((row, index) => ({
          id: row.id, name: row.name, type: row.type, isActive: row.isActive,
          role: ["MEHANICAR", "MAGACIN", "SEZONAC", "OPERATER"][index],
        })));
      }
    });
    await t.test("director and manager retain private details and effective roles", async () => {
      for (const role of ["DIREKTOR", "RUKOVODILAC"]) {
        user.role = role;
        const response = await request();
        assert.equal(response.status, 200);
        assert.deepEqual(query.include, { user: { select: { id: true, email: true, role: true } } });
        assert.equal(response.data.workers[0].jmbg, rows[0].jmbg);
        assert.equal(response.data.workers[0].phone, rows[0].phone);
        assert.equal(response.data.workers[0].dailyWage, 4000);
        assert.equal(response.data.workers[0].hourlyRate, 500);
        assert.equal(response.data.workers[1].role, "MAGACIN");
      }
    });
    await t.test("unauthenticated and inactive users cannot read worker records", async () => {
      const before = reads;
      user = null;
      assert.equal((await request()).status, 401);
      user = { id: "inactive", role: "DIREKTOR", isActive: false };
      assert.equal((await request()).status, 403);
      assert.equal(reads, before);
    });
  } finally {
    session.mock.restore();
    prisma.worker = originalWorker;
  }
});

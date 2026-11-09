import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import masterRouter from "../routes/masterData.js";

function request(method, url, body = {}) {
  return new Promise((resolve, reject) => masterRouter.handle({ method, url, body, headers: {}, query: {} }, {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, data }); },
  }, error => reject(error || new Error("Unhandled request"))));
}

test("contractor catalogue supports CRUD, validates input, and restricts writes to managers", async () => {
  let user = { id: "manager", role: "RUKOVODILAC", isActive: true };
  const session = mock.method(auth.api, "getSession", async () => ({ user, session: {} }));
  const original = prisma.contractor;
  let rows = [];
  let referenced = false;
  prisma.contractor = {
    async findMany() { return rows; },
    async create({ data }) {
      if (rows.some(row => row.code === data.code)) throw { code: "P2002" };
      const row = { id: "contractor-a", ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }) {
      const row = rows.find(row => row.id === where.id);
      if (!row) throw { code: "P2025" };
      Object.assign(row, data);
      return row;
    },
    async delete({ where }) {
      if (referenced) throw { code: "P2003" };
      rows = rows.filter(row => row.id !== where.id);
    },
  };
  try {
    assert.equal((await request("POST", "/contractors", { code: " ", name: "Test" })).status, 400);
    const created = await request("POST", "/contractors", { code: " K-01 ", name: " Kooperant A ", phone: "123" });
    assert.equal(created.status, 201);
    assert.equal(created.data.contractor.code, "K-01");
    assert.equal((await request("POST", "/contractors", { code: "K-01", name: "Duplikat" })).status, 409);
    assert.equal((await request("PUT", "/contractors/contractor-a", { name: "Novi naziv" })).data.contractor.name, "Novi naziv");
    assert.equal((await request("PUT", "/contractors/missing", { name: "Novi naziv" })).status, 404);
    referenced = true;
    assert.equal((await request("DELETE", "/contractors/contractor-a")).status, 409);
    user.role = "OPERATER";
    assert.equal((await request("GET", "/contractors")).data.contractors.length, 1);
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal((await request(method, method === "POST" ? "/contractors" : "/contractors/contractor-a", { code: "K-02", name: "Test" })).status, 403);
    }
    user.role = "DIREKTOR";
    referenced = false;
    assert.equal((await request("DELETE", "/contractors/contractor-a")).status, 200);
    assert.equal((await request("GET", "/contractors")).data.contractors.length, 0);
  } finally {
    prisma.contractor = original;
    session.mock.restore();
  }
});

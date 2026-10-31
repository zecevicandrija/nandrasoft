import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import fertilizerRouter from "../routes/fertilizer.js";

function request(router, method, url, body = {}, headers = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      body,
      headers,
      query,
      user: null,
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: this.statusCode, data });
      },
    };
    router.handle(req, res, (error) => reject(error || new Error("Unhandled request")));
  });
}

test("fertilizer GET /products is purely read-only and never writes phantom inventory", async (t) => {
  let user = { id: "u-direktor", role: "DIREKTOR", isActive: true, name: "Direktor" };
  mock.method(auth.api, "getSession", async () => ({ user, session: {} }));

  const productsInDb = [];
  const movementsInDb = [];
  let writeAttempted = false;

  const originalFindMany = prisma.fertilizerProduct.findMany;
  const originalCount = prisma.fertilizerProduct.count;
  const originalCreateMany = prisma.fertilizerProduct.createMany;
  const originalCreate = prisma.fertilizerProduct.create;
  const originalMovementsFindMany = prisma.fertilizerMovement.findMany;

  t.after(() => {
    prisma.fertilizerProduct.findMany = originalFindMany;
    prisma.fertilizerProduct.count = originalCount;
    prisma.fertilizerProduct.createMany = originalCreateMany;
    prisma.fertilizerProduct.create = originalCreate;
    prisma.fertilizerMovement.findMany = originalMovementsFindMany;
  });

  prisma.fertilizerProduct.findMany = async () => [...productsInDb];
  prisma.fertilizerMovement.findMany = async () => [...movementsInDb];
  prisma.fertilizerProduct.count = async () => productsInDb.length;
  prisma.fertilizerProduct.createMany = async () => {
    writeAttempted = true;
    throw new Error("MUTATION_FORBIDDEN_ON_READ: createMany must not be called during GET");
  };
  prisma.fertilizerProduct.create = async () => {
    writeAttempted = true;
    throw new Error("MUTATION_FORBIDDEN_ON_READ: create must not be called during GET");
  };

  // 1. GET /products on empty database
  const res = await request(fertilizerRouter, "GET", "/products");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.products, []);
  assert.equal(res.data.stats.totalProducts, 0);
  assert.equal(res.data.stats.totalStockKg, 0);
  assert.equal(writeAttempted, false, "GET /products must not attempt any database writes");

  // 2. GET /products with an existing product
  productsInDb.push({
    id: "prod-1",
    name: "NPK 16:16:16",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 0,
    minStockWarning: 500,
    defaultPricePerUnit: 68,
    defaultLocation: "Magacin 1",
    description: "Complex fertilizer",
    isActive: true,
    _count: { movements: 0 },
  });

  const res2 = await request(fertilizerRouter, "GET", "/products");
  assert.equal(res2.status, 200);
  assert.equal(res2.data.products.length, 1);
  assert.equal(res2.data.products[0].name, "NPK 16:16:16");
  assert.equal(res2.data.products[0].currentStock, 0);
  assert.equal(res2.data.stats.totalProducts, 1);
  assert.equal(writeAttempted, false, "GET /products remained read-only when returning products");
});

test("POST /seed-catalog initializes products with 0 stock and rejects when not empty", async (t) => {
  let user = { id: "u-direktor", role: "DIREKTOR", isActive: true, name: "Direktor" };
  mock.method(auth.api, "getSession", async () => ({ user, session: {} }));

  const catalog = [];
  const originalFindMany = prisma.fertilizerProduct.findMany;
  const originalCount = prisma.fertilizerProduct.count;
  const originalCreateMany = prisma.fertilizerProduct.createMany;
  const originalTx = prisma.$transaction;
  const originalExec = prisma.$executeRaw;

  t.after(() => {
    prisma.fertilizerProduct.findMany = originalFindMany;
    prisma.fertilizerProduct.count = originalCount;
    prisma.fertilizerProduct.createMany = originalCreateMany;
    prisma.$transaction = originalTx;
    prisma.$executeRaw = originalExec;
  });

  prisma.$transaction = async (callback) => callback(prisma);
  prisma.$executeRaw = async () => 1;
  prisma.fertilizerProduct.count = async () => catalog.length;
  prisma.fertilizerProduct.createMany = async ({ data }) => {
    for (const item of data) {
      assert.equal(item.currentStock, 0, "Seed catalog must initialize currentStock to 0");
      catalog.push(item);
    }
    return { count: data.length };
  };

  // 1. Direktor može pokrenuti seed na praznoj bazi
  const res1 = await request(fertilizerRouter, "POST", "/seed-catalog");
  assert.equal(res1.status, 200);
  assert.equal(res1.data.count, 5);
  assert.equal(catalog.length, 5);

  // 2. Ponovni seed na nepraznoj bazi se odbija
  const res2 = await request(fertilizerRouter, "POST", "/seed-catalog");
  assert.equal(res2.status, 400);
  assert.match(res2.data.error, /nije prazan/);
});


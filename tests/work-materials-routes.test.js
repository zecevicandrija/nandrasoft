import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { auth } from "../routes/auth.js";
import { prisma } from "../lib/prisma.js";
import materialsRouter from "../routes/materials.js";
import ordersRouter from "../routes/workOrders.js";
import fieldRouter from "../routes/fieldWork.js";
import { materialsInclude } from "../lib/workMaterials.js";

function request(router, method, url, body = {}, query = {}) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, query, headers: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, data }); },
  }, error => reject(error || new Error("Unhandled request"))));
}

test("material catalogue routes enforce permissions, bounded searches, and archive rather than delete", async () => {
  let user = { id: "manager", role: "RUKOVODILAC", isActive: true };
  const session = mock.method(auth.api, "getSession", async () => ({ user, session: {} }));
  const original = prisma.chemicalProduct;
  const raw = prisma.$queryRaw;
  let writes = 0, reads = 0;
  prisma.chemicalProduct = {
    async create({ data }) { writes++; return { id: "chemical", ...data }; },
    async update({ data }) { writes++; return { id: "chemical", ...data }; },
  };
  prisma.$queryRaw = async sql => { reads++; assert.ok(sql.values.includes(11)); return []; };
  try {
    assert.equal((await request(materialsRouter, "GET", "/search/CHEMICAL", {}, { q: "a" })).status, 200);
    assert.equal(reads, 0);
    assert.equal((await request(materialsRouter, "GET", "/search/CHEMICAL", {}, { q: "test", limit: 100 })).status, 400);
    assert.equal((await request(materialsRouter, "GET", "/search/CHEMICAL", {}, { q: "test" })).status, 200);
    assert.equal(reads, 1);
    assert.equal((await request(materialsRouter, "GET", "/catalogue/SEED", {}, { cursor: "invalid" })).status, 400);
    assert.equal((await request(materialsRouter, "POST", "/catalogue/CHEMICAL", { code: "C-01", name: "Preparat", unit: "L" })).status, 201);
    assert.equal((await request(materialsRouter, "POST", "/catalogue/CHEMICAL", { code: "", name: "Bad", unit: "L" })).status, 400);
    assert.equal((await request(materialsRouter, "POST", "/catalogue/constructor", {})).status, 400);
    assert.equal((await request(materialsRouter, "PUT", "/catalogue/CHEMICAL/chemical", { isActive: false })).data.product.isActive, false);
    assert.equal(writes, 2);
    user.role = "OPERATER";
    assert.equal((await request(materialsRouter, "POST", "/catalogue/SEED", {})).status, 403);
    assert.equal((await request(materialsRouter, "PUT", "/catalogue/CHEMICAL/chemical", {})).status, 403);
    assert.equal(writes, 2);
  } finally { session.mock.restore(); prisma.chemicalProduct = original; prisma.$queryRaw = raw; }
});

test("PostgreSQL work-order and field-work routes save, transfer, replace and clear real material rows atomically", { skip: process.env.TEST_MATERIAL_DB !== "1", timeout: 30000 }, async () => {
  const suffix = randomUUID();
  const transaction = prisma.$transaction;
  const rollback = new Error("ROLLBACK_MATERIAL_FIXTURES");
  let session;
  try {
    await assert.rejects(transaction.call(prisma, async tx => {
      const actor = await tx.user.create({ data: { name: "Material test", email: `${suffix}@material.example.test`, role: "DIREKTOR" } });
      const worker = await tx.worker.create({ data: { name: "Material test worker" } });
      const machine = await tx.machine.create({ data: { name: "Material test tractor", type: "TRAKTOR" } });
      const parcel = await tx.parcel.create({ data: { code: suffix, name: "Material test parcel", areaHa: 10 } });
      const workType = await tx.workType.create({ data: { name: suffix, category: "ZASTITA", materialKind: "CHEMICAL" } });
      const chemical = await tx.chemicalProduct.create({ data: { code: suffix, name: "Original name", unit: "L" } });
      session = mock.method(auth.api, "getSession", async () => ({ user: actor, session: {} }));
      prisma.$transaction = async callback => callback(tx);
      const material = { kind: "CHEMICAL", productId: chemical.id, dosePerHa: 1.5, notes: "Plan" };
      const response = await request(ordersRouter, "POST", "/", { orderDate: "2026-11-04", orderType: "RAD_NJIVA", workerId: worker.id,
        machineId: machine.id, parcelId: parcel.id, workTypeId: workType.id, materials: [material] });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      const order = response.data.workOrder;
      assert.equal(order.materials[0].name, "Original name");
      assert.equal(order.materials[0].dosePerHa, 1.5);
      // Catalogue edits preserve both the planned snapshot and inherited actual snapshot.
      await tx.chemicalProduct.update({ where: { id: chemical.id }, data: { name: "Renamed product", unit: "ML", isActive: false } });
      const workResponse = await request(fieldRouter, "POST", "/", { workOrderId: order.id, machineId: machine.id,
        parcelId: parcel.id, workerId: worker.id, workTypeId: workType.id, areaDoneHa: 1, status: "U_TOKU", autoAssignMachine: false });
      assert.equal(workResponse.status, 201, JSON.stringify(workResponse.data));
      const work = workResponse.data.work;
      assert.equal(work.materials[0].name, "Original name");
      assert.equal(work.materials[0].unit, "L");
      const changed = await request(fieldRouter, "PUT", `/${work.id}`, { materials: [{ ...material, dosePerHa: 2, notes: "Stvarno utrošeno" }] });
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal(changed.data.work.materials[0].dosePerHa, 2);
      assert.equal((await tx.workOrder.findUnique({ where: { id: order.id }, include: { materials: materialsInclude } })).materials[0].dosePerHa, 1.5);
      const cleared = await request(ordersRouter, "PUT", `/${order.id}`, { materials: [] });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
      assert.equal(cleared.data.workOrder.materials.length, 0);
      assert.equal(await tx.workMaterial.count({ where: { fieldWorkId: work.id } }), 1);
      assert.equal((await request(fieldRouter, "PUT", `/${work.id}`, { materials: [] })).status, 200);
      assert.equal(await tx.workMaterial.count({ where: { fieldWorkId: work.id } }), 0);
      await tx.workType.update({ where: { id: workType.id }, data: { materialRequired: true } });
      assert.equal((await request(ordersRouter, "POST", "/", { orderDate: "2026-11-04", workerId: worker.id, workTypeId: workType.id })).status, 400);
      assert.equal(await tx.workOrder.count({ where: { issuedById: actor.id } }), 1);
      throw rollback;
    }, { timeout: 20000 }), error => error === rollback);
  } finally {
    prisma.$transaction = transaction;
    session?.mock.restore();
    await prisma.$disconnect();
  }
});

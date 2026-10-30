import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { inventoryMutation } from "../lib/inventoryTransaction.js";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import fertilizer from "../routes/fertilizer.js";
import onion from "../routes/onion.js";
import tolls from "../routes/tolls.js";
import fuel from "../routes/fuel.js";

function request(router, path, body, method = "POST") {
  return new Promise((resolve, reject) => router.handle({ method, url: path, body, headers: {}, query: {} }, {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("inventory mutations serialize reads and roll back failed operations", async (t) => {
  const originalTransaction = prisma.$transaction;
  const sessionMock = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logMock = mock.method(console, "error", () => {});
  let state;
  let tail = Promise.resolve();
  let acquired = false;
  let failAudit = false;
  const reset = () => {
    state = { product: { id: "p", name: "Test", currentStock: 100, unit: "KG", minStockWarning: 0 },
      lot: { id: "lot", lotNumber: "LOT-TEST", sortedQualityKg: 100, packagedStockKg: 0 },
      machine: { id: "machine", name: "Truck", type: "KAMION", status: "SLOBODNA", tankCapacityLiters: 100, currentFuelLiters: 0, enpTagBalance: 1000 },
      movements: [], packagings: [], shipments: [], tolls: [], topups: [], fuel: [], audit: [] };
    failAudit = false;
  };
  const read = (value) => { assert.equal(acquired, true, "stock read must occur after the database lock"); return structuredClone(value); };
  const patch = (target, data) => {
    for (const [key, value] of Object.entries(data)) {
      target[key] = value && typeof value === "object" && "increment" in value ? (target[key] || 0) + value.increment
        : value && typeof value === "object" && "decrement" in value ? (target[key] || 0) - value.decrement : value;
    }
    return structuredClone(target);
  };
  const create = (list, data) => { const row = { id: `${list.length}`, ...data }; list.push(row); return structuredClone(row); };
  prisma.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, "ReadCommitted");
    // Emulate the PostgreSQL transaction lock for offline controller tests.
    const previous = tail;
    let unlock;
    tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone(state);
    acquired = false;
    const tx = {
      async $executeRaw(strings) {
        if (strings.join("").includes("pg_advisory_xact_lock")) acquired = true;
        return 1;
      },
      fertilizerProduct: { async findUnique() { return read(state.product); }, async update({ data }) { return patch(state.product, data); } },
      fertilizerMovement: {
        async create({ data }) { return create(state.movements, data); },
        async findUnique({ where }) {
          const row = state.movements.find((m) => m.id === where.id);
          return row ? read({ ...row, product: state.product }) : null;
        },
        async update({ where, data }) { return patch(state.movements.find((m) => m.id === where.id), data); },
        async delete({ where }) { const index = state.movements.findIndex((m) => m.id === where.id); return state.movements.splice(index, 1)[0]; },
      },
      onionLot: {
        async findUnique() { return read({ ...state.lot, packagings: state.packagings }); },
        async update({ data }) { return patch(state.lot, data); },
      },
      onionPackaging: {
        async create({ data }) { return create(state.packagings, data); },
        async findUnique() { return read({ ...state.packagings[0], lot: state.lot }); },
        async update({ data }) { return patch(state.packagings[0], data); },
      },
      onionShipment: {
        async count() { return state.shipments.length; }, async findUnique() { return null; },
        async create({ data }) { return { ...create(state.shipments, data), buyer: { name: "Buyer" } }; },
      },
      partner: { async findUnique() { return { id: "buyer", name: "Buyer" }; } },
      machine: { async findUnique() { return read(state.machine); }, async update({ data }) { return patch(state.machine, data); } },
      worker: { async findUnique() { return { id: "worker", isActive: true }; } },
      tollEntry: { async create({ data }) { return create(state.tolls, data); } },
      tollTopUp: { async create({ data }) { return create(state.topups, data); } },
      fuelEntry: { async create({ data }) { return create(state.fuel, data); } },
      fieldWork: { async findFirst() { return null; } },
      auditLog: { async create({ data }) { if (failAudit) throw new Error("Audit failure"); return create(state.audit, data); } },
    };
    try { return await callback(tx); } catch (error) { state = snapshot; throw error; }
    finally { acquired = false; unlock(); }
  };
  try {
    await t.test("two withdrawals of 70 cannot both consume a stock of 100", async () => {
      reset();
      const body = { productId: "p", movementType: "OTPIS_KOREKCIJA", quantity: 70 };
      const results = await Promise.all([request(fertilizer, "/issue", body), request(fertilizer, "/issue", body)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
      assert.equal(state.product.currentStock, 30);
      assert.equal(state.movements.length, 1);
    });
    await t.test("simultaneous returns both increase stock without losing a movement", async () => {
      reset();
      const body = { productId: "p", movementType: "POVRAT_SA_NJIVE", quantity: 20 };
      const results = await Promise.all([request(fertilizer, "/issue", body), request(fertilizer, "/issue", body)]);
      assert.deepEqual(results.map((r) => r.status), [201, 201]);
      assert.equal(state.product.currentStock, 140);
      assert.equal(state.movements.length, 2);
    });
    await t.test("two packaging requests cannot reserve the same sorted onion stock", async () => {
      reset();
      const body = { lotId: "lot", packageType: "DZAK_10KG", unitWeightKg: 10, packageCount: 7 };
      const results = await Promise.all([request(onion, "/packaging", body), request(onion, "/packaging", body)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
      assert.equal(state.packagings.length, 1);
      assert.equal(state.lot.packagedStockKg, 70);
    });
    await t.test("two shipments cannot sell the same packages", async () => {
      reset(); state.lot.rawStockKg = 0; state.lot.shippedKg = 0; state.lot.packagedStockKg = 100;
      state.packagings.push({ id: "pack", lotId: "lot", packageCount: 10, availableCount: 10, unitWeightKg: 10, totalWeightKg: 100, availableWeightKg: 100 });
      const body = { packagingId: "pack", buyerId: "buyer", packageCount: 7 };
      const results = await Promise.all([request(onion, "/shipment", body), request(onion, "/shipment", body)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
      assert.equal(state.packagings[0].availableCount, 3);
      assert.equal(state.lot.packagedStockKg, 30);
      assert.equal(state.lot.shippedKg, 70);
    });
    await t.test("editing a return twice does not apply the same stock difference twice", async () => {
      reset(); state.movements.push({ id: "movement", movementType: "POVRAT_SA_NJIVE", quantity: 20 });
      const results = await Promise.all([
        request(fertilizer, "/movements/movement", { quantity: 40 }, "PUT"),
        request(fertilizer, "/movements/movement", { quantity: 40 }, "PUT"),
      ]);
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      assert.equal(state.product.currentStock, 120);
      assert.equal(state.movements[0].quantity, 40);
    });
    await t.test("a movement deleted twice restores stock only once", async () => {
      reset(); state.movements.push({ id: "movement", movementType: "IZDAVANJE_NJIVA", quantity: 20 });
      const results = await Promise.all([
        request(fertilizer, "/movements/movement", {}, "DELETE"),
        request(fertilizer, "/movements/movement", {}, "DELETE"),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
      assert.equal(state.product.currentStock, 120);
    });
    await t.test("concurrent toll payments and topups preserve the complete balance change", async () => {
      reset();
      const payment = { machineId: "machine", workerId: "worker", paymentMethod: "ENP_TAG", amount: 100 };
      const results = await Promise.all([
        request(tolls, "/", payment), request(tolls, "/", payment),
        request(tolls, "/top-up", { machineId: "machine", amount: 50 }),
      ]);
      assert.ok(results.every((r) => r.status === 201), JSON.stringify(results));
      assert.equal(state.machine.enpTagBalance, 850);
      assert.equal(state.tolls.length, 2);
      assert.equal(state.topups.length, 1);
    });
    await t.test("concurrent fueling cannot overfill a shared machine tank", async () => {
      reset();
      const body = { machineId: "machine", workerId: "worker", fuelSource: "PUMPA", gasStation: "PETROL", liters: 70, totalCost: 10000 };
      const results = await Promise.all([request(fuel, "/entries", body), request(fuel, "/entries", body)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
      assert.equal(state.machine.currentFuelLiters, 70);
      assert.equal(state.fuel.length, 1);
    });
    await t.test("caught audit errors still roll back stock and business entries", async () => {
      reset(); failAudit = true;
      const result = await request(fertilizer, "/issue", { productId: "p", movementType: "OTPIS_KOREKCIJA", quantity: 70 });
      assert.equal(result.status, 500);
      assert.equal(state.product.currentStock, 100);
      assert.equal(state.movements.length, 0);
    });
    await t.test("a failed commit cannot send a premature success response", async () => {
      const saved = prisma.$transaction;
      prisma.$transaction = async (callback) => {
        await callback({ async $executeRaw() { return 1; } });
        throw Object.assign(new Error("Commit conflict"), { code: "P2034" });
      };
      let notified = false;
      const handler = inventoryMutation("fuel", async (req, res, tx) => {
        tx.$afterCommit(() => { notified = true; });
        res.status(201).json({ ok: true });
      });
      let result;
      await handler({}, { status(status) { result = { status }; return this; }, json(body) { result.body = body; } });
      assert.equal(result.status, 409);
      assert.equal(result.body.ok, undefined);
      assert.equal(notified, false);
      prisma.$transaction = saved;
    });
  } finally {
    prisma.$transaction = originalTransaction;
    sessionMock.mock.restore(); logMock.mock.restore();
  }
});

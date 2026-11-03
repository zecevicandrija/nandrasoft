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
  const originalWorkerLookup = prisma.worker.findUnique;
  prisma.worker.findUnique = async () => ({ id: "worker", isActive: true });
  const originalTransaction = prisma.$transaction;
  const sessionMock = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logMock = mock.method(console, "error", () => {});
  let state;
  let tail = Promise.resolve();
  let acquired = false;
  let failAudit = false;
  let failShipment = false;
  let failWaste = false;
  const reset = () => {
    state = { product: { id: "p", name: "Test", currentStock: 100, unit: "KG", minStockWarning: 0 },
      lot: { id: "lot", lotNumber: "LOT-TEST", sortedQualityKg: 100, packagedStockKg: 0 },
      machine: { id: "machine", name: "Truck", type: "KAMION", status: "SLOBODNA", tankCapacityLiters: 100, currentFuelLiters: 0, enpTagBalance: 1000 },
      movements: [], packagings: [], shipments: [], tolls: [], topups: [], fuel: [], audit: [], counters: {}, storages: [], wastes: [] };
    failAudit = false;
    failShipment = false;
    failWaste = false;
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
      async $queryRaw(strings, prefix, value) {
        assert.equal(acquired, true);
        state.counters[prefix] = value === undefined
          ? (state.counters[prefix] || 0n) + 1n
          : (state.counters[prefix] || 0n) > value ? state.counters[prefix] : value;
        return [{ lastValue: state.counters[prefix] }];
      },
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
        async findUnique() { return read({ ...state.lot, packagings: state.packagings,
          storageEntries: state.storages.filter((row) => row.lotId === state.lot.id && row.currentQuantityKg > 0) }); },
        async update({ data }) { return patch(state.lot, data); },
      },
      onionPackaging: {
        async aggregate() { return read({ _sum: {
          totalWeightKg: state.packagings.reduce((sum, p) => sum + p.totalWeightKg, 0),
          availableWeightKg: state.packagings.reduce((sum, p) => sum + p.availableWeightKg, 0),
        } }); },
        async create({ data }) { return create(state.packagings, data); },
        async findUnique() { return read({ ...state.packagings[0], lot: state.lot }); },
        async update({ data }) { return patch(state.packagings[0], data); },
      },
      onionShipment: {
        async count() { return state.shipments.length; }, async findUnique() { return null; },
        async create({ data }) {
          if (failShipment) throw new Error("Shipment write failed");
          if (state.shipments.some((row) => row.dispatchNumber === data.dispatchNumber)) throw new Error("Duplicate dispatch number");
          return { ...create(state.shipments, data), buyer: { name: "Buyer" } };
        },
      },
      onionStorageEntry: {
        async findUnique({ where }) { return read(state.storages.find((row) => row.id === where.id) || null); },
        async update({ where, data }) { return patch(state.storages.find((row) => row.id === where.id), data); },
      },
      onionWaste: { async create({ data }) {
        if (failWaste) throw new Error("Waste write failed");
        return create(state.wastes, data);
      } },
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
    const wasteStock = (raw = 100, stored = [40, 60]) => {
      reset(); state.lot.rawStockKg = raw; state.lot.totalWasteKg = 0;
      state.storages = stored.map((quantity, index) => ({ id: `storage-${index}`, lotId: "lot", locationOrChamber: `Chamber ${index}`, currentQuantityKg: quantity }));
    };
    const wasteBody = { lotId: "lot", reason: "KALO_SUSENJE" };
    await t.test("waste requires a positive finite numeric quantity", async () => {
      for (const quantityKg of [-1, 0, Infinity, NaN, true, [], {}, "", " ", "abc"]) {
        wasteStock(); const before = structuredClone(state);
        assert.equal((await request(onion, "/waste", { ...wasteBody, quantityKg })).status, 400);
        assert.deepEqual(state, before);
      }
    });
    await t.test("waste exceeding lot stock is rejected without changing locations or booking a loss", async () => {
      for (const storageEntryId of [undefined, "storage-0"]) {
        wasteStock(); const before = structuredClone(state);
        const result = await request(onion, "/waste", { ...wasteBody, storageEntryId, quantityKg: 1000 });
        assert.equal(result.status, 400);
        assert.deepEqual(state, before);
      }
    });
    await t.test("selected location limits and ownership are checked independently of total lot stock", async () => {
      wasteStock();
      for (const [storageEntryId, quantityKg] of [["storage-0", 40.001], ["missing", 1]]) {
        const before = structuredClone(state);
        assert.equal((await request(onion, "/waste", { ...wasteBody, storageEntryId, quantityKg })).status, 400);
        assert.deepEqual(state, before);
      }
      state.storages[0].lotId = "other-lot";
      const before = structuredClone(state);
      assert.equal((await request(onion, "/waste", { ...wasteBody, storageEntryId: "storage-0", quantityKg: 10 })).status, 400);
      assert.deepEqual(state, before);
    });
    await t.test("exact-stock FIFO waste books exactly the amount deducted", async () => {
      wasteStock();
      assert.equal((await request(onion, "/waste", { ...wasteBody, quantityKg: 100 })).status, 201);
      assert.equal(state.lot.rawStockKg, 0);
      assert.equal(state.lot.totalWasteKg, 100);
      assert.equal(state.wastes[0].quantityKg, 100);
      assert.deepEqual(state.storages.map((row) => row.currentQuantityKg), [0, 0]);
    });
    await t.test("unstored raw stock remains available, including lots without storage entries", async () => {
      for (const stored of [[], [40, 30]]) {
        wasteStock(100, stored);
        assert.equal((await request(onion, "/waste", { ...wasteBody, quantityKg: 90 })).status, 201);
        assert.equal(state.lot.rawStockKg, 10);
        assert.equal(state.lot.totalWasteKg, 90);
        assert.ok(state.storages.every((row) => row.currentQuantityKg === 0));
      }
      wasteStock(100, []); const before = structuredClone(state);
      assert.equal((await request(onion, "/waste", { ...wasteBody, quantityKg: 101 })).status, 400);
      assert.deepEqual(state, before);
    });
    await t.test("inconsistent lot/location stock cannot be hidden by a waste entry", async () => {
      wasteStock(50, [100]); const before = structuredClone(state);
      assert.equal((await request(onion, "/waste", { ...wasteBody, quantityKg: 10 })).status, 400);
      assert.deepEqual(state, before);
    });
    await t.test("parallel waste requests cannot consume the same stock twice", async () => {
      wasteStock();
      const results = await Promise.all([request(onion, "/waste", { ...wasteBody, quantityKg: 70 }), request(onion, "/waste", { ...wasteBody, quantityKg: 70 })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
      assert.equal(state.wastes.length, 1);
      assert.equal(state.lot.rawStockKg, 30);
      assert.equal(state.lot.totalWasteKg, 70);
    });
    await t.test("a failed waste write rolls back prior FIFO deductions", async () => {
      wasteStock(); failWaste = true; const before = structuredClone(state);
      assert.equal((await request(onion, "/waste", { ...wasteBody, quantityKg: 70 })).status, 400);
      assert.deepEqual(state, before);
    });
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
    const shipmentStock = () => {
      reset(); state.lot.rawStockKg = 0; state.lot.shippedKg = 0; state.lot.packagedStockKg = 200;
      state.packagings.push({ id: "pack", lotId: "lot", packageCount: 20, availableCount: 20, unitWeightKg: 10, totalWeightKg: 200, availableWeightKg: 200 });
    };
    const shipmentBody = { packagingId: "pack", buyerId: "buyer", packageCount: 1, date: "2026-10-31" };
    await t.test("parallel shipments with enough stock receive distinct automatic numbers", async () => {
      shipmentStock();
      const results = await Promise.all([request(onion, "/shipment", shipmentBody), request(onion, "/shipment", shipmentBody)]);
      assert.deepEqual(results.map((result) => result.status), [201, 201]);
      assert.deepEqual(state.shipments.map((row) => row.dispatchNumber), ["OTP-2026-0001", "OTP-2026-0002"]);
    });
    await t.test("manual dispatch numbers advance the automatic counter and duplicates roll back stock", async () => {
      shipmentStock();
      assert.equal((await request(onion, "/shipment", { ...shipmentBody, dispatchNumber: " otp-2026-9999 " })).status, 201);
      assert.equal((await request(onion, "/shipment", shipmentBody)).status, 201);
      assert.deepEqual(state.shipments.map((row) => row.dispatchNumber), ["OTP-2026-9999", "OTP-2026-10000"]);
      const before = structuredClone(state);
      assert.equal((await request(onion, "/shipment", { ...shipmentBody, dispatchNumber: "OTP-2026-9999" })).status, 400);
      assert.deepEqual(state, before);
    });
    await t.test("failed shipment creation rolls back both its stock and number allocation", async () => {
      shipmentStock();
      const before = structuredClone(state);
      failShipment = true;
      assert.equal((await request(onion, "/shipment", shipmentBody)).status, 400);
      assert.deepEqual(state, before);
      failShipment = false;
      assert.equal((await request(onion, "/shipment", shipmentBody)).status, 201);
      assert.equal(state.shipments[0].dispatchNumber, "OTP-2026-0001");
    });
    await t.test("failed shipment audit rolls back shipment, stock and allocated number", async () => {
      shipmentStock(); failAudit = true;
      const before = structuredClone(state);
      assert.equal((await request(onion, "/shipment", shipmentBody)).status, 400);
      assert.deepEqual(state, before);
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
    prisma.worker.findUnique = originalWorkerLookup;
    sessionMock.mock.restore(); logMock.mock.restore();
  }
});

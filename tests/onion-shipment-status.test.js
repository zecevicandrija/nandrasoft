import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import router from "../routes/onion.js";

const copy = (value) => structuredClone(value);
function request(method, url, body = {}) {
  return new Promise((resolve, reject) => router.handle({ method, url, body, headers: {}, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("individual onion deliveries remain complete while LOT stock is processed in multiple turas", async (t) => {
  const originalTransaction = prisma.$transaction, originalLot = prisma.onionLot;
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let state, failAudit;
  const reset = () => {
    failAudit = false;
    state = {
      lot: { id: "lot", lotNumber: "LOT-TEST", status: "NA_STANJU", initialQuantityKg: 5000, rawStockKg: 5000,
        sortedQualityKg: 0, sortedSmallKg: 0, sortedWasteKg: 0, totalWasteKg: 0, packagedStockKg: 0, shippedKg: 0 },
      packagings: [], shipments: [], sortings: [], audit: [], counters: {},
    };
  };
  const parcel = { id: "p", code: "P01", name: "Field", fieldWorks: [], fertilizerMovements: [] };
  const traceLot = () => copy({ ...state.lot, parcel, packagings: state.packagings, shipments: state.shipments,
    sortings: state.sortings, harvestArrivals: [], storageEntries: [], wastes: [] });
  prisma.onionLot = { async findFirst() { return traceLot(); } };
  const update = (row, data) => { Object.assign(row, data); return copy(row); };
  prisma.$transaction = async (callback) => {
    const before = copy(state);
    const tx = {
      async $executeRaw() { return 1; },
      async $queryRaw(strings, prefix) {
        state.counters[prefix] = (state.counters[prefix] || 0n) + 1n;
        return [{ lastValue: state.counters[prefix] }];
      },
      onionLot: {
        async findUnique() { return copy({ ...state.lot, packagings: state.packagings, storageEntries: [] }); },
        async update({ data }) { return update(state.lot, data); },
      },
      onionSorting: { async create({ data }) {
        const row = { id: `sort-${state.sortings.length}`, createdAt: new Date(), ...data }; state.sortings.push(row); return copy(row);
      } },
      onionPackaging: {
        async findUnique({ where }) { const row = state.packagings.find((p) => p.id === where.id); return row ? copy({ ...row, lot: state.lot }) : null; },
        async create({ data }) { const row = { id: `pack-${state.packagings.length}`, createdAt: new Date(), ...data }; state.packagings.push(row); return copy(row); },
        async update({ where, data }) { return update(state.packagings.find((p) => p.id === where.id), data); },
        async aggregate() { return { _sum: {
          totalWeightKg: state.packagings.reduce((sum, p) => sum + p.totalWeightKg, 0),
          availableWeightKg: state.packagings.reduce((sum, p) => sum + p.availableWeightKg, 0),
        } }; },
      },
      partner: { async findUnique() { return { id: "buyer", name: "Buyer" }; } },
      onionShipment: { async create({ data }) {
        const row = { ...data, id: `shipment-${state.shipments.length}`, createdAt: new Date(), buyer: { id: "buyer", name: "Buyer" },
          items: data.items.create.map((item) => ({ ...item, packaging: state.packagings.find((p) => p.id === item.packagingId) })) };
        state.shipments.push(copy(row)); return copy(row);
      } },
      auditLog: { async create({ data }) { if (failAudit) throw new Error("Audit failed"); state.audit.push(copy(data)); return data; } },
    };
    try { return await callback(tx); } catch (error) { state = before; throw error; }
  };
  const sort = (kg) => request("POST", "/sorting", { lotId: "lot", inputQuantityKg: kg, qualityQuantityKg: kg });
  const pack = (kg) => request("POST", "/packaging", { lotId: "lot", packageType: "DZAK_5KG", unitWeightKg: 5, packageCount: kg / 5 });
  const ship = (id, count = 800) => request("POST", "/shipment", { packagingId: id, buyerId: "buyer", packageCount: count });
  const trace = () => request("GET", "/traceability/LOT-TEST");
  const seedPacked = () => {
    reset();
    state.lot.rawStockKg = 0; state.lot.sortedQualityKg = 4000; state.lot.packagedStockKg = 4000;
    state.packagings.push({ id: "pack", lotId: "lot", packageCount: 800, unitWeightKg: 5, totalWeightKg: 4000, availableCount: 800, availableWeightKg: 4000 });
  };
  try {
    await t.test("5000 kg can be sorted, packaged and shipped first as 4000 kg then as 1000 kg", async () => {
      reset();
      assert.equal((await sort(4000)).status, 201);
      const firstPack = await pack(4000);
      assert.equal(firstPack.status, 201);
      assert.equal((await ship(firstPack.body.packaging.id)).status, 201);
      assert.equal(state.lot.rawStockKg, 1000);
      assert.equal(state.lot.status, "U_OBRADI");
      const firstTrace = await trace();
      assert.equal(firstTrace.status, 200);
      assert.equal(firstTrace.body.turas.length, 1);
      assert.equal(firstTrace.body.turas[0].status, "ISPORUCEN");
      assert.equal(firstTrace.body.turas[0].weightKg, 4000);

      assert.equal((await sort(1000)).status, 201);
      const secondPack = await pack(1000);
      assert.equal(secondPack.status, 201);
      const waiting = (await trace()).body;
      assert.deepEqual(waiting.turas.map((tura) => tura.status), ["ISPORUCEN", "SPAKOVANO"]);
      assert.equal(waiting.lot.status, "U_OBRADI");
      assert.equal((await ship(secondPack.body.packaging.id, 200)).status, 201);
      assert.equal(state.lot.status, "ISPORUCEN");
      assert.equal(state.lot.shippedKg, 5000);
      assert.equal(state.lot.packagedStockKg, 0);
      const final = (await trace()).body;
      assert.deepEqual(final.turas.map((tura) => tura.weightKg), [4000, 1000]);
      assert.ok(final.turas.every((tura) => tura.status === "ISPORUCEN"));
    });
    await t.test("unpacked I-class onion keeps the LOT active after the current tura is fully delivered", async () => {
      seedPacked(); state.lot.sortedQualityKg = 5000;
      assert.equal((await ship("pack")).status, 201);
      assert.equal(state.lot.packagedStockKg, 0);
      assert.equal(state.lot.status, "U_OBRADI");
    });
    await t.test("small onion is stock and prevents premature LOT completion", async () => {
      seedPacked(); state.lot.sortedSmallKg = 100;
      assert.equal((await ship("pack")).status, 201);
      assert.equal(state.lot.status, "U_OBRADI");
    });
    await t.test("other packages are checked from their records even if the cached LOT balance is stale", async () => {
      seedPacked(); state.lot.sortedQualityKg = 5000;
      state.packagings.push({ id: "other", lotId: "lot", totalWeightKg: 1000, availableWeightKg: 1000 });
      assert.equal((await ship("pack")).status, 201);
      assert.equal(state.lot.packagedStockKg, 1000);
      assert.equal(state.lot.status, "U_OBRADI");
    });
    await t.test("small residual quantities and inconsistent negative balances cannot masquerade as zero", async () => {
      for (const quality of [4000.05, 3900]) {
        seedPacked(); state.lot.sortedQualityKg = quality;
        assert.equal((await ship("pack")).status, 201);
        assert.equal(state.lot.status, "U_OBRADI");
      }
    });
    await t.test("a partial dispatch creates one delivered tura and a separate remaining packaged tura", async () => {
      seedPacked();
      assert.equal((await ship("pack", 600)).status, 201);
      assert.equal(state.lot.status, "U_OBRADI");
      const result = (await trace()).body;
      assert.deepEqual(result.turas.map((tura) => [tura.status, tura.weightKg]), [["ISPORUCEN", 3000], ["SPAKOVANO", 1000]]);
    });
    await t.test("failure to audit the final dispatch rolls back its shipment, status and stock", async () => {
      seedPacked(); failAudit = true; const before = copy(state);
      assert.equal((await ship("pack")).status, 400);
      assert.deepEqual(state, before);
    });
  } finally {
    prisma.$transaction = originalTransaction; prisma.onionLot = originalLot;
    session.mock.restore(); logging.mock.restore();
  }
});

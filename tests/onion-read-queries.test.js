import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import router from "../routes/onion.js";

function request(method, url, query = {}) {
  return new Promise((resolve, reject) =>
    router.handle(
      { method, url, body: {}, headers: {}, query },
      {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); },
      },
      (error) => reject(error || new Error("Unhandled request"))
    )
  );
}

test("onion read endpoints return plannedLotNumber on work-orders and aggregate lookup/dashboard without redundant full scans", async (t) => {
  const keys = [
    "workOrder",
    "onionLot",
    "onionStorageEntry",
    "onionPackaging",
    "onionShipment",
    "onionWaste",
    "onionChamber",
    "parcel",
    "machine",
    "worker",
    "partner",
  ];
  const originals = Object.fromEntries(keys.map((key) => [key, prisma[key]]));
  const session = mock.method(auth.api, "getSession", async () => ({
    user: { id: "mag-1", name: "Magacioner", role: "MAGACIN", isActive: true },
    session: {},
  }));
  const logMock = mock.method(console, "error", () => {});

  try {
    await t.test("GET /work-orders enriches packing orders with plannedLotNumber without calling lookup", async () => {
      prisma.workOrder = {
        async count() { return 2; },
        async findMany() {
          return [
            {
              id: "wo-1",
              orderNumber: "RN-2026-0101",
              orderDate: new Date("2026-11-20T00:00:00Z"),
              orderType: "PAKOVANJE",
              status: "DODELJEN",
              priority: "NORMALNO",
              shift: "PRVA",
              workerId: "w-1",
              worker: { id: "w-1", name: "Petar" },
              issuedBy: { id: "dir-1", name: "Direktor", role: "DIREKTOR" },
              packingPlan: { entryMode: "both", packagingForm: { lotId: "lot-1", sourceName: "Komora 1" } },
            },
            {
              id: "wo-2",
              orderNumber: "RN-2026-0102",
              orderDate: new Date("2026-11-19T00:00:00Z"),
              orderType: "PAKOVANJE",
              status: "ZAVRSEN",
              priority: "NORMALNO",
              shift: "PRVA",
              workerId: "w-1",
              worker: { id: "w-1", name: "Petar" },
              issuedBy: { id: "dir-1", name: "Direktor", role: "DIREKTOR" },
              packingPlan: {
                entryMode: "packaging",
                packagingForm: { lotId: "lot-2" },
                execution: { plannedLotNumber: "LOT-EXEC-2", lotNumber: "LOT-EXEC-2", entryMode: "packaging", actorName: "Petar" },
              },
            },
          ];
        },
      };
      let capturedWhere = null;
      prisma.onionLot = {
        async findMany({ where }) {
          capturedWhere = where;
          return [{ id: "lot-1", lotNumber: "LOT-20261120-P01-01" }];
        },
      };

      const res = await request("GET", "/work-orders", { page: "1" });
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 2);
      assert.deepEqual(capturedWhere, { id: { in: ["lot-1", "lot-2"] } });
      assert.equal(res.body.orders[0].plannedLotNumber, "LOT-20261120-P01-01");
      assert.equal(res.body.orders[1].plannedLotNumber, "LOT-EXEC-2");
    });

    await t.test("GET /lookup reads onionLot only once and aggregates packed totals via groupBy", async () => {
      let lotFindManyCalls = 0;
      let lotIncludeArg = null;
      prisma.parcel = { async findMany() { return [{ id: "p1", code: "P01", name: "Parcela 1", areaHa: 10 }]; } };
      prisma.machine = { async findMany() { return [{ id: "m1", name: "Kamion", regNumber: "NS-123" }]; } };
      prisma.worker = { async findMany() { return [{ id: "w1", name: "Marko", role: "MAGACIN" }]; } };
      prisma.partner = { async findMany() { return [{ id: "b1", name: "Kupac 1", pib: "123" }]; } };
      prisma.onionChamber = {
        async findMany() {
          return [{ id: "ch1", name: "Komora 1", storageType: "HLADNJACA", hasEquipment: true, maxBoxes: 720, maxCapacityKg: 792000, isActive: true }];
        },
      };
      prisma.onionLot = {
        async findMany(args) {
          lotFindManyCalls += 1;
          lotIncludeArg = args.include;
          return [
            {
              id: "lot-active",
              lotNumber: "LOT-1",
              status: "U_OBRADI",
              rawStockKg: 5000,
              sortedQualityKg: 2000,
              parcel: { id: "p1", code: "P01", name: "Parcela 1", areaHa: 10 },
              storageEntries: [{ id: "s1", chamberId: "ch1", locationOrChamber: "Komora 1", storageType: "HLADNJACA", currentQuantityKg: 3500 }],
            },
            {
              id: "lot-done",
              lotNumber: "LOT-2",
              status: "ISPORUCEN",
              rawStockKg: 0,
              sortedQualityKg: 1000,
              parcel: { id: "p1", code: "P01", name: "Parcela 1", areaHa: 10 },
              storageEntries: [],
            },
          ];
        },
      };
      prisma.onionPackaging = {
        async groupBy() {
          return [
            { lotId: "lot-active", _sum: { totalWeightKg: 600 } },
            { lotId: "lot-done", _sum: { totalWeightKg: 1000 } },
          ];
        },
        async findMany() { return []; },
      };

      const res = await request("GET", "/lookup");
      assert.equal(res.status, 200);
      assert.equal(lotFindManyCalls, 1, "onionLot must only be queried once");
      assert.deepEqual(lotIncludeArg.storageEntries.where, { currentQuantityKg: { gt: 0 } });
      assert.equal(lotIncludeArg.packagings, undefined, "lookup must not hydrate all packaging rows per lot");
      assert.equal(res.body.allLots.length, 2);
      assert.equal(res.body.activeLots.length, 1);
      assert.equal(res.body.activeLots[0].id, "lot-active");
      assert.equal(res.body.activeLots[0].unpackedQualityKg, 1400);
      assert.equal(res.body.activeLots[0].storedRawKg, 3500);
      assert.equal(res.body.activeLots[0].unstoredRawKg, 1500);
    });

    await t.test("GET /dashboard computes KPIs, chamber summaries and pallets using database aggregations", async () => {
      prisma.onionLot = {
        async groupBy() {
          return [
            {
              status: "U_OBRADI",
              _count: { _all: 2 },
              _sum: { initialQuantityKg: 10000, rawStockKg: 4000, sortedQualityKg: 5000, sortedSmallKg: 400, sortedWasteKg: 300, totalWasteKg: 500 },
            },
            {
              status: "ISPORUCEN",
              _count: { _all: 1 },
              _sum: { initialQuantityKg: 5000, rawStockKg: 0, sortedQualityKg: 4500, sortedSmallKg: 200, sortedWasteKg: 100, totalWasteKg: 100 },
            },
          ];
        },
      };
      prisma.onionStorageEntry = {
        async findMany({ where }) {
          assert.deepEqual(where, { currentQuantityKg: { gt: 0 } });
          return [
            {
              id: "se-1",
              chamberId: "ch1",
              storageType: "HLADNJACA",
              locationOrChamber: "Komora 1",
              hasEquipment: true,
              quantityKg: 5500,
              currentQuantityKg: 3300,
              boxCount: 5,
              temperatureC: 1.5,
              humidityPercent: 72,
              chamber: { isActive: true },
              lot: { id: "lot-1", lotNumber: "LOT-1", parcel: { code: "P01", name: "Parcela 1" } },
            },
          ];
        },
        async groupBy() {
          return [{ chamberId: "ch1", storageType: "HLADNJACA", locationOrChamber: "Komora 1", _sum: { quantityKg: 9500 } }];
        },
      };
      prisma.onionPackaging = {
        async groupBy() {
          return [
            { packageType: "DZAK_10KG", _sum: { totalWeightKg: 6000, packageCount: 600, availableWeightKg: 2000, availableCount: 200 } },
            { packageType: "DZAK_5KG", _sum: { totalWeightKg: 1000, packageCount: 200, availableWeightKg: 1000, availableCount: 200 } },
          ];
        },
        async findMany({ where }) {
          assert.deepEqual(where, { availableCount: { gt: 0 } });
          return [
            { packageType: "DZAK_10KG", availableCount: 200, packageCount: 200, palletsCount: 2 },
            { packageType: "DZAK_5KG", availableCount: 200, packageCount: 200, palletsCount: 1 },
          ];
        },
      };
      prisma.onionShipment = {
        async aggregate() {
          return { _sum: { totalWeightKg: 4000, totalPackagesCount: 400, totalValue: 240000.5 } };
        },
      };
      prisma.onionWaste = {
        async aggregate() {
          return { _sum: { quantityKg: 200 } };
        },
      };
      prisma.onionChamber = {
        async findMany() {
          return [{ id: "ch1", name: "Komora 1", storageType: "HLADNJACA", hasEquipment: true, maxBoxes: 720, maxCapacityKg: 792000, isActive: true }];
        },
      };

      const res = await request("GET", "/dashboard");
      assert.equal(res.status, 200);
      assert.equal(res.body.kpi.totalHarvestedKg, 15000);
      assert.equal(res.body.kpi.totalRawStockKg, 4000);
      assert.equal(res.body.kpi.inColdStorageKg, 3300);
      assert.equal(res.body.kpi.unallocatedRawKg, 700);
      assert.equal(res.body.kpi.totalSortedQualityKg, 9500);
      assert.equal(res.body.kpi.unpackedQualityKg, 2500);
      assert.equal(res.body.kpi.packagedStockKg, 3000);
      assert.equal(res.body.kpi.packagedPackagesCount, 400);
      assert.equal(res.body.kpi.packagedPalletsCount, 3);
      assert.equal(res.body.kpi.shippedKg, 4000);
      assert.equal(res.body.kpi.shippedTotalValue, 240000.5);
      assert.equal(res.body.kpi.explicitWasteKg, 200);
      assert.equal(res.body.kpi.totalWasteKg, 600);
      assert.equal(res.body.kpi.activeLotsCount, 2);
      assert.equal(res.body.kpi.totalLotsCount, 3);
      assert.equal(res.body.chambersSummary[0].totalEnteredKg, 9500);
      assert.equal(res.body.chambersSummary[0].currentQuantityKg, 3300);
      assert.equal(res.body.chambersSummary[0].lotsCount, 1);
    });
  } finally {
    session.mock.restore();
    logMock.mock.restore();
    for (const [key, value] of Object.entries(originals)) prisma[key] = value;
  }
});

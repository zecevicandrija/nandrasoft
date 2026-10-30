import assert from "node:assert/strict";
import { test } from "node:test";
import { auditInventory } from "../scripts/audit-inventory.js";

test("inventory audit distinguishes unexplained balances and does not write business data", async () => {
  const product = { id: "p", name: "Product", unit: "KG", currentStock: 30,
    movements: [{ movementType: "PRIJEM_NABAVKA", quantity: 100 }, { movementType: "IZDAVANJE_NJIVA", quantity: 70 }] };
  const lot = { id: "lot", lotNumber: "LOT", initialQuantityKg: 200, rawStockKg: 80,
    sortedQualityKg: 80, sortedSmallKg: 10, sortedWasteKg: 10, packagedStockKg: 30, shippedKg: 10, totalWasteKg: 30,
    harvestArrivals: [{ quantityKg: 200 }], sortings: [{ inputQuantityKg: 100, qualityQuantityKg: 80, smallQuantityKg: 10, wasteQuantityKg: 10 }],
    wastes: [{ quantityKg: 20 }], shipments: [{ totalWeightKg: 10 }],
    packagings: [{ packageCount: 4, availableCount: 3, totalWeightKg: 40, availableWeightKg: 30,
      shipmentItems: [{ packageCount: 1, totalWeightKg: 10 }] }] };
  const machine = { id: "machine", name: "Truck", enpTagBalance: 850, currentFuelLiters: 10, tankCapacityLiters: 100,
    tollTopUps: [{ amount: 1000 }], tollEntries: [{ amount: 150 }] };
  // Only read methods exist. Any accidental mutation makes this test fail.
  const db = {
    fertilizerProduct: { async findMany() { return [product]; } },
    onionLot: { async findMany() { return [lot]; } },
    machine: { async findMany() { return [machine]; } },
    fuelSupply: { async aggregate() { return { _sum: { liters: 100 } }; } },
    fuelEntry: { async aggregate() { return { _sum: { liters: 40 } }; } },
  };
  const clean = await auditInventory(db);
  assert.equal(clean.businessDataChanged, false);
  assert.equal(clean.summary.fertilizerFlagged, 0);
  assert.equal(clean.summary.onionFlagged, 0);
  assert.equal(clean.summary.enpFlagged, 0);
  assert.equal(clean.fuel.ledgerCisternLiters, 60);
  lot.rawStockKg = 99;
  product.currentStock = 130;
  machine.enpTagBalance = 950;
  const flagged = await auditInventory(db);
  assert.equal(flagged.fertilizer[0].unexplainedOpeningOrDifference, 100);
  assert.equal(flagged.enp[0].unexplainedOpeningOrDifference, 100);
  assert.deepEqual(flagged.onion[0].differences, [{ field: "rawStockKg", stored: 99, ledger: 80, difference: 19 }]);
  assert.match(flagged.limitation, /opening balances/);
  assert.equal(lot.rawStockKg, 99);
});

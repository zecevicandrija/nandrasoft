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

test("onion stock edits preserve source quantities, shipments and chamber limits", async (t) => {
  const original = prisma.$transaction;
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", name: "Manager", role: "DIREKTOR", isActive: true }, session: {} }));
  const logging = mock.method(console, "error", () => {});
  let state, tail = Promise.resolve(), locked = false, failAudit = false;
  const reset = () => {
    failAudit = false;
    state = {
      order: { id: "order", orderNumber: "RN-1", orderType: "PAKOVANJE", status: "DODELJEN", updatedAt: new Date("2026-11-19T12:00:00Z"),
        packingPlan: { entryMode: "packaging", packagingForm: { lotId: "lot" } } },
      messages: [], notices: [], sortings: [], proposal: { workOrderId: "order", version: 1 },
      lot: { id: "lot", lotNumber: "LOT-20261029-P01-01", status: "U_OBRADI", rawStockKg: 800000, initialQuantityKg: 820000, sortedQualityKg: 18000, sortedSmallKg: 0, totalWasteKg: 0, sortedWasteKg: 0, packagedStockKg: 10000, shippedKg: 8000 },
      packagings: [
        { id: "five", lotId: "lot", packageType: "DZAK_5KG", unitWeightKg: 5, packageCount: 800, totalWeightKg: 4000, availableCount: 800, availableWeightKg: 4000, palletsCount: 4, packerCount: 4 },
        { id: "ten", lotId: "lot", packageType: "DZAK_10KG", unitWeightKg: 10, packageCount: 1400, totalWeightKg: 14000, availableCount: 600, availableWeightKg: 6000, palletsCount: 14, packerCount: 4 },
      ],
      shipmentItems: [{ packagingId: "ten", packageCount: 800, totalWeightKg: 8000 }],
      storages: [{ id: "storage", lotId: "lot", chamberId: "ch", locationOrChamber: "Komora 1", storageType: "HLADNJACA", hasEquipment: true, boxCount: 720, quantityKg: 820000, currentQuantityKg: 800000 }],
      chambers: [
        { id: "ch", name: "Komora 1", maxBoxes: 720, maxCapacityKg: 792000, storageType: "HLADNJACA", hasEquipment: true },
        { id: "other-ch", name: "Komora 2", maxBoxes: 720, maxCapacityKg: 792000, storageType: "HLADNJACA", hasEquipment: false },
      ], audit: [], arrivals: [],
    };
  };
  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((item) => matches(row, item));
      if (value && typeof value === "object") {
        if ("not" in value) return row[key] !== value.not;
        if ("gt" in value) return row[key] > value.gt;
        if ("lte" in value) return row[key] <= value.lte;
        if ("equals" in value) return row[key]?.toLowerCase() === value.equals.toLowerCase();
      }
      return row[key] === value;
    });
  }
  const read = (value) => { assert.equal(locked, true); return copy(value); };
  const update = (target, data) => {
    assert.equal(locked, true);
    for (const [key, value] of Object.entries(data)) target[key] = value && typeof value === "object" && "increment" in value ? target[key] + value.increment : value;
    return copy(target);
  };
  prisma.$transaction = async (callback) => {
    const previous = tail; let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const before = copy(state);
    const tx = {
      async $executeRaw(strings) { if (strings.join("").includes("pg_advisory_xact_lock")) locked = true; return 1; },
      directorMessage: { async create({ data }) { state.messages.push(data); return { id: "message" }; } },
      directorNotification: { async createMany({ data }) { state.notices.push(...data); } },
      user: { async findMany() { return [{ id: "another-director" }]; } },
      workOrderProposal: { async updateMany({ data }) { update(state.proposal, data); } },
      workOrder: { async findUnique() { return read(state.order); }, async updateMany({ where, data }) {
        const order = state.order;
        if (where.id !== order.id || (where.orderType && where.orderType !== order.orderType) || !(where.status.in ?? [where.status]).includes(order.status) ||
            where.updatedAt.getTime() !== order.updatedAt.getTime()) return { count: 0 };
        update(order, data);
        return { count: 1 };
      } },
      onionLot: {
        async findUnique({ where }) { return where.id === "planned" ? read({ lotNumber: "LOT-A" }) : read({ ...state.lot, packagings: state.packagings, storageEntries: state.storages.filter((row) => row.lotId === "lot") }); },
        async update({ data }) { return update(state.lot, data); },
      },
      onionPackaging: {
        async delete({ where }) { state.packagings = state.packagings.filter(p => p.id !== where.id); },
        async findUnique({ where }) {
          const row = state.packagings.find((row) => row.id === where.id);
          return read(row ? { ...row, lot: { ...state.lot, packagings: state.packagings }, shipmentItems: state.shipmentItems.filter((item) => item.packagingId === row.id) } : null);
        },
        async update({ where, data }) { return update(state.packagings.find((row) => row.id === where.id), data); },
        async create({ data }) { const row = { id: "new-pack", ...data }; state.packagings.push(row); return read(row); },
      },
      onionStorageEntry: {
        async findUnique({ where }) { return read(state.storages.find((row) => row.id === where.id) || null); },
        async findMany({ where }) { return read(state.storages.filter((row) => matches(row, where))); },
        async update({ where, data }) { return update(state.storages.find((row) => row.id === where.id), data); },
        async create({ data }) { const row = { id: `storage-${state.storages.length}`, ...data }; state.storages.push(row); return read(row); },
      },
      onionSorting: {
        async create({ data }) { const row = { ...data, id: "new-sort" }; state.sortings.push(row); return read(row); },
        async findUnique({ where }) { const row = state.sortings.find(s => s.id === where.id); return read(row ? { ...row, packaging: state.packagings.find(p => p.sortingId === row.id) } : null); },
        async delete({ where }) { state.sortings = state.sortings.filter(s => s.id !== where.id); },
      },
      onionChamber: {
        async findUnique({ where }) { return read(state.chambers.find((row) => row.id === where.id) || null); },
        async findFirst({ where }) { return read(state.chambers.find((row) => matches(row, where)) || null); },
      },
      parcel: { async findUnique() { return read({ id: "parcel", code: "P01" }); } },
      onionHarvestArrival: { async create({ data }) { const row = { id: "arrival", ...data }; state.arrivals.push(row); return read(row); } },
      auditLog: { async findFirst({ where }) {
        return read(state.audit.find(event => event.entityType === where.entityType &&
          (!where.entityId || event.entityId === where.entityId) && (!where.description || event.description === where.description) &&
          (!where.newValues || event.newValues?.entryId === where.newValues.equals)));
      },
        async create({ data }) { if (failAudit) throw new Error("Audit failed"); state.audit.push(copy(data)); return data; } },
    };
    try { return await callback(tx); }
    catch (error) { state = before; throw error; }
    finally { locked = false; release(); }
  };
  async function rejectsWithoutChanges(method, url, body, expected = 400) {
    const before = copy(state);
    const response = await request(method, url, body);
    assert.equal(response.status, expected, JSON.stringify(response));
    assert.deepEqual(state, before);
    return response;
  }
  const editStorage = (data) => request("PUT", "/storage/storage", data);
  try {
    await t.test("a warehouse confirmation completes its order exactly once and rolls back a stale or invalid entry", async () => {
      reset();
      const body = { lotId: "lot", packageCount: 10, unitWeightKg: 10, workOrderId: "order", orderUpdatedAt: state.order.updatedAt.toISOString() };
      await rejectsWithoutChanges("POST", "/packaging", body);
      state.lot.sortedQualityKg += 1000;
      await rejectsWithoutChanges("POST", "/packaging", { ...body, orderUpdatedAt: "2026-11-18T12:00:00.000Z" });
      const results = await Promise.all([request("POST", "/packaging", body), request("POST", "/packaging", body)]);
      assert.deepEqual(results.map(result => result.status).sort(), [201, 400]);
      assert.equal(state.order.status, "ZAVRSEN");
      assert.equal(state.packagings.length, 3);
      assert.equal(state.lot.packagedStockKg, 10100);
      assert.equal(state.order.packingPlan.execution.lotNumber, state.lot.lotNumber);
      assert.equal(state.messages.length, 0);
    });
    await t.test("a changed LOT or operation records the actual entry and notifies directors once", async () => {
      for (const [lotId, entryMode] of [["planned", "packaging"], ["lot", "both"]]) {
        reset();
        state.order.packingPlan = { entryMode, packagingForm: { lotId } };
        state.lot.sortedQualityKg += 1000;
        const body = { lotId: "lot", packageCount: 10, unitWeightKg: 10, workOrderId: "order", orderUpdatedAt: state.order.updatedAt.toISOString() };
        assert.equal((await request("POST", "/packaging", body)).status, 201);
        await rejectsWithoutChanges("POST", "/packaging", body);
        const plan = state.order.packingPlan;
        assert.equal(plan.packagingForm.lotId, lotId);
        assert.equal(plan.execution.lotNumber, state.lot.lotNumber);
        assert.equal(plan.execution.entryMode, "packaging");
        assert.equal(state.messages.length, 1);
        assert.ok(state.messages[0].body.includes(lotId === "planned" ? "LOT-A" : "sortiranje i pakovanje"));
        assert.deepEqual(state.notices.map(n => [n.userId, n.messageId]), [["another-director", "message"]]);
      }
    });
    await t.test("warehouse reversal restores the LOT and chamber for each mode and preserves the selected order outcome", async () => {
      for (const mode of ["sorting", "both", "packaging"]) {
        reset();
        state.order.packingPlan.entryMode = mode;
        state.lot.sortedQualityKg += 100;
        const before = copy(state.lot);
        const updatedAt = state.order.updatedAt.toISOString();
        const sort = { inputQuantityKg: 120, qualityQuantityKg: 100, smallQuantityKg: 10, wasteQuantityKg: 8, plevaKg: 2 };
        const body = { lotId: "lot", workOrderId: "order", orderUpdatedAt: updatedAt, packageCount: 10, unitWeightKg: 10 };
        const made = mode === "sorting" ? await request("POST", "/sorting", { ...body, ...sort }) :
          await request("POST", "/packaging", { ...body, sorting: mode === "both" ? sort : undefined });
        assert.equal(made.status, 201, JSON.stringify(made.body));
        const reversal = { updatedAt, reason: "Pogrešan unos", action: mode === "both" ? "cancel" : "reopen" };
        const url = "/work-orders/order/reverse";
        if (mode === "sorting") {
          state.lot.sortedQualityKg -= 101;
          await rejectsWithoutChanges("POST", url, reversal, 409);
          state.lot.sortedQualityKg += 101;
        } else {
          state.shipmentItems.push({ packagingId: "new-pack", shipment: { dispatchNumber: "OTP-123" } });
          const blocked = await rejectsWithoutChanges("POST", url, reversal, 409);
          assert.match(blocked.body.error, /OTP-123/);
          state.shipmentItems.pop();
          const linked = await rejectsWithoutChanges("DELETE", "/packaging/new-pack", {}, 409);
          assert.equal(linked.body.order.id, "order");
        }
        failAudit = true;
        await rejectsWithoutChanges("POST", url, reversal, 500);
        failAudit = false;
        const result = await request("POST", url, reversal);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(state.lot, before);
        assert.equal(state.storages[0].currentQuantityKg, 800000);
        assert.equal(state.packagings.length, 2);
        assert.equal(state.sortings.length, 0);
        assert.equal(state.order.status, mode === "both" ? "OTKAZAN" : "DODELJEN");
        assert.equal(state.proposal.workOrderId, mode === "both" ? null : "order");
        assert.equal(state.audit.at(-1).context.reason, reversal.reason);
        await rejectsWithoutChanges("POST", url, reversal, 409);
      }
    });
    await t.test("legacy cancellation restores 4000 kg over the chamber weight limit only with an unambiguous source", async () => {
      reset();
      state.lot.rawStockKg = 792000;
      state.lot.initialQuantityKg = 800000;
      Object.assign(state.storages[0], { quantityKg: 800000, currentQuantityKg: 792000, createdAt: new Date("2026-10-29") });
      state.order.status = "ZAVRSEN";
      state.order.packingPlan.entryMode = "both";
      state.sortings.push({ id: "legacy-sort", lotId: "lot", createdAt: new Date("2026-11-19"), inputQuantityKg: 4000,
        qualityQuantityKg: 3500, smallQuantityKg: 200, wasteQuantityKg: 250, plevaKg: 50 });
      state.lot.sortedSmallKg = 200;
      state.lot.sortedWasteKg = state.lot.totalWasteKg = 300;
      state.packagings[0].sortingId = "legacy-sort";
      state.audit.push({ entityType: "WorkOrder", entityId: "order", description: "Radni nalog završen potvrdom unosa u magacinu", newValues: { entryId: "five" } });
      const url = "/work-orders/order/reverse";
      const input = { action: "cancel", reason: "Pogrešan unos", updatedAt: state.order.updatedAt.toISOString() };
      state.storages.push({ ...state.storages[0], id: "another" });
      await rejectsWithoutChanges("POST", url, input, 409);
      state.storages.pop();
      const result = await request("POST", url, input);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(state.storages[0].currentQuantityKg, 796000);
      assert.equal(state.lot.rawStockKg, 796000);
      assert.equal(state.order.status, "OTKAZAN");
      assert.equal(state.chambers[0].maxCapacityKg, 792000);
    });
    await t.test("selected chamber groups its storage rows and cannot consume raw stock from another chamber", async () => {
      reset();
      state.storages.push(...[60, 80].map((currentQuantityKg, i) => ({ ...state.storages[0],
        id: "ch2-row-" + i, chamberId: "other-ch", locationOrChamber: "Komora 2", currentQuantityKg })));
      const body = { lotId: "lot", sourceKey: "id:other-ch", inputQuantityKg: 150, qualityQuantityKg: 150 };
      await rejectsWithoutChanges("POST", "/sorting", body);
      const result = await request("POST", "/sorting", { ...body, inputQuantityKg: 100, qualityQuantityKg: 100 });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.deepEqual(state.storages.map(row => row.currentQuantityKg), [800000, 0, 40]);
      assert.deepEqual(result.body.storageDeductions, [{ id: "ch2-row-0", kg: 60 }, { id: "ch2-row-1", kg: 40 }]);
    });
    await t.test("160 bags can use two partially filled pallets with no packer count", async () => {
      reset();
      state.lot.sortedQualityKg += 1600;
      const created = await request("POST", "/packaging", { lotId: "lot", packageCount: 160, unitWeightKg: 10, palletsCount: 2 });
      assert.equal(created.status, 201);
      assert.equal(created.body.packaging.totalWeightKg, 1600);
      assert.equal(created.body.packaging.palletsCount, 2);
      assert.equal(created.body.packaging.packerCount, null);
      assert.equal((await request("PUT", "/packaging/new-pack", { packageCount: 150, packerCount: 3 })).status, 200);
      assert.equal(state.packagings.at(-1).palletsCount, 2);
      assert.equal((await request("PUT", "/packaging/new-pack", { palletsCount: 4, packerCount: null })).status, 200);
      assert.equal(state.packagings.at(-1).totalWeightKg, 1500);
      assert.equal(state.packagings.at(-1).packerCount, null);
    });
    await t.test("the reported 800 to 1000 bags change cannot create another tonne", async () => {
      reset();
      const result = await rejectsWithoutChanges("PUT", "/packaging/five", { packageCount: 1000, palletsCount: 4 });
      assert.match(result.body.error, /4000 kg/);
    });
    await t.test("all packed quantities count, including 8 tonnes already shipped", async () => {
      reset();
      await rejectsWithoutChanges("PUT", "/packaging/five", { packageCount: 2400 });
    });
    await t.test("available sorted stock permits exact-limit increases and preserves the entered physical pallet count", async () => {
      reset(); state.lot.sortedQualityKg = 19000;
      assert.equal((await request("PUT", "/packaging/five", { packageCount: "1000", palletsCount: 4 })).status, 200);
      assert.equal(state.packagings[0].totalWeightKg, 5000);
      assert.equal(state.packagings[0].availableWeightKg, 5000);
      assert.equal(state.packagings[0].palletsCount, 4);
      assert.equal(state.lot.packagedStockKg, 11000);
      assert.equal(state.lot.rawStockKg, 800000);
      await rejectsWithoutChanges("PUT", "/packaging/five", { packageCount: 1001 });
    });
    await t.test("decreasing packages frees stock for another package", async () => {
      reset();
      assert.equal((await request("PUT", "/packaging/five", { packageCount: 600 })).status, 200);
      assert.equal(state.lot.packagedStockKg, 9000);
      assert.equal((await request("PUT", "/packaging/ten", { packageCount: 1500 })).status, 200);
      assert.equal(state.lot.packagedStockKg, 10000);
      assert.equal(state.packagings[1].availableCount, 700);
      assert.equal(state.lot.shippedKg, 8000);
    });
    await t.test("partial and full shipments lock weight and type and protect shipped counts", async () => {
      for (const full of [false, true]) {
        reset();
        if (full) { state.packagings[1].availableCount = 0; state.packagings[1].availableWeightKg = 0; state.shipmentItems[0].packageCount = 1400; state.shipmentItems[0].totalWeightKg = 14000; }
        for (const body of [{ unitWeightKg: 20 }, { packageType: "DRUGO" }, { packageCount: 799 }]) {
          await rejectsWithoutChanges("PUT", "/packaging/ten", body);
        }
        assert.equal((await request("PUT", "/packaging/ten", { notes: "Checked", unitWeightKg: 10, packageType: "DZAK_10KG" })).status, 200);
      }
    });
    await t.test("unit weight can change before shipment when mass remains covered", async () => {
      reset();
      assert.equal((await request("PUT", "/packaging/five", { unitWeightKg: 10, packageType: "DZAK_10KG", packageCount: 400 })).status, 200);
      assert.equal(state.packagings[0].availableWeightKg, 4000);
      assert.equal(state.lot.packagedStockKg, 10000);
    });
    await t.test("invalid and forged package fields never change stock", async () => {
      for (const body of [{ packageCount: -1 }, { packageCount: 1.5 }, { packageCount: null }, { packageCount: "" }, { packageCount: 2147483648 }, { unitWeightKg: 0 }, { unitWeightKg: -5 }, { unitWeightKg: Infinity }, { unitWeightKg: NaN }, { packageType: "INVALID" }, { packerCount: 0 }, { palletsCount: -1 }, { palletsCount: 1.6 }, { totalWeightKg: 1 }, { lotId: "other" }]) {
        reset(); await rejectsWithoutChanges("PUT", "/packaging/five", body);
      }
    });
    await t.test("one hundredth of a kg stock change is reflected on the LOT", async () => {
      reset(); state.lot.sortedQualityKg = 18000.01;
      assert.equal((await request("PUT", "/packaging/five", { packageCount: 1, unitWeightKg: 4000.01 })).status, 200);
      assert.equal(state.lot.packagedStockKg, 10000.01);
    });
    await t.test("POST packaging does not permit the former half-kg overdraft", async () => {
      reset(); state.lot.sortedQualityKg += 0.1;
      await rejectsWithoutChanges("POST", "/packaging", { lotId: "lot", packageType: "DRUGO", unitWeightKg: 0.2, packageCount: 1, palletsCount: 1 });
    });
    await t.test("the reported 800000 to 805000 kg change cannot fabricate raw stock", async () => {
      reset();
      await rejectsWithoutChanges("PUT", "/storage/storage", { currentQuantityKg: 805000, correctionReason: "Test" });
    });
    await t.test("storage quantity edits require a reason and preserve original receipt and LOT stock", async () => {
      reset();
      await rejectsWithoutChanges("PUT", "/storage/storage", { currentQuantityKg: 790000 });
      assert.equal((await editStorage({ currentQuantityKg: "790000", correctionReason: "Provera rasporeda" })).status, 200);
      assert.equal(state.storages[0].quantityKg, 820000);
      assert.equal(state.storages[0].currentQuantityKg, 790000);
      assert.equal(state.lot.rawStockKg, 800000);
      assert.equal(state.lot.initialQuantityKg, 820000);
      assert.equal(state.audit[0].action, "KOREKCIJA");
      assert.equal(state.audit[0].context.deltaKg, -10000);
      assert.equal(state.audit[0].context.reason, "Provera rasporeda");
      assert.equal(state.audit[0].oldValues.currentQuantityKg, 800000);
      assert.equal(state.audit[0].newValues.currentQuantityKg, 790000);
    });
    await t.test("allocation includes other locations of the same LOT and accepts zero", async () => {
      reset(); state.storages[0].currentQuantityKg = 400000; state.storages[0].boxCount = 360;
      state.storages.push({ id: "second", lotId: "lot", chamberId: "other-ch", currentQuantityKg: 300000, boxCount: 300 });
      assert.equal((await editStorage({ currentQuantityKg: 500000, correctionReason: "Raspored" })).status, 200);
      await rejectsWithoutChanges("PUT", "/storage/storage", { currentQuantityKg: 500001, correctionReason: "Raspored" });
      assert.equal((await editStorage({ currentQuantityKg: 0, boxCount: 0, correctionReason: "Prebacivanje u neraspoređeno" })).status, 200);
      assert.equal(state.lot.rawStockKg, 800000);
    });
    await t.test("invalid quantities, boxes, humidity and booleans are rejected", async () => {
      for (const body of [{ currentQuantityKg: -1 }, { currentQuantityKg: null }, { currentQuantityKg: "" }, { currentQuantityKg: " " }, { currentQuantityKg: "abc" }, { currentQuantityKg: Infinity }, { currentQuantityKg: NaN }, { boxCount: -1 }, { boxCount: 1.5 }, { humidityPercent: 101 }, { hasEquipment: "false" }, { quantityKg: 1 }, { lotId: "other" }]) {
        reset(); await rejectsWithoutChanges("PUT", "/storage/storage", body);
      }
    });
    await t.test("metadata remains editable on a legacy over-capacity entry without rewriting any quantities", async () => {
      reset();
      assert.equal((await editStorage({ notes: "Checked", temperatureC: 2, humidityPercent: 75 })).status, 200);
      assert.equal(state.storages[0].quantityKg, 820000);
      assert.equal(state.storages[0].currentQuantityKg, 800000);
      assert.equal(state.lot.rawStockKg, 800000);
      assert.equal(state.audit[0].action, "IZMENA");
    });
    await t.test("capacity counts kilograms and boxes of all LOTs including name-only legacy entries", async () => {
      for (const legacy of [false, true]) {
        reset(); state.storages[0].currentQuantityKg = 700000; state.storages[0].boxCount = 600;
        state.storages.push({ id: "foreign", lotId: "another-lot", chamberId: legacy ? null : "ch", locationOrChamber: "komora 1", currentQuantityKg: 90000, boxCount: 100 });
        await rejectsWithoutChanges("PUT", "/storage/storage", { currentQuantityKg: 702001, correctionReason: "Test" });
        await rejectsWithoutChanges("PUT", "/storage/storage", { boxCount: 621 });
        assert.equal((await editStorage({ currentQuantityKg: 702000, boxCount: 620, correctionReason: "Raspored" })).status, 200);
      }
    });
    await t.test("moving an entry to another chamber cannot exceed that chamber capacity", async () => {
      reset(); state.storages[0].currentQuantityKg = 100000; state.storages[0].boxCount = 100;
      state.storages.push({ id: "foreign", lotId: "another-lot", chamberId: "other-ch", currentQuantityKg: 700000, boxCount: 600 });
      await rejectsWithoutChanges("PUT", "/storage/storage", { chamberId: "other-ch" });
      state.storages[1].currentQuantityKg = 690000;
      assert.equal((await editStorage({ chamberId: "other-ch", locationOrChamber: "Stale name" })).status, 200);
      assert.equal(state.storages[0].locationOrChamber, "Komora 2");
      assert.equal(state.lot.rawStockKg, 800000);
    });
    await t.test("storage creation and automatic storage on arrival enforce capacity atomically", async () => {
      reset(); state.lot.rawStockKg = 900000;
      await rejectsWithoutChanges("POST", "/storage", { lotId: "lot", chamberId: "ch", storageType: "HLADNJACA", quantityKg: 1000, boxCount: 1 });
      await rejectsWithoutChanges("POST", "/harvest", { existingLotId: "lot", parcelId: "parcel", chamberId: "ch", quantityKg: 1000, boxCount: 1, autoStore: true });
      assert.equal(state.arrivals.length, 0);
    });
    await t.test("audit failures roll back storage and packaging edits", async () => {
      reset(); failAudit = true;
      await rejectsWithoutChanges("PUT", "/packaging/five", { packageCount: 600 });
      await rejectsWithoutChanges("PUT", "/storage/storage", { currentQuantityKg: 790000, correctionReason: "Test" }, 500);
    });
    await t.test("concurrent increases cannot consume the same sorted onion stock", async () => {
      reset(); state.lot.sortedQualityKg = 19000;
      const results = await Promise.all([
        request("PUT", "/packaging/five", { packageCount: 1000 }),
        request("PUT", "/packaging/ten", { packageCount: 1500 }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      assert.equal(state.packagings.reduce((sum, row) => sum + row.totalWeightKg, 0), 19000);
    });
    await t.test("concurrent allocations cannot consume the same unallocated raw stock", async () => {
      reset(); state.storages[0].currentQuantityKg = 300000; state.storages[0].boxCount = 300;
      state.storages.push({ id: "second", lotId: "lot", chamberId: "other-ch", locationOrChamber: "Komora 2", currentQuantityKg: 300000, boxCount: 300 });
      const results = await Promise.all([
        request("PUT", "/storage/storage", { currentQuantityKg: 500000, correctionReason: "Test" }),
        request("PUT", "/storage/second", { currentQuantityKg: 500000, correctionReason: "Test" }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      assert.equal(state.storages.reduce((sum, row) => sum + row.currentQuantityKg, 0), 800000);
      assert.equal(state.lot.rawStockKg, 800000);
    });
  } finally {
    prisma.$transaction = original;
    session.mock.restore(); logging.mock.restore();
  }
});

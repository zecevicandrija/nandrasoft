import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import router from "../routes/fertilizer.js";

function request(url, query = {}) {
  return new Promise((resolve, reject) => router.handle({ method: "GET", url, headers: {}, query }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, (error) => reject(error || new Error("Unhandled request"))));
}

test("fertilizer reports retain signed net usage independently of movement order", async (t) => {
  const originalMovement = prisma.fertilizerMovement, originalProduct = prisma.fertilizerProduct;
  let role = "DIREKTOR", rows = [], requestedOrder;
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "manager", role, isActive: true }, session: {} }));
  const product = { id: "product", name: "NPK", unit: "KG", type: "MINERALNO_GRANULISANO" };
  const parcel = { id: "parcel", code: "P01", name: "Field", areaHa: 10, currentCrop: "Corn" };
  const movement = (id, type, quantity, totalCost, date, unit = "KG") => ({
    id, movementType: type, quantity, totalCost, date: new Date(date), createdAt: new Date(date),
    product: { ...product, unit }, parcel, cropName: id === "return" ? "Latest crop" : "Earlier crop",
  });
  const issue = movement("issue", "IZDAVANJE_NJIVA", 100, 10000, "2026-10-01T08:00Z");
  const returned = movement("return", "POVRAT_SA_NJIVE", 20, 2000, "2026-10-02T08:00Z");
  // Only read delegates exist: reporting must not change products/movements.
  prisma.fertilizerProduct = { async findMany() { return []; } };
  prisma.fertilizerMovement = { async findMany({ orderBy }) {
    requestedOrder = orderBy;
    if (!orderBy) return structuredClone(rows);
    const first = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    return structuredClone([...rows].sort((a, b) => (a.date - b.date) * (first.date === "asc" ? 1 : -1)));
  } };
  try {
    await t.test("issue 100 then return 20 reports net 80 and keeps the latest date/crop", async () => {
      rows = [returned, issue];
      const result = await request("/parcel-summary", { year: "2026" });
      assert.equal(result.status, 200);
      assert.equal(requestedOrder[0].date, "asc");
      const summary = result.body.parcelSummary[0];
      assert.equal(summary.totalIssuedKg, 100);
      assert.equal(summary.totalReturnedKg, 20);
      assert.equal(summary.totalKgApplied, 80);
      assert.equal(summary.totalCostRSD, 8000);
      assert.equal(summary.avgKgPerHa, 8);
      assert.equal(summary.costPerHaRSD, 800);
      assert.equal(summary.applicationsCount, 1);
      assert.equal(summary.products[0].totalKg, 80);
      assert.equal(summary.lastAppliedAt.getTime(), returned.date.getTime());
      assert.equal(summary.currentCrop, "Latest crop");
    });
    await t.test("monthly net figures are independent of unsorted issue/return rows", async () => {
      for (const order of [[returned, issue], [issue, returned]]) {
        rows = order;
        const result = await request("/products");
        assert.equal(result.status, 200);
        assert.equal(result.body.stats.monthIssuedKg, 80);
        assert.equal(result.body.stats.monthIssuedCostRSD, 8000);
      }
    });
    await t.test("tonnes and decimal costs are converted without losing return signs", async () => {
      rows = [{ ...issue, quantity: 0.1, totalCost: 10.01, product: { ...product, unit: "TONA" } },
        { ...returned, quantity: 0.02, totalCost: 2.02, product: { ...product, unit: "TONA" } }];
      const summary = (await request("/parcel-summary", { year: "2026" })).body.parcelSummary[0];
      assert.equal(summary.totalKgApplied, 80);
      assert.equal(summary.products[0].totalQuantity, 0.08);
      assert.equal(summary.totalCostRSD, 7.99);
    });
    await t.test("a return from an earlier reporting period remains a negative net movement", async () => {
      rows = [returned];
      const summary = (await request("/parcel-summary", { year: "2026" })).body.parcelSummary[0];
      assert.equal(summary.totalKgApplied, -20);
      assert.equal(summary.totalCostRSD, -2000);
      assert.equal(summary.products[0].totalKg, -20);
      const stats = (await request("/products")).body.stats;
      assert.equal(stats.monthIssuedKg, -20);
      assert.equal(stats.monthIssuedCostRSD, -2000);
    });
    await t.test("quantity rounding occurs after summation, not after every movement", async () => {
      rows = [{ ...issue, quantity: 0.004 }, { ...issue, id: "another", quantity: 0.004 }];
      const summary = (await request("/parcel-summary", { year: "2026" })).body.parcelSummary[0];
      assert.equal(summary.totalKgApplied, 0.01);
      assert.equal(summary.totalIssuedKg, 0.01);
      assert.equal(summary.products[0].totalKg, 0.01);
    });
    await t.test("worker views do not expose costs and empty reports remain empty", async () => {
      role = "MAGACIN"; rows = [issue, returned];
      const summary = (await request("/parcel-summary", { year: "2026" })).body.parcelSummary[0];
      assert.equal(summary.totalKgApplied, 80);
      assert.equal(Object.hasOwn(summary, "totalCostRSD"), false);
      rows = [];
      assert.deepEqual((await request("/parcel-summary")).body.parcelSummary, []);
      assert.equal((await request("/products")).body.stats.monthIssuedKg, 0);
    });
  } finally {
    prisma.fertilizerMovement = originalMovement; prisma.fertilizerProduct = originalProduct;
    session.mock.restore();
  }
});

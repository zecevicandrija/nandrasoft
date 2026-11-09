import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";
import { materialsSchema, materialPrefixQuery, prepareMaterials, searchMaterials } from "../lib/workMaterials.js";

test("material search requires two characters, normalizes Serbian Latin, and binds prefix queries", async () => {
  assert.equal(materialPrefixQuery(" Ča šćžđ "), "ca:* & sczd:*");
  assert.equal(materialPrefixQuery("NPK 16:16"), "npk:* & 16:*");
  assert.equal(materialPrefixQuery("' | :*"), null);
  assert.equal(materialPrefixQuery("a"), null);
  let calls = 0;
  const db = { async $queryRaw(sql) {
    calls++;
    assert.ok(sql.text.includes("material_search_vector"));
    assert.ok(!sql.text.includes("drop"));
    assert.ok(!sql.text.includes("COUNT("));
    assert.ok(sql.values.includes("drop:* & table:*") && sql.values.includes(11));
    return Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, code: `C${i}`, name: `Product ${i}`, unit: "L" }));
  } };
  assert.equal((await searchMaterials(db, "CHEMICAL", { q: "a" })).items.length, 0);
  assert.equal((await searchMaterials(db, "CHEMICAL")).items.length, 0);
  assert.equal(calls, 0);
  const result = await searchMaterials(db, "CHEMICAL", { q: "DROP TABLE", limit: 1000 });
  assert.equal(calls, 1);
  assert.equal(result.items.length, 10);
  assert.equal(result.hasMore, true);
  assert.deepEqual(JSON.parse(Buffer.from(result.nextCursor, "base64url")), { key: "C9", id: "p9" });
});

test("materials validate kind, duplicates and doses, batch product reads, and retain historical snapshots", async () => {
  let calls = 0;
  let required = false;
  const db = {
    workType: { async findUnique() { return { materialKind: "CHEMICAL", materialRequired: required }; } },
    chemicalProduct: { async findMany({ where, select }) {
      calls++;
      assert.equal(where.isActive, true);
      assert.ok(!select.currentStock);
      return where.id.in.filter(id => id !== "missing").map(id => ({ id, name: `Name ${id}`, code: id, unit: "L" }));
    } },
  };
  const a = { kind: "CHEMICAL", productId: "a", dosePerHa: 1.5 };
  const b = { kind: "CHEMICAL", productId: "b" };
  const rows = await prepareMaterials(db, "spray", [a, b]);
  assert.equal(calls, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chemicalId, "a");
  assert.equal(rows[0].dosePerHa, 1.5);
  assert.equal(rows[1].dosePerHa, null);
  const historical = { ...a, name: "Old name", code: "OLD", unit: "ML" };
  const retained = await prepareMaterials(db, "spray", [a], [historical]);
  assert.equal(retained[0].name, "Old name");
  assert.equal(retained[0].unit, "ML");
  assert.equal(calls, 1, "retained products do not trigger new reads or lose archived history");
  await assert.rejects(prepareMaterials(db, "spray", [a, a]), /više puta/);
  await assert.rejects(prepareMaterials(db, "spray", [{ ...a, kind: "SEED" }]), /ne odgovara/);
  await assert.rejects(prepareMaterials(db, "spray", [{ ...a, productId: "missing" }]), /arhiviran/);
  required = true;
  await assert.rejects(prepareMaterials(db, "spray", []), /Izaberite/);
  for (const dosePerHa of [0, -1, Infinity, NaN]) assert.equal(materialsSchema.safeParse([{ ...a, dosePerHa }]).success, false);
  assert.equal(materialsSchema.safeParse(Array(21).fill(a)).success, false);
  assert.equal(materialsSchema.safeParse([{ ...a, dosePerHa: null }]).success, true);
});

test("PostgreSQL material search uses GIN, keyset pagination and accent-insensitive prefix matches", { skip: process.env.TEST_MATERIAL_DB !== "1", timeout: 30000 }, async t => {
  const schema = `material_perf_${randomUUID().replaceAll("-", "")}`;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const table of ["chemical_product", "seed_product", "fertilizer_product"]) {
      await client.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await client.query(`INSERT INTO chemical_product (id, code, name, "activeIngredient", "updatedAt")
      SELECT 'chem-' || n, 'C-' || lpad(n::text, 6, '0'), CASE WHEN n IN (123,124) THEN 'Žuti preparat' ELSE 'Preparat ' || n END,
        CASE WHEN n = 123 THEN 'Aktivna materija' ELSE 'Druga' END, now() FROM generate_series(1,20000) n`);
    await client.query(`INSERT INTO seed_product (id, code, name, crop, variety, manufacturer, "updatedAt")
      SELECT 'seed-' || n, 'S-' || lpad(n::text, 6, '0'), 'Seme ' || n, 'Luk', CASE WHEN n = 123 THEN 'Španski hibrid' ELSE 'Druga sorta' END, 'Proizvodjac', now() FROM generate_series(1,20000) n`);
    await client.query(`INSERT INTO fertilizer_product (id, name, "updatedAt")
      SELECT 'fert-' || n, CASE WHEN n = 123 THEN 'Đubrivo NPK 16:16:16' ELSE 'Djubrivo ' || n END, now() FROM generate_series(1,20000) n`);
    for (const table of ["chemical_product", "seed_product", "fertilizer_product"]) await client.query(`ANALYZE ${table}`);
    let lastSQL;
    const db = { async $queryRaw(sql) { lastSQL = sql; return (await client.query(sql.text, sql.values)).rows; } };
    const result = await searchMaterials(db, "CHEMICAL", { q: "zuti akt" });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, "chem-123");
    // Actual planner choice with normal settings, not forced enable_seqscan=off.
    for (const [kind, q] of [["CHEMICAL", "zuti akt"], ["SEED", "span hib"], ["FERTILIZER", "dubr npk"]]) {
      assert.equal((await searchMaterials(db, kind, { q })).items.length, 1);
      const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${lastSQL.text}`, lastSQL.values)).rows[0]["QUERY PLAN"][0];
      assert.match(JSON.stringify(plan), /Bitmap Index Scan/);
      t.diagnostic(`${kind}: GIN chosen; ${plan["Execution Time"]} ms on 20,000 products`);
    }
    const first = await searchMaterials(db, "CHEMICAL", { catalogue: true, limit: 25 });
    const after = JSON.parse(Buffer.from(first.nextCursor, "base64url"));
    const second = await searchMaterials(db, "CHEMICAL", { catalogue: true, limit: 25, after });
    assert.equal(first.items.length, 25);
    assert.equal(second.items.length, 25);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 50);
    const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${lastSQL.text}`, lastSQL.values)).rows[0]["QUERY PLAN"][0];
    assert.match(JSON.stringify(plan), /Index Scan/);
    assert.ok(!lastSQL.text.includes("OFFSET"));
    await client.query(`UPDATE chemical_product SET "isActive"=false WHERE id='chem-123'`);
    assert.equal((await searchMaterials(db, "CHEMICAL", { q: "zuti akt" })).items.length, 0);
    assert.equal((await searchMaterials(db, "CHEMICAL", { q: "zu" })).items.length, 1);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});

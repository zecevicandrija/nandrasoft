import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import "dotenv/config";

test("analytics indexes reduce selective worker/machine date scans on synthetic PostgreSQL data", {
  skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 60000,
}, async (t) => {
  const schema = `nandra_analytics_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^nandra_analytics_test_[a-f0-9]{32}$/);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  const rows = 100000;
  const scanNodes = (node) => [node, ...(node.Plans || []).flatMap(scanNodes)].filter((item) => item["Node Type"].includes("Scan"));
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const [table, key, date, migration, index] of [
      ["fuel_entry", "workerId", "date", "20261031005000_fuel_worker_date_index", "fuel_entry_workerId_date_idx"],
      ["maintenance_issue", "machineId", "dateReported", "20261031006000_maintenance_machine_date_index", "maintenance_issue_machineId_dateReported_idx"],
    ]) {
      // Same predicate columns and key lengths as the application; independent
      // tables contain no real workers, machines or financial transactions.
      await client.query(`CREATE TABLE "${table}" ("${key}" TEXT NOT NULL, "${date}" TIMESTAMP NOT NULL, "totalCost" NUMERIC(15,2), "status" TEXT, padding TEXT)`);
      await client.query(`INSERT INTO "${table}" SELECT
        'id-' || lpad((g % 1000)::text,22,'0'),
        TIMESTAMP '2024-01-01' + (g % 730) * INTERVAL '1 day',
        100.01, 'OTVOREN', repeat('x',200) FROM generate_series(1,$1::int) AS g`, [rows]);
      // Approximate existing relevant alternatives, not an artificially indexless table.
      if (table === "fuel_entry") await client.query(`CREATE INDEX baseline_date ON "${table}"("${date}")`);
      else await client.query(`CREATE INDEX baseline_machine_status ON "${table}"("${key}",status)`);
      await client.query(`ANALYZE "${table}"`);
      const values = ["id-" + "42".padStart(22, "0"), "2025-01-01", "2025-02-01"];
      const sql = `SELECT SUM("totalCost") AS total, COUNT(*) AS count FROM "${table}"
        WHERE "${key}"=$1 AND "${date}">=$2::timestamp AND "${date}"<$3::timestamp`;
      const measure = async () => {
        const plans = [];
        for (let i = 0; i < 7; i++) {
          const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values);
          if (i > 0) plans.push(result.rows[0]["QUERY PLAN"][0]); // First run warms pages.
        }
        plans.sort((a, b) => a["Execution Time"] - b["Execution Time"]);
        return plans[Math.floor(plans.length / 2)];
      };
      const beforeResult = (await client.query(sql, values)).rows;
      const before = await measure();
      // Each migration is one concurrent statement, executed outside a transaction.
      await client.query(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
      await client.query(`ANALYZE "${table}"`);
      const after = await measure();
      assert.deepEqual((await client.query(sql, values)).rows, beforeResult);
      const scans = scanNodes(after.Plan);
      assert.ok(scans.some((scan) => scan["Index Name"] === index), "planner must choose the new composite index without disabling sequential scans");
      assert.ok(after.Plan["Shared Hit Blocks"] + after.Plan["Shared Read Blocks"] < before.Plan["Shared Hit Blocks"] + before.Plan["Shared Read Blocks"]);
      const bytes = (await client.query("SELECT pg_relation_size($1::regclass)::text AS bytes", [`"${index}"`])).rows[0].bytes;
      t.diagnostic(JSON.stringify({ table, syntheticRows: rows, warmMedianBeforeMs: before["Execution Time"], warmMedianAfterMs: after["Execution Time"],
        beforeBuffers: before.Plan["Shared Hit Blocks"] + before.Plan["Shared Read Blocks"],
        afterBuffers: after.Plan["Shared Hit Blocks"] + after.Plan["Shared Read Blocks"],
        beforeScans: scanNodes(before.Plan).map((scan) => scan["Node Type"]), afterScans: scans.map((scan) => scan["Node Type"]), indexBytes: Number(bytes) }));
    }
  } finally {
    await client.query('SET search_path TO "public"');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

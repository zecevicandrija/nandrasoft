import pg from "pg";
import "dotenv/config";

// Run against the intended deployment's DATABASE_URL. Read-only: no DDL, ANALYZE,
// fixture inserts, configuration changes or forced planner settings.
const QUOTA_BYTES = 6_000_000_000; // Conservative decimal 6 GB, not 6 GiB.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  const sizes = (await client.query(`
    SELECT pg_database_size(current_database())::text AS "databaseBytes",
      (SELECT COALESCE(SUM(pg_indexes_size(c.oid)),0)::text
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=current_schema() AND c.relkind='r') AS "schemaIndexesBytes"
  `)).rows[0];
  const indexes = (await client.query(`
    SELECT i.relname AS name, x.indisvalid AS valid, x.indisready AS ready,
      pg_relation_size(i.oid)::text AS bytes, pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
    JOIN pg_namespace n ON n.oid=i.relnamespace
    WHERE n.nspname=current_schema()
      AND i.relname IN ('fuel_entry_workerId_date_idx','maintenance_issue_machineId_dateReported_idx')
    ORDER BY i.relname
  `)).rows;
  const databaseBytes = Number(sizes.databaseBytes);
  const indexBytes = indexes.reduce((sum, index) => sum + Number(index.bytes), 0);
  const plans = [];
  for (const [table, key, date] of [["fuel_entry", "workerId", "date"], ["maintenance_issue", "machineId", "dateReported"]]) {
    // Identifiers come exclusively from these hard-coded tuples. Values are bound.
    const sample = (await client.query(`SELECT "${key}" AS id, max("${date}") AS latest FROM "${table}" GROUP BY "${key}" ORDER BY count(*) DESC LIMIT 1`)).rows[0];
    const count = (await client.query(`SELECT count(*)::text AS count FROM "${table}"`)).rows[0].count;
    if (!sample) { plans.push({ table, rows: count, plan: null }); continue; }
    const end = new Date(sample.latest), start = new Date(end.getTime() - 30 * 86400000);
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT sum("totalCost"), count(*) FROM "${table}"
      WHERE "${key}" = $1 AND "${date}" >= $2 AND "${date}" <= $3`, [sample.id, start, end]);
    const plan = result.rows[0]["QUERY PLAN"][0];
    const scans = [];
    const visit = (node) => {
      if (node["Node Type"].includes("Scan")) scans.push({ type: node["Node Type"], index: node["Index Name"] || null,
        returnedRows: node["Actual Rows"], removedRows: node["Rows Removed by Filter"] || 0 });
      for (const child of node.Plans || []) visit(child);
    };
    visit(plan.Plan);
    plans.push({ table, rows: count, executionMs: plan["Execution Time"], scans,
      sharedHitBlocks: plan.Plan["Shared Hit Blocks"], sharedReadBlocks: plan.Plan["Shared Read Blocks"] });
  }
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), databaseBytes, schemaIndexesBytes: Number(sizes.schemaIndexesBytes),
    targetIndexBytes: indexBytes, quotaBytes: QUOTA_BYTES,
    databaseUsedPercent: Number((100 * databaseBytes / QUOTA_BYTES).toFixed(4)),
    remainingBytes: QUOTA_BYTES - databaseBytes, indexes, plans,
    limitation: "Database disk size, not RAM or provider-wide storage (WAL/backups/other databases). Run on the hosted database to assess its quota.",
  }, null, 2));
  if (indexes.length !== 2 || indexes.some((index) => !index.valid || !index.ready) || databaseBytes >= QUOTA_BYTES) process.exitCode = 1;
} finally {
  await client.query("ROLLBACK");
  await client.end();
}

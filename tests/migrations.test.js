import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import "dotenv/config";

const execute = promisify(execFile);
test("migrate deploy builds the complete schema from empty and preserves existing chamber catalogues", { skip: process.env.TEST_ASSIGNMENT_DB !== "1", timeout: 60000 }, async () => {
  const schema = `nandra_migration_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^nandra_migration_test_[a-f0-9]{32}$/);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("schema", schema);
  const env = { ...process.env, DATABASE_URL: url.toString() };
  const cli = async (...args) => execute(process.execPath, ["node_modules/prisma/build/index.js", ...args], { env, timeout: 20000 });
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await cli("migrate", "deploy");
    await cli("migrate", "deploy"); // Repeat deployment is a no-op.
    await cli("migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code");
    const source = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
    const expected = [...source.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]).sort();
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name <> '_prisma_migrations'", [schema])).rows.map((row) => row.table_name).sort();
    assert.deepEqual(tables, expected);
    await client.query(`SET search_path TO "${schema}"`);
    const index = (await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'machine_assignment_one_active_per_machine'", [schema])).rows[0];
    assert.match(index.indexdef, /UNIQUE.*WHERE.*ZADUZENA/);
    const chambers = (await client.query("SELECT * FROM onion_chambers ORDER BY name")).rows;
    assert.equal(chambers.length, 6);
    assert.equal(chambers.filter((row) => row.has_equipment).length, 3);
    assert.ok(chambers.every((row) => row.max_capacity_kg === 792000));
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL")).rows[0].count, (await readdir(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length);
    // Replaying the adoption migration must not overwrite custom catalogue data.
    await client.query("DELETE FROM onion_chambers");
    await client.query("INSERT INTO onion_chambers (id, name, max_boxes, max_capacity_kg) VALUES ('custom', 'Custom chamber', 100, 110000)");
    await client.query(await readFile(new URL("../prisma/migrations/20261030235000_onion_chambers/migration.sql", import.meta.url), "utf8"));
    const preserved = (await client.query("SELECT id, name, max_boxes, max_capacity_kg FROM onion_chambers")).rows;
    assert.deepEqual(preserved, [{ id: "custom", name: "Custom chamber", max_boxes: 100, max_capacity_kg: 110000 }]);
  } finally {
    // Drop only the random test-owned schema validated above, never public.
    await client.query("ROLLBACK");
    await client.query('SET search_path TO "public"');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

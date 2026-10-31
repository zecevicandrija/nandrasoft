import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

// Run after a production build: validate emitted dependencies, not source syntax.
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', dist), 'utf8'));
function staticDependencies(key: string, seen = new Set<string>()) {
  if (seen.has(key)) return seen;
  assert.ok(manifest[key], `Missing build entry: ${key}`);
  seen.add(key);
  for (const dependency of manifest[key].imports || []) staticDependencies(dependency, seen);
  return seen;
}

test('initial and field routes exclude reporting libraries and management dashboards', async (t) => {
  const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
  assert.ok(entry);
  for (const route of [entry, 'src/Masine/MasineZaduzenje.tsx', 'src/Radovi/BrziUnosRada.tsx', 'src/Radovi/RadoviDashboard.tsx']) {
    const graph = [...staticDependencies(route)];
    for (const dependency of graph) {
      assert.doesNotMatch(dependency, /node_modules\/(jspdf|jspdf-autotable|xlsx|html2canvas)\//);
      assert.doesNotMatch(dependency, /src\/(Analitika|Luk|Sezonci|Administrator)\//);
    }
    const chunks = await Promise.all(graph.map((key) => readFile(new URL(manifest[key].file, dist))));
    const bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const gzipBytes = chunks.reduce((sum, chunk) => sum + gzipSync(chunk).length, 0);
    assert.ok(bytes < 600_000, `${route}: static JS dependency graph exceeds 600 kB`);
    t.diagnostic(`${route}: ${bytes} JS bytes, ${gzipBytes} gzip bytes across ${chunks.length} chunks`);
  }
});

test('all secondary routes are dynamic entries; export libraries stay deferred even on reporting pages', () => {
  const routes = Object.keys(manifest).filter((key) => key.startsWith('src/') && key.endsWith('.tsx'));
  assert.equal(routes.length, 15);
  for (const route of routes) {
    assert.equal(manifest[route].isDynamicEntry, true, route);
    assert.ok(!staticDependencies('index.html').has(route));
  }
  for (const route of ['src/Analitika/AnalitikaDashboard.tsx', 'src/Luk/OnionDashboard.tsx',
    'src/Sezonci/SeasonalWorkersDashboard.tsx', 'src/Radovi/RadoviDashboard.tsx']) {
    for (const dependency of staticDependencies(route)) {
      assert.doesNotMatch(dependency, /node_modules\/(jspdf|jspdf-autotable|xlsx)\//);
    }
    const dynamic = manifest[route].dynamicImports || [];
    assert.ok(dynamic.some((key: string) => key.includes('node_modules/jspdf/')));
    assert.ok(dynamic.some((key: string) => key.includes('node_modules/jspdf-autotable/')));
    if (route.includes('Analitika')) assert.ok(dynamic.some((key: string) => key.includes('node_modules/xlsx/')));
  }
});

test('dynamically imported PDF and Excel APIs generate valid document data', async () => {
  const [{ jsPDF }, { autoTable }, XLSX] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('xlsx'),
  ]);
  const doc = new jsPDF();
  autoTable(doc, { head: [['Item', 'Quantity']], body: [['Onion', '10']] });
  const pdf = Buffer.from(doc.output('arraybuffer'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ item: 'Onion', quantity: 10 }]), 'Stock');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(parsed.Sheets.Stock), [{ item: 'Onion', quantity: 10 }]);
});

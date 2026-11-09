import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { materialPayload, materialSearchOptions, materialSummary, parseMaterialDose, type WorkMaterial } from '../src/lib/workMaterials.ts';

test('dose entry accepts comma and dot decimals, clearing, and rejects invalid numeric values', () => {
  for (const text of ['0,25', '0.25', ',25', '.25']) assert.deepEqual(parseMaterialDose(text), { value: 0.25, error: '' });
  assert.deepEqual(parseMaterialDose('1,'), { value: 1, error: '' });
  assert.deepEqual(parseMaterialDose('1.'), { value: 1, error: '' });
  assert.deepEqual(parseMaterialDose(''), { value: null, error: '' });
  for (const text of ['0', '0,', '-1', 'abc', '1,2.3', 'Infinity', '1000000000001']) {
    const parsed = parseMaterialDose(text);
    assert.equal(parsed.value, null);
    assert.ok(parsed.error);
  }
  const dose = parseMaterialDose('0,25').value;
  assert.equal(materialPayload([{ kind: 'CHEMICAL', productId: 'p1', name: 'Preparat', unit: 'L', dosePerHa: dose }])[0].dosePerHa, 0.25);
});

test('material search requests only ten matching products and reuses fresh cached searches', async t => {
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(String(url), '/api/materials/search/CHEMICAL?q=pre%20pa&limit=10');
    assert.equal(init?.credentials, 'include');
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ items: [{ id: 'p1', name: 'Preparat', unit: 'L' }], hasMore: true });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    assert.equal(materialSearchOptions('CHEMICAL', '').enabled, false);
    assert.equal(materialSearchOptions('CHEMICAL', 'a').enabled, false);
    assert.deepEqual(await client.fetchQuery(materialSearchOptions('CHEMICAL', 'a')), { items: [], hasMore: false });
    assert.equal(calls, 0);
    const result = await client.fetchQuery(materialSearchOptions('CHEMICAL', 'pre pa'));
    assert.equal(result.items.length, 1);
    await client.fetchQuery(materialSearchOptions('CHEMICAL', 'pre pa'));
    assert.equal(calls, 1);
    assert.notDeepEqual(materialSearchOptions('SEED', 'pre pa').queryKey, materialSearchOptions('CHEMICAL', 'pre pa').queryKey);
  } finally { client.clear(); fetch.mock.restore(); }
});

test('cancelled old material search cannot commit a response even if transport ignores abort', async t => {
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(resolve => { finish = resolve; });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const options = materialSearchOptions('SEED', 'luk');
    const pending = client.fetchQuery(options).catch(() => null);
    await client.cancelQueries({ queryKey: options.queryKey });
    assert.equal(signal?.aborted, true);
    finish?.(Response.json({ items: [{ id: 'late', name: 'Late', unit: 'KG' }], hasMore: false }));
    await pending;
    assert.equal(client.getQueryData(options.queryKey), undefined);
  } finally { client.clear(); fetch.mock.restore(); }
});

test('material HTTP errors remain retryable and snapshots produce bounded submission data', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Nije dostupno.' }, { status: 503 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try { await assert.rejects(client.fetchQuery(materialSearchOptions('FERTILIZER', 'npk')), /Nije dostupno/); }
  finally { client.clear(); fetch.mock.restore(); }
  const items: WorkMaterial[] = [{ kind: 'SEED', productId: 's1', code: 'S-01', name: 'Hibrid luka', unit: 'SEME', dosePerHa: 250000, notes: 'Potvrđeno' }];
  assert.deepEqual(materialPayload(items), [{ kind: 'SEED', productId: 's1', dosePerHa: 250000, notes: 'Potvrđeno' }]);
  assert.equal(materialSummary(items), 'Hibrid luka (250000 semena/ha) — Potvrđeno');
  assert.deepEqual(materialPayload(), []);
});

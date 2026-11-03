import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { onionRequest } from '../src/Luk/onionRequest.ts';

const resources: Record<string, object> = {
  '/lookup': { chambers: [], allLots: [], activeLots: [], parcels: [], machines: [], workers: [], buyers: [], availablePackagings: [] },
  '/dashboard': { kpi: { totalChambersCount: 0, maxColdStorageBoxes: 0, maxColdStorageKg: 0, totalHarvestedKg: 0 }, chambersSummary: [] },
  '/lots': { lots: [] }, '/harvest': { arrivals: [] }, '/storage': { entries: [] },
  '/sorting': { sortings: [] }, '/packaging': { packagings: [] },
  '/shipment': { shipments: [] }, '/waste': { wastes: [] },
  '/traceability/LOT-1': { lot: { lotNumber: 'LOT-1' }, timeline: [], turas: [] },
};

test('every onion resource reports load failure, preserves its filters on retry, and accepts a genuine empty result', async t => {
  for (const [path, body] of Object.entries(resources)) {
    let fail = true;
    const requested: string[] = [];
    const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
      requested.push(String(url));
      assert.equal(options?.credentials, 'include');
      assert.ok(options?.signal instanceof AbortSignal);
      return fail ? Response.json({ error: 'Ucitavanje nije uspelo.' }, { status: 500 }) : Response.json(body);
    });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const observer = new QueryObserver(cache, {
      queryKey: ['onion-test', path],
      queryFn: ({ signal }) => onionRequest(`${path}?page=2&lotId=lot-1`, signal),
      enabled: false,
    });
    try {
      await observer.refetch();
      assert.equal(observer.getCurrentResult().isError, true, path);
      assert.equal(observer.getCurrentResult().data, undefined, path);
      assert.equal(observer.getCurrentResult().error?.message, 'Ucitavanje nije uspelo.');
      fail = false;
      await observer.refetch();
      assert.equal(observer.getCurrentResult().isSuccess, true, path);
      assert.deepEqual(observer.getCurrentResult().data, body);
      assert.deepEqual(requested, [`/api/onion${path}?page=2&lotId=lot-1`, `/api/onion${path}?page=2&lotId=lot-1`]);
      fail = true;
      await observer.refetch();
      assert.equal(observer.getCurrentResult().isError, true, 'failed refresh remains visible');
      assert.deepEqual(observer.getCurrentResult().data, body, 'failed refresh preserves last successful data');
    } finally { cache.clear(); mock.mock.restore(); }
  }
});

test('partial success payloads fail validation instead of becoming empty onion inventory', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  for (const path of Object.keys(resources)) {
    await assert.rejects(onionRequest(path, new AbortController().signal), /nepotpune podatke/);
  }
  mock.mock.mockImplementation(async () => Response.json({ kpi: {}, chambersSummary: [] }));
  await assert.rejects(onionRequest('/dashboard', new AbortController().signal), /nepotpune podatke/);
});

test('cancelled onion reads cannot commit a late response even if fetch ignores abort', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => {
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    return Response.json(resources['/packaging']);
  });
  await assert.rejects(onionRequest('/packaging', controller.signal), error => error === controller.signal.reason);
});

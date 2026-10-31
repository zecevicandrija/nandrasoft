import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { fuelQueryOptions, fuelRequest } from '../src/Gorivo/fuelQueries.ts';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

test('a slower old filter response cannot replace the newer result, even when transport ignores cancellation', async (t) => {
  const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise<Response>((resolve) => {
    assert.equal(options.credentials, 'include');
    requests.push({ signal: options.signal, resolve });
  }));
  const cache = client();
  const oldOptions = fuelQueryOptions<{ entries: string[] }>('manager', 'entries', { machineId: 'A', page: 1, limit: 25 });
  const newOptions = fuelQueryOptions<{ entries: string[] }>('manager', 'entries', { machineId: 'B', page: 1, limit: 25 });
  const observer = new QueryObserver(cache, oldOptions);
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(requests.length, 1);
    observer.setOptions(newOptions);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].signal.aborted, true);
    requests[1].resolve(json({ entries: ['new'] }));
    await settle();
    assert.deepEqual(observer.getCurrentResult().data, { entries: ['new'] });
    requests[0].resolve(json({ entries: ['old'] }));
    await settle();
    assert.deepEqual(observer.getCurrentResult().data, { entries: ['new'] });
    assert.equal(cache.getQueryData(oldOptions.queryKey), undefined);
    assert.equal(observer.getCurrentResult().isError, false);
  } finally { unsubscribe(); cache.clear(); }
});

test('HTTP errors become query error state and retry recovers the same filters', async (t) => {
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /dateFrom=2026-10-01/);
    return fail ? json({ error: 'Pristup nije dozvoljen.' }, 403) : json({ entries: [] });
  });
  const cache = client();
  const observer = new QueryObserver(cache, fuelQueryOptions<{ entries: string[] }>('manager', 'entries', { dateFrom: '2026-10-01' }));
  const unsubscribe = observer.subscribe(() => {});
  try {
    await settle();
    assert.equal(observer.getCurrentResult().isError, true);
    assert.equal(observer.getCurrentResult().error?.message, 'Pristup nije dozvoljen.');
    assert.equal(observer.getCurrentResult().data, undefined);
    fail = false;
    await observer.refetch();
    assert.equal(observer.getCurrentResult().isSuccess, true);
    assert.deepEqual(observer.getCurrentResult().data, { entries: [] });
  } finally { unsubscribe(); cache.clear(); }
});

test('unmount aborts the request; worker history, pagination, filters and users have isolated keys', async (t) => {
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise<Response>(() => {});
  });
  const cache = client();
  const observer = new QueryObserver(cache, fuelQueryOptions('worker', 'entries', { scope: 'today', limit: 50 }));
  const unsubscribe = observer.subscribe(() => {});
  assert.equal(signal?.aborted, false);
  unsubscribe();
  assert.equal(signal?.aborted, true);
  const variants = [
    fuelQueryOptions('worker', 'entries', { scope: 'today', limit: 50 }),
    fuelQueryOptions('worker', 'entries', { scope: 'history', page: 1, limit: 25 }),
    fuelQueryOptions('worker', 'entries', { scope: 'history', page: 2, limit: 25 }),
    fuelQueryOptions('other', 'entries', { scope: 'history', page: 1, limit: 25 }),
    fuelQueryOptions('worker', 'entries', { machineId: 'a', workerId: 'w', fuelSource: 'PUMPA', hasAnomaly: true }),
    fuelQueryOptions('worker', 'entries', { machineId: 'b', workerId: 'w', fuelSource: 'PUMPA', hasAnomaly: true }),
  ];
  assert.equal(new Set(variants.map((options) => JSON.stringify(options.queryKey))).size, variants.length);
  assert.equal(fuelQueryOptions(undefined, 'entries').enabled, false);
  cache.clear();
});

test('refresh invalidates fuel pages without refetching disabled history or unrelated master data', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ entries: [] }); });
  const cache = client();
  const history = fuelQueryOptions('worker', 'entries', { scope: 'history', page: 1 });
  const master = fuelQueryOptions('worker', 'machines');
  cache.setQueryData(history.queryKey, { entries: ['cached'] });
  cache.setQueryData(master.queryKey, { machines: [] });
  const observer = new QueryObserver(cache, { ...history, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await cache.invalidateQueries({ queryKey: ['fuel', 'worker'] });
    assert.equal(calls, 0);
    assert.equal(cache.getQueryState(history.queryKey)?.isInvalidated, true);
    assert.equal(cache.getQueryState(master.queryKey)?.isInvalidated, false);
    observer.setOptions({ ...history, enabled: true });
    await settle();
    assert.equal(calls, 1);
  } finally { unsubscribe(); cache.clear(); }
});

test('network and non-JSON failures have clear messages; abort remains cancellation', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(fuelRequest('/fuel/stats'), /Proverite vezu/);
  fetch.mock.mockImplementation(async () => new Response('Bad gateway', { status: 502 }));
  await assert.rejects(fuelRequest('/fuel/stats'), /HTTP 502/);
  const controller = new AbortController();
  controller.abort();
  fetch.mock.mockImplementation(async () => { throw new DOMException('Aborted', 'AbortError'); });
  await assert.rejects(fuelRequest('/fuel/stats', { signal: controller.signal }), { name: 'AbortError' });
});

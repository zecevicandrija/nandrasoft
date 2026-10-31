import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { operationalQueryOptions, operationalRequest, operationalKey, cancelInactiveWorkshopQueries, type OperationalResource } from '../src/lib/operationalQueries.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const json = (body: unknown, status = 200) => Response.json(body, { status });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

test('HTTP failures become error state for every operational resource and retry preserves filters', async t => {
  let fail = true;
  const fields = { orders: 'workOrders', issues: 'issues', remont: 'orders', history: 'history', workers: 'workers', machines: 'machines', parcels: 'parcels', workTypes: 'workTypes', stats: 'stats' };
  for (const resource of Object.keys(fields) as OperationalResource[]) {
    let requested = '';
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options?.credentials, 'include'); assert.ok(options?.signal instanceof AbortSignal);
      if (requested) assert.equal(String(url), requested);
      requested = String(url);
      return fail ? json({ error: 'Pristup nije dozvoljen.' }, 403) : json({ [fields[resource]]: [] });
    });
    const cache = client();
    const observer = new QueryObserver(cache, operationalQueryOptions('u', 'DIREKTOR', resource, { page: 2, machineId: 'm', status: 'AKTIVNI', dateFrom: '2026-10-01' }));
    const unsubscribe = observer.subscribe(() => {});
    try {
      await settle();
      assert.equal(observer.getCurrentResult().isError, true, resource);
      assert.equal(observer.getCurrentResult().error?.message, 'Pristup nije dozvoljen.');
      assert.equal(observer.getCurrentResult().data, undefined);
      assert.match(requested, /machineId=m/); assert.match(requested, /page=2/);
      fail = false;
      await observer.refetch();
      assert.equal(observer.getCurrentResult().isSuccess, true, resource);
    } finally { fail = true; unsubscribe(); cache.clear(); fetchMock.mock.restore(); }
  }
});

test('a slow old orders filter cannot overwrite a newer page even when transport ignores abort', async t => {
  const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise<Response>(resolve => {
    requests.push({ signal: options!.signal as AbortSignal, resolve });
  }));
  const cache = client();
  const old = operationalQueryOptions('u', 'DIREKTOR', 'orders', { page: 1, status: 'PLANIRAN', date: '2026-10-01' });
  const next = operationalQueryOptions('u', 'DIREKTOR', 'orders', { page: 2, status: 'ZAVRSEN', date: '2026-10-02' });
  const observer = new QueryObserver(cache, old);
  const unsubscribe = observer.subscribe(() => {});
  try {
    observer.setOptions(next);
    assert.equal(requests[0].signal.aborted, true);
    requests[1].resolve(json({ workOrders: ['new'] })); await settle();
    requests[0].resolve(json({ workOrders: ['old'] })); await settle();
    assert.deepEqual(observer.getCurrentResult().data, { workOrders: ['new'] });
    assert.equal(cache.getQueryData(old.queryKey), undefined);
    assert.equal(observer.getCurrentResult().isError, false);
  } finally { unsubscribe(); cache.clear(); }
});

test('switching workshop tabs aborts the previous tab without displaying cancellation as an error', async t => {
  const requests: { signal: AbortSignal; url: string; resolve: (response: Response) => void }[] = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise<Response>(resolve => {
    requests.push({ url: String(url), signal: options!.signal as AbortSignal, resolve });
  }));
  const cache = client();
  const issueOptions = operationalQueryOptions('u', 'MEHANICAR', 'issues', { page: 2, priority: 'VISOKA' });
  const historyOptions = operationalQueryOptions('u', 'MEHANICAR', 'history', { page: 1, dateTo: '2026-10-31' });
  const issues = new QueryObserver(cache, issueOptions);
  const history = new QueryObserver(cache, { ...historyOptions, enabled: false });
  const offIssues = issues.subscribe(() => {}), offHistory = history.subscribe(() => {});
  try {
    assert.equal(requests.length, 1, 'inactive history does not load');
    issues.setOptions({ ...issueOptions, enabled: false });
    history.setOptions({ ...historyOptions, enabled: true });
    await cancelInactiveWorkshopQueries(cache, 'u', 'MEHANICAR', 'istorijat');
    assert.equal(requests[0].signal.aborted, true); assert.equal(requests[1].signal.aborted, false);
    requests[1].resolve(json({ history: ['service'] })); await settle();
    requests[0].resolve(json({ issues: ['late'] })); await settle();
    assert.deepEqual(history.getCurrentResult().data, { history: ['service'] });
    assert.equal(issues.getCurrentResult().isError, false);
    assert.equal(cache.getQueryData(issueOptions.queryKey), undefined);
  } finally { offIssues(); offHistory(); cache.clear(); }
});

test('unmount aborts reads; user, role, resource, date and pagination have isolated cache keys', async t => {
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const cache = client();
  const observer = new QueryObserver(cache, operationalQueryOptions('u', 'DIREKTOR', 'machines'));
  const unsubscribe = observer.subscribe(() => {});
  assert.equal(signal?.aborted, false); unsubscribe(); assert.equal(signal?.aborted, true); cache.clear();
  const keys = [
    operationalQueryOptions('u', 'DIREKTOR', 'orders', { page: 1 }),
    operationalQueryOptions('u', 'DIREKTOR', 'orders', { page: 2 }),
    operationalQueryOptions('other', 'DIREKTOR', 'orders', { page: 1 }),
    operationalQueryOptions('u', 'OPERATER', 'orders', { page: 1 }),
    operationalQueryOptions('u', 'DIREKTOR', 'issues', { page: 1 }),
    operationalQueryOptions('u', 'DIREKTOR', 'orders', { page: 1, date: '2026-10-01' }),
  ].map(options => JSON.stringify(options.queryKey));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(operationalQueryOptions(undefined, 'OPERATER', 'orders').enabled, false);
});

test('refresh failure is visible even with cached data, and retry restores the same result', async t => {
  let fail = false;
  t.mock.method(globalThis, 'fetch', async () => fail ? json({ error: 'Servis nije dostupan.' }, 503) : json({ issues: ['existing'] }));
  const cache = client();
  const observer = new QueryObserver(cache, operationalQueryOptions('u', 'MEHANICAR', 'issues'));
  const unsubscribe = observer.subscribe(() => {});
  try {
    await settle(); fail = true;
    await cache.invalidateQueries({ queryKey: operationalKey('u', 'MEHANICAR', 'issues') });
    assert.equal(observer.getCurrentResult().isError, true);
    assert.deepEqual(observer.getCurrentResult().data, { issues: ['existing'] });
    fail = false; await observer.refetch(); assert.equal(observer.getCurrentResult().isSuccess, true);
  } finally { unsubscribe(); cache.clear(); }
});

test('network and malformed responses fail clearly; cancellation preserves the abort reason', async t => {
  const controller = new AbortController();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  await assert.rejects(operationalRequest('/work-orders', controller.signal), /Proverite vezu/);
  fetchMock.mock.mockImplementation(async () => new Response('<html>Gateway error</html>', { status: 502 }));
  await assert.rejects(operationalRequest('/work-orders', controller.signal), /HTTP 502/);
  fetchMock.mock.mockImplementation(async () => new Response('invalid json', { status: 200 }));
  await assert.rejects(operationalRequest('/work-orders', controller.signal), /neispravan odgovor/);
  fetchMock.mock.mockImplementation(async () => json({}));
  const cache = client();
  await assert.rejects(cache.fetchQuery(operationalQueryOptions('u', 'DIREKTOR', 'orders')), /neispravan spisak/);
  cache.clear();
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(operationalRequest('/work-orders', controller.signal), error => error === controller.signal.reason);
});

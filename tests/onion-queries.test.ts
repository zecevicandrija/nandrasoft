import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { onionQueryEnabled, invalidateOnionMutation, refreshOnionTab, type TabKey } from '../src/Luk/onionQueries.ts';

const families = ['onion-lookup', 'onion-dashboard', 'onion-lots', 'onion-harvest', 'onion-storage',
  'onion-sorting', 'onion-packaging', 'onion-shipment', 'onion-waste', 'onion-traceability'];
const shared = ['onion-lookup', 'onion-dashboard'];
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function dashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: string[] = [];
  const options = (family: string, tab: TabKey) => ({
    queryKey: [family, 'page-or-filter'], staleTime: 30_000,
    enabled: shared.includes(family) || onionQueryEnabled(family, tab),
    queryFn: async () => { calls.push(family); return calls.length; },
  });
  const observers = families.map((family) => new QueryObserver(client, options(family, 'dovoz')));
  const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
  return {
    client, calls,
    tab(tab: TabKey) { observers.forEach((observer, i) => observer.setOptions(options(families[i], tab))); },
    close() { unsubscribe.forEach((fn) => fn()); client.clear(); },
  };
}

test('initial dashboard loads four queries; tabs and traceability load only when opened and reuse fresh cache', async () => {
  const app = dashboard();
  try {
    await settle();
    assert.deepEqual(app.calls.sort(), [...shared, 'onion-lots', 'onion-harvest'].sort());
    app.calls.length = 0;
    for (const [tab, family] of [['skladiste', 'onion-storage'], ['sortiranje', 'onion-sorting'],
      ['pakovanje', 'onion-packaging'], ['isporuka', 'onion-shipment'], ['otpis', 'onion-waste'],
      ['sledljivost', 'onion-traceability']] as const) {
      app.tab(tab);
      await settle();
      assert.deepEqual(app.calls.splice(0), [family]);
    }
    app.tab('dovoz');
    await settle();
    assert.deepEqual(app.calls, []);
  } finally { app.close(); }
});

test('shipment invalidates related stock and all cached pages, while disabled histories wait until opened', async () => {
  const app = dashboard();
  try {
    await settle();
    app.tab('pakovanje');
    await settle();
    app.client.setQueryData(['onion-packaging', 'another-page'], 'cached page');
    app.client.setQueryData(['onion-sorting', 'another-page'], 'unrelated history');
    app.calls.length = 0;
    await invalidateOnionMutation(app.client, 'shipment');
    assert.deepEqual(app.calls.sort(), [...shared, 'onion-packaging'].sort());
    assert.equal(app.client.getQueryState(['onion-packaging', 'another-page'])?.isInvalidated, true);
    assert.equal(app.client.getQueryState(['onion-sorting', 'another-page'])?.isInvalidated, false);
    assert.equal(app.client.getQueryState(['onion-lots', 'page-or-filter'])?.isInvalidated, true);
    app.calls.length = 0;
    app.tab('dovoz');
    await settle();
    assert.deepEqual(app.calls, ['onion-lots']);
  } finally { app.close(); }
});

test('chamber changes refresh storage without invalidating harvest, packaging or shipment', async () => {
  const app = dashboard();
  try {
    await settle();
    app.tab('skladiste');
    await settle();
    app.calls.length = 0;
    await invalidateOnionMutation(app.client, 'chamber');
    assert.deepEqual(app.calls.sort(), [...shared, 'onion-storage'].sort());
    for (const family of ['onion-harvest', 'onion-packaging', 'onion-shipment']) {
      assert.equal(app.client.getQueryState([family, 'page-or-filter'])?.isInvalidated, false);
    }
    app.calls.length = 0;
    await refreshOnionTab(app.client, 'skladiste');
    assert.deepEqual(app.calls.sort(), [...shared, 'onion-storage'].sort());
  } finally { app.close(); }
});

test('harvest with auto-storage and sorting invalidate storage; creating a buyer leaves stock fresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const reset = () => families.forEach((family) => client.setQueryData([family], 'fresh'));
  try {
    reset();
    await invalidateOnionMutation(client, 'harvest');
    assert.equal(client.getQueryState(['onion-storage'])?.isInvalidated, false);
    reset();
    await invalidateOnionMutation(client, 'harvestStored');
    assert.equal(client.getQueryState(['onion-storage'])?.isInvalidated, true);
    reset();
    await invalidateOnionMutation(client, 'sorting');
    assert.equal(client.getQueryState(['onion-storage'])?.isInvalidated, true);
    assert.equal(client.getQueryState(['onion-waste'])?.isInvalidated, false);
    reset();
    await invalidateOnionMutation(client, 'buyerCreate');
    assert.equal(client.getQueryState(['onion-lookup'])?.isInvalidated, true);
    assert.equal(client.getQueryState(['onion-dashboard'])?.isInvalidated, false);
    assert.equal(client.getQueryState(['onion-shipment'])?.isInvalidated, false);
  } finally { client.clear(); }
});

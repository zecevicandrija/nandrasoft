import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  onionQueryEnabled,
  onionSharedQueryEnabled,
  onionTabRequiresSharedData,
  parseOnionTab,
  invalidateOnionMutation,
  refreshOnionTab,
  type TabKey,
} from '../src/Luk/onionQueries.ts';

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
    for (const [tab, family] of [['skladiste', 'onion-storage'],
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
    assert.equal(client.getQueryState(['onion-waste'])?.isInvalidated, true);
    reset();
    await invalidateOnionMutation(client, 'buyerCreate');
    assert.equal(client.getQueryState(['onion-lookup'])?.isInvalidated, true);
    assert.equal(client.getQueryState(['onion-dashboard'])?.isInvalidated, false);
    assert.equal(client.getQueryState(['onion-shipment'])?.isInvalidated, false);
  } finally { client.clear(); }
});

test('nalozi tab relies only on onion-orders in a fresh session and stays visible when lookup/dashboard fail or stall', async () => {
  assert.equal(parseOnionTab('nalozi'), 'nalozi');
  assert.equal(parseOnionTab('pakovanje'), 'pakovanje');
  assert.equal(parseOnionTab('nepoznat'), 'nalozi');
  assert.equal(parseOnionTab(null), 'nalozi');

  assert.equal(onionTabRequiresSharedData('nalozi'), false);
  assert.equal(onionTabRequiresSharedData('dovoz'), true);
  assert.equal(onionTabRequiresSharedData('skladiste'), true);
  assert.equal(onionTabRequiresSharedData('pakovanje'), true);

  assert.equal(onionSharedQueryEnabled('onion-dashboard', 'nalozi'), false);
  assert.equal(onionSharedQueryEnabled('onion-lookup', 'nalozi', false), false);
  assert.equal(onionSharedQueryEnabled('onion-lookup', 'nalozi', true), true);
  assert.equal(onionSharedQueryEnabled('onion-dashboard', 'skladiste'), true);
  assert.equal(onionSharedQueryEnabled('onion-lookup', 'skladiste'), true);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: string[] = [];
  let lookupShouldFail = true;

  const ordersObserver = new QueryObserver(client, {
    queryKey: ['onion-orders', 1],
    enabled: onionQueryEnabled('onion-orders', 'nalozi'),
    queryFn: async () => {
      calls.push('onion-orders');
      return { total: 1, orders: [{ id: 'ord-1', orderNumber: 'RN-2026-0001', plannedLotNumber: 'LOT-01' }] };
    },
  });
  const lookupObserver = new QueryObserver(client, {
    queryKey: ['onion-lookup'],
    enabled: onionSharedQueryEnabled('onion-lookup', 'nalozi', false),
    queryFn: async () => {
      calls.push('onion-lookup');
      if (lookupShouldFail) throw new Error('Lookup unavailable');
      return { allLots: [{ id: 'lot-1', lotNumber: 'LOT-01' }] };
    },
  });
  const dashboardObserver = new QueryObserver(client, {
    queryKey: ['onion-dashboard'],
    enabled: onionSharedQueryEnabled('onion-dashboard', 'nalozi'),
    queryFn: async () => {
      calls.push('onion-dashboard');
      throw new Error('Dashboard unavailable');
    },
  });

  const offOrders = ordersObserver.subscribe(() => {});
  const offLookup = lookupObserver.subscribe(() => {});
  const offDashboard = dashboardObserver.subscribe(() => {});

  try {
    // 1. Fresh session on nalozi only loads onion-orders — lookup & dashboard do not block or even fire
    await settle();
    assert.deepEqual(calls, ['onion-orders']);
    assert.equal(ordersObserver.getCurrentResult().data?.orders.length, 1);
    assert.equal(ordersObserver.getCurrentResult().data?.orders[0].plannedLotNumber, 'LOT-01');

    // 2. Refreshing nalozi tab refreshes only onion-orders
    calls.length = 0;
    await refreshOnionTab(client, 'nalozi');
    await settle();
    assert.deepEqual(calls, ['onion-orders']);

    // 3. Opening a specific order modal enables lookup on demand; failure does not break orders list, and retry recovers
    calls.length = 0;
    lookupObserver.setOptions({
      queryKey: ['onion-lookup'],
      enabled: onionSharedQueryEnabled('onion-lookup', 'nalozi', true),
      queryFn: async () => {
        calls.push('onion-lookup');
        if (lookupShouldFail) throw new Error('Lookup unavailable');
        return { allLots: [{ id: 'lot-1', lotNumber: 'LOT-01' }] };
      },
    });
    await settle();
    assert.deepEqual(calls, ['onion-lookup']);
    assert.equal(lookupObserver.getCurrentResult().isError, true);
    assert.equal(ordersObserver.getCurrentResult().data?.orders.length, 1);

    lookupShouldFail = false;
    await lookupObserver.refetch();
    assert.equal(lookupObserver.getCurrentResult().isSuccess, true);
    assert.equal(lookupObserver.getCurrentResult().data?.allLots[0].lotNumber, 'LOT-01');
  } finally {
    offOrders();
    offLookup();
    offDashboard();
    client.clear();
  }
});

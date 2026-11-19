import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { operationalQueryOptions } from '../src/lib/operationalQueries.ts';
import {
  invalidateFieldWorkCompletionQueries,
  parseWorkShift,
  resolveOrderInitialShift,
} from '../src/lib/fieldWorkOrder.ts';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const json = (body: unknown, status = 200) => Response.json(body, { status });

test('parseWorkShift accepts only valid shift enums', () => {
  assert.equal(parseWorkShift('PRVA'), 'PRVA');
  assert.equal(parseWorkShift('DRUGA'), 'DRUGA');
  assert.equal(parseWorkShift('TRECA'), 'TRECA');
  assert.equal(parseWorkShift(''), null);
  assert.equal(parseWorkShift('NOCNA'), null);
  assert.equal(parseWorkShift(undefined), null);
});

test('first open without a draft adopts second and third shift from the work order', () => {
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: false,
      shiftTouched: false,
      currentShift: 'PRVA',
      orderShift: 'DRUGA',
    }),
    'DRUGA'
  );
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: false,
      shiftTouched: false,
      currentShift: 'PRVA',
      orderShift: 'TRECA',
    }),
    'TRECA'
  );
  // Authoritative order shift overrides a stale query-param shift when no draft or manual edit exists
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: false,
      shiftTouched: false,
      currentShift: 'DRUGA',
      orderShift: 'TRECA',
      paramShift: 'DRUGA',
    }),
    'TRECA'
  );
  // Falls back to URL param when order payload has no shift
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: false,
      shiftTouched: false,
      currentShift: 'PRVA',
      orderShift: undefined,
      paramShift: 'DRUGA',
    }),
    'DRUGA'
  );
});

test('existing draft or manual user selection preserves its shift over the work order shift', () => {
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: true,
      shiftTouched: false,
      currentShift: 'PRVA',
      orderShift: 'DRUGA',
      paramShift: 'DRUGA',
    }),
    'PRVA'
  );
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: true,
      shiftTouched: false,
      currentShift: 'TRECA',
      orderShift: 'DRUGA',
      paramShift: 'DRUGA',
    }),
    'TRECA'
  );
  assert.equal(
    resolveOrderInitialShift({
      hasDraft: false,
      shiftTouched: true,
      currentShift: 'PRVA',
      orderShift: 'TRECA',
      paramShift: 'TRECA',
    }),
    'PRVA'
  );
});

test('completing field work invalidates cached orders list even within the 2-minute staleTime', async (t) => {
  let orderStatus = 'U_TOKU';
  let fetches = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    return json({
      workOrders: [{ id: 'order-2', status: orderStatus, shift: 'DRUGA' }],
      pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
      stats: {
        totalOrders: 1,
        pendingOrders: 0,
        inProgressOrders: orderStatus === 'U_TOKU' ? 1 : 0,
        completedOrders: orderStatus === 'ZAVRSEN' ? 1 : 0,
      },
    });
  });

  // Match main.tsx QueryClient staleTime (2 minutes)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 1000 * 60 * 2,
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  const ordersOpts = operationalQueryOptions<{ workOrders: Array<{ id: string; status: string; shift: string }> }>(
    'user-1',
    'RUKOVODILAC',
    'orders',
    { page: 1, limit: 25 }
  );

  // 1. User visits /nalozi and sees order in U_TOKU
  const firstVisit = new QueryObserver(queryClient, ordersOpts);
  const unsubscribeFirst = firstVisit.subscribe(() => {});
  try {
    await settle();
    assert.equal(fetches, 1);
    assert.equal(firstVisit.getCurrentResult().data?.workOrders[0]?.status, 'U_TOKU');
  } finally {
    // 2. User navigates away to /radovi/novi (orders list query becomes inactive, still fresh in cache)
    unsubscribeFirst();
  }

  // Also seed detail & related queries that should be invalidated
  queryClient.setQueryData(['work-order-detail', 'order-2'], { workOrder: { id: 'order-2', status: 'U_TOKU' } });
  queryClient.setQueryData(['operational', 'user-1', 'RUKOVODILAC', 'machines', ''], { machines: [] });
  queryClient.setQueryData(['field-works'], { works: [] });

  // 3. Backend finishes the order and BrziUnosRada invalidates queries on success
  orderStatus = 'ZAVRSEN';
  await invalidateFieldWorkCompletionQueries(queryClient, 'order-2');

  assert.equal(queryClient.getQueryState(['work-order-detail', 'order-2'])?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(['operational', 'user-1', 'RUKOVODILAC', 'machines', ''])?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(['field-works'])?.isInvalidated, true);

  // 4. User returns to /nalozi immediately (well inside 2-minute staleTime)
  const returnVisit = new QueryObserver(queryClient, ordersOpts);
  const unsubscribeReturn = returnVisit.subscribe(() => {});
  try {
    await settle();
    assert.equal(fetches, 2, 'returning to /nalozi immediately refetches the invalidated orders list');
    assert.equal(returnVisit.getCurrentResult().data?.workOrders[0]?.status, 'ZAVRSEN');
  } finally {
    unsubscribeReturn();
    queryClient.clear();
    fetchMock.mock.restore();
  }
});

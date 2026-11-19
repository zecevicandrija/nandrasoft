import type { QueryClient } from '@tanstack/react-query';
import { masterQueryKeys } from './masterQueryKeys.ts';

export type WorkShift = 'PRVA' | 'DRUGA' | 'TRECA';

export function parseWorkShift(value: unknown): WorkShift | null {
  return value === 'PRVA' || value === 'DRUGA' || value === 'TRECA' ? value : null;
}

export function resolveOrderInitialShift(params: {
  hasDraft: boolean;
  shiftTouched: boolean;
  currentShift: WorkShift;
  orderShift?: unknown;
  paramShift?: unknown;
}): WorkShift {
  if (params.hasDraft || params.shiftTouched) {
    return params.currentShift;
  }
  return parseWorkShift(params.orderShift) ?? parseWorkShift(params.paramShift) ?? params.currentShift;
}

export function invalidateFieldWorkCompletionQueries(
  queryClient: QueryClient,
  workOrderId?: string | null
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['field-works'] }),
    queryClient.invalidateQueries({ queryKey: ['field-work-stats'] }),
    queryClient.invalidateQueries({ queryKey: ['assignments-active'] }),
    queryClient.invalidateQueries({ queryKey: ['assignments-stats'] }),
    queryClient.invalidateQueries({ queryKey: ['assignments-history'] }),
    queryClient.invalidateQueries({ queryKey: masterQueryKeys.machines }),
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'operational' &&
        (query.queryKey[3] === 'orders' || query.queryKey[3] === 'machines'),
    }),
    queryClient.invalidateQueries({
      queryKey: workOrderId ? ['work-order-detail', workOrderId] : ['work-order-detail'],
    }),
    queryClient.invalidateQueries({ queryKey: ['machine-usage'] }),
  ]);
}

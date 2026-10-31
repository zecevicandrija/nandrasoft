import { queryOptions, type QueryClient } from '@tanstack/react-query';

const endpoints = {
  orders: '/work-orders', issues: '/maintenance/issues', remont: '/maintenance/remont-orders',
  history: '/maintenance/history', stats: '/maintenance/stats',
  workers: '/master/workers', machines: '/master/machines', parcels: '/master/parcels', workTypes: '/master/work-types',
};
export type OperationalResource = keyof typeof endpoints;
export type WorkshopTab = 'kvarovi' | 'nalozi' | 'istorijat';
export type OperationalParams = Record<string, string | number | undefined>;
export const operationalKey = (userId: string | undefined, role: string, resource?: OperationalResource) =>
  resource ? ['operational', userId, role, resource] as const : ['operational', userId, role] as const;

export async function operationalRequest<T>(path: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'include', signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Nije moguće povezati se sa serverom. Proverite vezu i pokušajte ponovo.', { cause: error });
  }
  // Some transports ignore aborts; never commit their late response to the cache.
  signal.throwIfAborted();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    signal.throwIfAborted();
    throw new Error(typeof body?.error === 'string' ? body.error : `Učitavanje nije uspelo (HTTP ${response.status}).`);
  }
  try {
    const body = await response.json();
    signal.throwIfAborted();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid response');
    return body;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Server je vratio neispravan odgovor. Pokušajte ponovo.', { cause: error });
  }
}

export function operationalQueryOptions<T>(userId: string | undefined, role: string, resource: OperationalResource, params: OperationalParams = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  search.sort();
  const query = search.toString();
  return queryOptions({
    queryKey: [...operationalKey(userId, role, resource), query],
    queryFn: async ({ signal }) => {
      const data = await operationalRequest<Record<string, unknown>>(`${endpoints[resource]}${query ? `?${query}` : ''}`, signal);
      const listFields = { orders: 'workOrders', issues: 'issues', remont: 'orders', history: 'history',
        workers: 'workers', machines: 'machines', parcels: 'parcels', workTypes: 'workTypes' };
      if (resource !== 'stats' && !Array.isArray(data[listFields[resource]])) {
        throw new Error('Server je vratio neispravan spisak podataka. Pokušajte ponovo.');
      }
      return data as T;
    },
    enabled: Boolean(userId),
  });
}

const workshopResources = { kvarovi: 'issues', nalozi: 'remont', istorijat: 'history' } as const;
export function cancelInactiveWorkshopQueries(client: QueryClient, userId: string | undefined, role: string, tab: WorkshopTab) {
  return Promise.all((['issues', 'remont', 'history'] as const).filter(resource => resource !== workshopResources[tab])
    .map(resource => client.cancelQueries({ queryKey: operationalKey(userId, role, resource) })));
}

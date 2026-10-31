import { queryOptions } from '@tanstack/react-query';

const endpoints = {
  machines: '/master/machines', workers: '/master/workers', partners: '/master/partners',
  stats: '/fuel/stats', entries: '/fuel/entries', supplies: '/fuel/supplies',
};

export async function fuelRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, credentials: 'include' });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Nije moguće povezati se sa serverom. Proverite vezu i pokušajte ponovo.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : `Učitavanje nije uspelo (HTTP ${response.status}).`);
  }
  return response.json();
}

export function fuelQueryOptions<T>(userId: string | undefined, resource: keyof typeof endpoints,
  params: Record<string, string | number | boolean | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  search.sort();
  const query = search.toString();
  const master = ['machines', 'workers', 'partners'].includes(resource);
  return queryOptions({
    queryKey: [master ? 'fuel-master' : 'fuel', userId, resource, query],
    queryFn: ({ signal }) => fuelRequest<T>(`${endpoints[resource]}${query ? `?${query}` : ''}`, { signal }),
    enabled: Boolean(userId),
  });
}

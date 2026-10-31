import type { QueryClient } from '@tanstack/react-query';

export type TabKey = 'dovoz' | 'skladiste' | 'sortiranje' | 'pakovanje' | 'isporuka' | 'otpis' | 'sledljivost';

const tabQueries: Record<TabKey, readonly string[]> = {
  dovoz: ['onion-harvest', 'onion-lots'],
  skladiste: ['onion-storage'],
  sortiranje: ['onion-sorting'],
  pakovanje: ['onion-packaging'],
  isporuka: ['onion-shipment'],
  otpis: ['onion-waste'],
  sledljivost: ['onion-traceability'],
};

export function onionQueryEnabled(family: string, tab: TabKey) {
  return tabQueries[tab].includes(family);
}

const stockQueries = ['onion-lookup', 'onion-dashboard', 'onion-lots', 'onion-traceability'];
// Include indirect stock changes and embedded names, not unrelated histories.
const mutationQueries = {
  harvest: [...stockQueries, 'onion-harvest'],
  harvestStored: [...stockQueries, 'onion-harvest', 'onion-storage'],
  storage: [...stockQueries, 'onion-storage'],
  chamber: ['onion-lookup', 'onion-dashboard', 'onion-storage', 'onion-traceability'],
  sorting: [...stockQueries, 'onion-storage', 'onion-sorting'],
  packaging: [...stockQueries, 'onion-packaging'],
  packagingUpdate: [...stockQueries, 'onion-packaging', 'onion-shipment'],
  shipment: [...stockQueries, 'onion-packaging', 'onion-shipment'],
  waste: [...stockQueries, 'onion-storage', 'onion-waste'],
  parcelCreate: ['onion-lookup'],
  parcelUpdate: ['onion-lookup', 'onion-dashboard', 'onion-lots', 'onion-harvest', 'onion-storage',
    'onion-sorting', 'onion-packaging', 'onion-shipment', 'onion-waste', 'onion-traceability'],
  buyerCreate: ['onion-lookup', 'partners'],
  buyerUpdate: ['onion-lookup', 'onion-shipment', 'onion-traceability', 'partners'],
};

export function invalidateOnionMutation(client: QueryClient, mutation: keyof typeof mutationQueries) {
  return Promise.all(mutationQueries[mutation].map((family) =>
    client.invalidateQueries({ queryKey: [family] })
  ));
}

export function refreshOnionTab(client: QueryClient, tab: TabKey) {
  return Promise.all(['onion-lookup', 'onion-dashboard', ...tabQueries[tab]].map((family) =>
    client.invalidateQueries({ queryKey: [family] })
  ));
}

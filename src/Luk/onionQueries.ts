import type { QueryClient } from '@tanstack/react-query';

export type TabKey = 'nalozi' | 'dovoz' | 'skladiste' | 'pakovanje' | 'isporuka' | 'otpis' | 'sledljivost';

export const ONION_TABS: readonly TabKey[] = [
  'nalozi',
  'dovoz',
  'skladiste',
  'pakovanje',
  'isporuka',
  'otpis',
  'sledljivost',
];

const tabQueries: Record<TabKey, readonly string[]> = {
  nalozi: ['onion-orders'],
  dovoz: ['onion-harvest', 'onion-lots'],
  skladiste: ['onion-storage'],
  pakovanje: ['onion-packaging'],
  isporuka: ['onion-shipment'],
  otpis: ['onion-waste'],
  sledljivost: ['onion-traceability'],
};

export function parseOnionTab(value: string | null | undefined): TabKey {
  return ONION_TABS.includes(value as TabKey) ? (value as TabKey) : 'nalozi';
}

export function onionQueryEnabled(family: string, tab: TabKey) {
  return tabQueries[tab].includes(family);
}

export function onionTabRequiresSharedData(tab: TabKey) {
  return tab !== 'nalozi';
}

export function onionSharedQueryEnabled(
  family: 'onion-lookup' | 'onion-dashboard',
  tab: TabKey,
  needsExecutionLookup = false
) {
  if (tab === 'nalozi') {
    return family === 'onion-lookup' ? needsExecutionLookup : false;
  }
  return true;
}

const stockQueries = ['onion-lookup', 'onion-dashboard', 'onion-lots', 'onion-traceability'];
// Include indirect stock changes and embedded names, not unrelated histories.
const mutationQueries = {
  harvest: [...stockQueries, 'onion-harvest'],
  harvestStored: [...stockQueries, 'onion-harvest', 'onion-storage'],
  storage: [...stockQueries, 'onion-storage'],
  chamber: ['onion-lookup', 'onion-dashboard', 'onion-storage', 'onion-traceability'],
  sorting: [...stockQueries, 'onion-storage', 'onion-packaging', 'onion-waste'],
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
  const families = tab === 'nalozi'
    ? [...tabQueries[tab]]
    : ['onion-lookup', 'onion-dashboard', ...tabQueries[tab]];
  return Promise.all(families.map((family) =>
    client.invalidateQueries({ queryKey: [family] })
  ));
}

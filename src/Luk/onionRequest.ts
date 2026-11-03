import { operationalRequest } from '../lib/operationalQueries.ts';

const collections: Record<string, string> = {
  '/lots': 'lots', '/harvest': 'arrivals', '/storage': 'entries', '/sorting': 'sortings',
  '/packaging': 'packagings', '/shipment': 'shipments', '/waste': 'wastes',
};

export async function onionRequest(path: string, signal: AbortSignal): Promise<any> {
  const data = await operationalRequest<Record<string, any>>(`/onion${path}`, signal);
  const resource = path.split('?')[0];
  const collection = collections[resource];
  const invalid = collection ? !Array.isArray(data[collection])
    : resource === '/lookup' ? !['chambers', 'allLots', 'activeLots', 'parcels', 'machines', 'workers', 'buyers', 'availablePackagings'].every((key) => Array.isArray(data[key]))
      : resource === '/dashboard' ? !data.kpi || typeof data.kpi !== 'object' || !Array.isArray(data.chambersSummary) ||
        !['totalChambersCount', 'maxColdStorageBoxes', 'maxColdStorageKg', 'totalHarvestedKg'].every((key) => Number.isFinite(data.kpi[key]))
        : resource.startsWith('/traceability/') ? !data.lot || !Array.isArray(data.timeline) || !Array.isArray(data.turas)
          : false;
  if (invalid) throw new Error('Server je vratio nepotpune podatke za modul luk. Pokušajte ponovo.');
  return data;
}

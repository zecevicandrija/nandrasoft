import { queryOptions } from '@tanstack/react-query';

export type MaterialKind = 'FERTILIZER' | 'CHEMICAL' | 'SEED';
export interface MaterialProduct {
  id: string; code?: string | null; name: string; unit: string;
  activeIngredient?: string | null; crop?: string; variety?: string | null;
  manufacturer?: string | null; notes?: string | null;
}
export interface MaterialCatalogueResponse {
  items: MaterialProduct[];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextCursor?: string | null;
}
export interface WorkMaterial {
  kind: MaterialKind; productId: string; code?: string | null; name: string;
  unit: string; dosePerHa?: number | null; notes?: string | null;
}
export interface MaterialOperation { materialKind?: MaterialKind | null; materialRequired?: boolean }
export const materialLabels: Record<MaterialKind, string> = { FERTILIZER: 'Đubrivo', CHEMICAL: 'Preparati za prskanje', SEED: 'Seme / sorta / hibrid' };
export const materialUnits: Record<string, string> = { KG: 'kg', L: 'l', G: 'g', ML: 'ml', SEME: 'semena', PAKOVANJE: 'pakovanja', TONA: 't', KOM: 'kom', SJ: 'SJ' };

export function parseMaterialDose(text: string): { value: number | null; error: string } {
  if (!text.trim()) return { value: null, error: '' };
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return { value: null, error: 'Unesite dozu kao broj, npr. 0,25.' };
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > 1e12) return { value: null, error: 'Doza mora biti veća od 0 i najviše 1000000000000.' };
  return { value, error: '' };
}

export function materialPayload(items: WorkMaterial[] = []) {
  return items.map(({ kind, productId, dosePerHa, notes }) => ({ kind, productId, dosePerHa: dosePerHa ?? null, notes: notes || null }));
}

export async function materialRequest<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'include', signal });
  const data = await response.json();
  signal?.throwIfAborted();
  if (!response.ok) throw new Error(data.error || 'Učitavanje materijala nije uspelo.');
  return data as T;
}

export function materialSearchOptions(kind: MaterialKind, search: string, active = true) {
  const q = search.trim();
  const valid = q.replace(/[^\p{L}\p{N}]/gu, '').length >= 2;
  return queryOptions({
    queryKey: ['material-search', kind, q],
    queryFn: async ({ signal }): Promise<{ items: MaterialProduct[]; hasMore: boolean }> => {
      if (!valid) return { items: [], hasMore: false };
      const data = await materialRequest<{ items: MaterialProduct[]; hasMore: boolean }>(`/materials/search/${kind}?q=${encodeURIComponent(q)}&limit=10`, signal);
      if (!Array.isArray(data.items) || data.items.length > 10 || typeof data.hasMore !== 'boolean') throw new Error('Server je vratio neispravan spisak materijala.');
      return data;
    },
    enabled: valid && active,
    staleTime: 5 * 60_000, gcTime: 10 * 60_000, refetchOnWindowFocus: false,
  });
}

export function materialSummary(items: WorkMaterial[] = []) {
  return items.map(item => `${item.name}${item.dosePerHa != null ? ` (${item.dosePerHa} ${materialUnits[item.unit] || item.unit}/ha)` : ''}${item.notes ? ` — ${item.notes}` : ''}`).join('; ');
}

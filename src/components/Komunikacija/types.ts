import type { PackingPlan } from '../../Luk/PackingFields';
import type { MaterialKind, WorkMaterial } from '../../lib/workMaterials';

export type Named = {
  canReceivePackingOrder?: boolean;
  id: string;
  name: string;
  type?: string;
  brandModel?: string | null;
  status?: string;
  role?: string | null;
  category?: string;
  materialKind?: MaterialKind | null;
  materialRequired?: boolean;
};

export type ProposalMaterialPayload = {
  kind: MaterialKind;
  productId: string;
  dosePerHa?: number | null;
  notes?: string | null;
};

export type ProposalLabels = {
  lotNumber?: string;
  workerId?: string;
  machineId?: string;
  attachmentId?: string;
  contractorId?: string;
  parcelId?: string;
  workTypeId?: string;
  workMaterials?: WorkMaterial[];
  [key: string]: string | WorkMaterial[] | undefined;
};

export type ProposalData = {
  title: string;
  packingPlan?: PackingPlan;
  orderDate: string;
  orderType: string;
  serviceType?: string | null;
  workerId: string | null;
  machineId: string | null;
  attachmentId: string | null;
  contractorId?: string | null;
  parcelId: string | null;
  workTypeId: string | null;
  shift: string;
  priority: string;
  plannedAreaHa: number | null;
  materials: string;
  workMaterials?: ProposalMaterialPayload[];
  instructions: string;
  photoUrl?: string | null;
  labels?: ProposalLabels;
};

export type Proposal = {
  id: string;
  authorId: string;
  authorName: string;
  reviewerId: string | null;
  status: string;
  version: number;
  contentVersion: number;
  data: ProposalData;
  approvedByName: string | null;
  approvedAt: string | null;
  approvedVersion: number | null;
  workOrderId?: string | null;
  convertedById?: string | null;
  convertedByName?: string | null;
  convertedAt?: string | null;
  convertedOrderNumber?: string | null;
  updatedAt: string;
};

export type Message = {
  id: string;
  authorId?: string;
  authorName: string;
  body: string;
  proposalId?: string | null;
  proposalVersion?: number | null;
  createdAt: string;
};

export type Notice = {
  id: string;
  title: string;
  messageId: string | null;
  proposalId: string | null;
  createdAt?: string;
};

export type History = {
  id: string;
  actorId?: string;
  actorName: string;
  action: string;
  version: number;
  contentVersion: number;
  body: string | null;
  snapshot: ProposalData | null;
  createdAt: string;
};

export type Catalog = {
  workers: Named[];
  machines: Named[];
  parcels: Named[];
  workTypes: Named[];
  directors: Named[];
};

export type Page<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  approvedPendingCount?: number;
};

export type ConvertProposalResult = {
  proposal: Proposal;
  workOrder: {
    id: string;
    orderNumber: string;
    [key: string]: unknown;
  };
};

export type WorkerEvidence = {
  id: string;
  source: string;
  reportedAt: string;
  location: string | null;
};

export type WorkerPlannedOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status?: string;
  parcel: Named | null;
  machine?: Named | null;
  workType: Named | null;
};

export type WorkerRow = Named & {
  role: string | null;
  type: string;
  status: string;
  locations: Named[];
  machines: Named[];
  attachments: Named[];
  jobs: string[];
  evidence: WorkerEvidence[];
  planned: WorkerPlannedOrder[];
};

export type OverviewMachine = Named & {
  status: string;
  workers: WorkerRow[];
};

export type OverviewSeasonalWorker = Named & {
  groupName: string | null;
  workLogs: {
    date: string;
    parcel: Named | null;
    jobDescription: string;
  }[];
};

export type OverviewStats = {
  totalWorkers: number;
  evidentirano: number;
  provera: number;
  nepoznato: number;
  totalMachines: number;
  zaduzene: number;
  slobodne: number;
  uKvaru: number;
  servis: number;
  problemMasine: number;
  totalSeasonal: number;
  seasonalWithLogs: number;
};

export type Overview = {
  view?: 'workers' | 'machines' | 'seasonal';
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  stats?: OverviewStats;
  workers: WorkerRow[];
  machines: OverviewMachine[];
  seasonalWorkers: OverviewSeasonalWorker[];
  fetchedAt: string;
};

export const statusLabels: Record<string, string> = {
  NACRT: 'Nacrt',
  NA_PREGLEDU: 'Na pregledu',
  VRACEN_NA_DORADU: 'Vraćen na doradu',
  ODOBREN: 'Odobren',
  OTKAZAN: 'Otkazan',
  PROVERA: 'Proveriti evidencije',
  EVIDENTIRANO: 'Evidentirano mesto rada',
  NEPOZNATO: 'Lokacija nije poznata',
  SLOBODNA: 'Slobodna',
  ZADUZENA: 'Zadužena',
  U_KVARU: 'U kvaru',
  SERVIS: 'Na servisu',
};

export const actionLabels: Record<string, string> = {
  create: 'Kreiran predlog',
  edit: 'Izmenjen sadržaj',
  submit: 'Poslat na pregled',
  approve: 'Odobren predlog',
  'request-changes': 'Vraćen na doradu',
  cancel: 'Povučen predlog',
  convert: 'Pretvoren u radni nalog',
  comment: 'Komentar',
};

export const orderTypeLabels: Record<string, string> = {
  PAKOVANJE: 'Pakovanje',
  RAD_NJIVA: 'Rad na njivi',
  REMONT_SERVIS: 'Remont / servis',
  OSTALO: 'Ostalo',
};

export const serviceTypeLabels: Record<string, string> = {
  REDOVAN_SERVIS: 'Redovan servis (zamena ulja/filtera)',
  GENERALNI_REMONT: 'Generalni remont mehanizacije',
  KVAR_NJIVA: 'Vanredni kvar sa terena/njive',
};

export const shiftLabels: Record<string, string> = {
  PRVA: '1. smena (Jutarnja)',
  DRUGA: '2. smena (Popodnevna)',
  TRECA: '3. smena (Noćna)',
};

export const priorityLabels: Record<string, string> = {
  NORMALNO: 'Normalno',
  HITNO: 'Hitno',
  KRITICNO: 'Kritično',
  NISKA: 'Nizak prioritet',
  SREDNJA: 'Srednji prioritet',
  VISOKA: 'Visok prioritet',
  KRITICNA: 'Kritičan prioritet',
};

export const machineTypeLabels: Record<string, string> = {
  TRAKTOR: 'Traktor',
  PRIKLJUCAK: 'Priključak',
  KOMBAJN: 'Kombajn',
  KAMION: 'Kamion',
  VILJUSKAR: 'Viljuškar',
  OSTALO: 'Ostalo',
};

export const roleLabels: Record<string, string> = {
  DIREKTOR: 'Direktor',
  RUKOVODILAC: 'Rukovodilac',
  MAGACIN: 'Magacioner',
  MEHANICAR: 'Mehaničar',
  OPERATER: 'Operater',
  STALNI: 'Stalni radnik',
  SEZONAC: 'Sezonac',
};

export const PAGE_SIZE = 30;
export const PROPOSAL_PAGE_SIZE = 10;
export const OVERVIEW_PAGE_SIZE = 10;

export const STALE_EVIDENCE_MS = 12 * 3600 * 1000;

export const isEvidenceStale = (reportedAt: string): boolean => {
  const ts = Date.parse(reportedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > STALE_EVIDENCE_MS;
};

const dateTimeFormatter = new Intl.DateTimeFormat('sr-Latn-RS', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const time = (value: string): string => {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dateTimeFormatter.format(dt);
};

export const formatDateShort = (value: string): string => {
  if (!value) return '—';
  const raw = value.slice(0, 10);
  const [y, m, d] = raw.split('-');
  if (y && m && d) return `${d}.${m}.${y}.`;
  return value;
};

export const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export type ApiError = Error & { status?: number };

export async function request<T>(
  path: string,
  body?: unknown,
  method = 'POST',
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const response = await fetch(`/api/communication${path}`, {
    credentials: 'include',
    signal,
    ...(body !== undefined
      ? {
        method,
        headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
        body: JSON.stringify(body),
      }
      : extraHeaders
        ? { headers: extraHeaders }
        : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(result?.error || `Zahtev nije uspeo (${response.status}).`), {
      status: response.status,
    }) as ApiError;
  }
  if (!result) {
    throw Object.assign(new Error('Server je vratio neispravan odgovor.'), {
      status: response.status,
    }) as ApiError;
  }
  return result as T;
}

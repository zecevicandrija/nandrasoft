import { z } from 'zod';
import { materialsSchema } from './workMaterials.js';
import { optionalContractorId } from './contractors.js';
import { photoUrlSchema } from './photoUrl.js';

const optionalId = z.string().max(100).nullable().default(null);
export const proposalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value); return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
  }, 'Neispravan datum.'),
  orderType: z.enum(['RAD_NJIVA', 'REMONT_SERVIS', 'OSTALO']),
  serviceType: z.enum(['REDOVAN_SERVIS', 'GENERALNI_REMONT', 'KVAR_NJIVA']).nullable().optional().default(null),
  workerId: optionalId, machineId: optionalId, attachmentId: optionalId,
  contractorId: optionalContractorId.default(null),
  parcelId: optionalId, workTypeId: optionalId,
  shift: z.enum(['PRVA', 'DRUGA', 'TRECA']),
  priority: z.enum(['NORMALNO', 'HITNO', 'KRITICNO', 'NISKA', 'SREDNJA', 'VISOKA', 'KRITICNA']),
  plannedAreaHa: z.number().positive().max(100000).nullable().default(null),
  materials: z.string().trim().max(3000).default(''),
  workMaterials: materialsSchema.optional().default([]),
  instructions: z.string().trim().max(5000).default(''),
  photoUrl: photoUrlSchema.default(null),
}).strict();
export const textSchema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();
export const changeSchema = z.object({
  version: z.number().int().positive(),
  action: z.enum(['edit', 'submit', 'approve', 'request-changes', 'cancel']),
  data: proposalSchema.optional(), reviewerId: optionalId,
  body: z.string().trim().max(5000).optional(),
}).strict();

export const convertProposalSchema = z.object({
  version: z.number().int().positive().optional(),
  workerId: z.string().trim().min(1).max(100).nullable().optional(),
  contractorId: optionalContractorId,
  materials: materialsSchema.optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  photoUrl: photoUrlSchema,
}).strict();

export function buildProposalOrderInstructions(data, hasStructuredMaterials = false) {
  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  const instructions = typeof data?.instructions === 'string' ? data.instructions.trim() : '';
  const materialsText = typeof data?.materials === 'string' ? data.materials.trim() : '';

  const parts = [];
  if (title && instructions) {
    if (instructions.toLowerCase().startsWith(title.toLowerCase())) {
      parts.push(instructions);
    } else {
      parts.push(`${title}\n${instructions}`);
    }
  } else if (instructions) {
    parts.push(instructions);
  } else if (title) {
    parts.push(title);
  }

  if (materialsText && !hasStructuredMaterials) {
    parts.push(`Materijali: ${materialsText}`);
  }

  const combined = parts.join('\n').trim();
  if (!combined) return null;
  return combined.length > 500 ? `${combined.slice(0, 497)}...` : combined;
}

export function buildWorkOrderInputFromProposal(proposalData, overrides = {}) {
  const workerId =
    overrides.workerId !== undefined && overrides.workerId !== null && overrides.workerId !== ''
      ? overrides.workerId
      : proposalData.workerId;

  if (!workerId) {
    throw communicationError(400, 'Izaberite radnika kome se radni nalog izdaje.');
  }

  const orderType = proposalData.orderType;
  const isRemont = orderType === 'REMONT_SERVIS';
  if (isRemont && !proposalData.machineId) {
    throw communicationError(400, 'Izaberite mašinu ili priključak za remont pre pretvaranja u radni nalog.');
  }

  const materials =
    orderType === 'RAD_NJIVA'
      ? (overrides.materials !== undefined ? overrides.materials : (proposalData.workMaterials ?? []))
      : [];
  const hasStructuredMaterials = materials.length > 0;
  const instructions =
    overrides.instructions !== undefined
      ? (overrides.instructions?.trim() || null)
      : buildProposalOrderInstructions(proposalData, hasStructuredMaterials);

  const contractorId =
    orderType === 'RAD_NJIVA'
      ? (overrides.contractorId !== undefined ? (overrides.contractorId || null) : (proposalData.contractorId || null))
      : null;

  const photoUrl =
    overrides.photoUrl !== undefined ? (overrides.photoUrl || null) : (proposalData.photoUrl || null);

  return {
    orderDate: proposalData.orderDate,
    orderType,
    ...(isRemont ? { serviceType: proposalData.serviceType || 'REDOVAN_SERVIS' } : {}),
    priority: proposalData.priority,
    workerId,
    machineId: proposalData.machineId || null,
    attachmentId: isRemont ? null : (proposalData.attachmentId || null),
    contractorId,
    materials,
    parcelId: isRemont ? null : (proposalData.parcelId || null),
    workTypeId: isRemont ? null : (proposalData.workTypeId || null),
    plannedAreaHa: isRemont ? null : (proposalData.plannedAreaHa ?? null),
    shift: proposalData.shift,
    instructions,
    photoUrl,
  };
}

export function communicationError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function sameProposalContent(previous, incoming) {
  const { labels, ...saved } = previous;
  return JSON.stringify(proposalSchema.parse(saved)) === JSON.stringify(proposalSchema.parse(incoming));
}

export function proposalChange(proposal, input, user) {
  const fail = message => { throw communicationError(409, message); };
  if (proposal.version !== input.version) fail('Predlog je u međuvremenu promenjen. Osvežite ga pre nove izmene.');
  if (proposal.status === 'OTKAZAN') fail('Otkazan predlog se ne može menjati.');
  if (proposal.workOrderId && (input.action === 'edit' || input.action === 'cancel')) {
    fail('Predlog je već pretvoren u radni nalog i ne može se menjati.');
  }
  const next = { version: { increment: 1 } };
  if (input.action === 'edit') {
    if (!input.data) throw communicationError(400, 'Nedostaje sadržaj predloga.');
    if (sameProposalContent(proposal.data, input.data)) return null;
    Object.assign(next, { data: input.data, contentVersion: { increment: 1 }, status: 'NACRT', approvedById: null,
      approvedByName: null, approvedAt: null, approvedVersion: null });
  } else if (input.action === 'submit') {
    if (!['NACRT', 'VRACEN_NA_DORADU'].includes(proposal.status)) fail('Predlog nije spreman za slanje na pregled.');
    Object.assign(next, { status: 'NA_PREGLEDU', reviewerId: input.reviewerId });
  } else if (input.action === 'cancel') {
    if (user.id !== proposal.authorId) throw communicationError(403, 'Samo autor može povući predlog.');
    Object.assign(next, { status: 'OTKAZAN', approvedById: null, approvedByName: null, approvedAt: null, approvedVersion: null });
  } else {
    if (proposal.status !== 'NA_PREGLEDU') fail('Odluka je moguća samo za predlog na pregledu.');
    if (proposal.reviewerId && proposal.reviewerId !== user.id && proposal.authorId !== user.id)
      throw communicationError(403, 'Odluku donosi izabrani direktor ili autor predloga.');
    if (input.action === 'approve') Object.assign(next, { status: 'ODOBREN', approvedById: user.id,
      approvedByName: user.name, approvedAt: new Date(), approvedVersion: proposal.version + 1 });
    else {
      if (!input.body?.trim()) throw communicationError(400, 'Napišite razlog vraćanja na doradu.');
      next.status = 'VRACEN_NA_DORADU';
    }
  }
  return next;
}

// Only active evidence is used. Planned orders never assert physical presence.
export function workerOverview(workers, assignments, works, orders) {
  return workers.map(worker => {
    const activeAssignments = assignments.filter(item => item.workerId === worker.id);
    const activeWorks = works.filter(item => item.workerId === worker.id);
    const activeOrders = orders.filter(item => item.workerId === worker.id && item.status === 'U_TOKU');
    const evidence = [
      ...activeAssignments.map(item => ({ ...item, source: 'Aktivno zaduženje', reportedAt: item.assignedAt })),
      ...activeWorks.map(item => ({ ...item, source: 'Rad u toku', reportedAt: item.updatedAt })),
      ...activeOrders.map(item => ({ ...item, source: 'Nalog u toku', reportedAt: item.updatedAt })),
    ];
    const locations = [...new Map(evidence.filter(item => item.parcel).map(item => [item.parcel.id, item.parcel])).values()];
    const machines = [...new Map(evidence.filter(item => item.machine).map(item => [item.machine.id, item.machine])).values()];
    const attachments = [...new Map([
      ...activeWorks.filter(item => item.attachment).map(item => [item.attachment.id, item.attachment]),
      ...activeAssignments.filter(item => item.machine?.type === 'PRIKLJUCAK').map(item => [item.machine.id, item.machine]),
    ]).values()];
    const jobs = [...new Set(evidence.map(item => item.workType?.name || item.workOrder?.workType?.name).filter(Boolean))];
    return { ...worker, locations, machines, attachments, jobs,
      status: locations.length > 1 ? 'PROVERA' : locations.length ? 'EVIDENTIRANO' : 'NEPOZNATO',
      evidence: evidence.map(item => ({ id: item.id, source: item.source, reportedAt: item.reportedAt, location: item.parcel?.name || null })),
      planned: orders.filter(item => item.workerId === worker.id && ['PLANIRAN', 'DODELJEN'].includes(item.status)) };
  });
}

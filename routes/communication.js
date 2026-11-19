import { notify } from "../lib/directorNotifications.js";
import { canReceivePackingOrder, validatePackingOrder } from "../lib/packingWorkOrders.js";
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import {
  proposalSchema,
  textSchema,
  changeSchema,
  convertProposalSchema,
  buildWorkOrderInputFromProposal,
  proposalChange,
  communicationError,
  workerOverview,
} from '../lib/directorCommunication.js';
import { createWorkOrderSchema, createWorkOrderRecord } from '../lib/workOrderCreate.js';
import { prepareMaterials } from '../lib/workMaterials.js';
import { machineMutation } from '../lib/machineAvailability.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const handle = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Proverite unete podatke.', details: error.issues });
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Zapis nije pronađen.' });
    next(error);
  }
};
const DEFAULT_PAGE_SIZE = 30;
const PROPOSAL_PAGE_SIZE = 10;
const OVERVIEW_PAGE_SIZE = 10;

const paging = (req, defaultLimit = DEFAULT_PAGE_SIZE) => {
  const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
  const limit = z.coerce.number().int().min(1).max(50).default(defaultLimit).parse(req.query.limit);
  return { page, limit, skip: (page - 1) * limit, take: limit };
};
const named = { id: true, name: true };
const parcel = { select: { ...named, code: true } };
const machine = { select: { ...named, type: true } };
const actor = user => ({ actorId: user.id, actorName: user.name });
async function checkedData(db, input) {
  const isRemont = input.orderType === 'REMONT_SERVIS';
  const isPacking = input.orderType === 'PAKOVANJE';
  const normalized = isRemont || isPacking
    ? {
        ...input,
        serviceType: isRemont ? input.serviceType || 'REDOVAN_SERVIS' : null,
        ...(isPacking && { machineId: null, orderDate: input.packingPlan.packagingForm.date }),
        attachmentId: null,
        parcelId: null,
        workTypeId: null,
        plannedAreaHa: null,
        contractorId: null,
        materials: '',
        workMaterials: [],
      }
    : {
        ...input,
        serviceType: null,
      };

  if (isRemont) {
    if (!normalized.machineId) {
      throw communicationError(400, 'Izaberite mašinu ili priključak za remont.');
    }
    if (!normalized.instructions?.trim() || normalized.instructions.trim().length < 3) {
      throw communicationError(400, 'Uputstvo i specifikacija posla za mehaničara su obavezni (najmanje 3 karaktera).');
    }
  }

  const labels = {};
  if (isPacking) {
    const lot = await validatePackingOrder(db, input);
    labels.lotNumber = lot.lotNumber;
  }
  for (const [key, model] of [['workerId', 'worker'], ['machineId', 'machine'], ['attachmentId', 'machine'], ['parcelId', 'parcel'], ['workTypeId', 'workType']]) {
    if (!normalized[key]) continue;
    const item = await db[model].findFirst({ where: { id: normalized[key], isActive: true }, select: { ...named, ...(model === 'machine' ? { type: true } : {}) } });
    if (!item) throw communicationError(400, 'Izabrani radnik, mašina, parcela ili posao više nije aktivan.');
    if (key === 'attachmentId' && item.type !== 'PRIKLJUCAK') throw communicationError(400, 'Izaberite priključnu mašinu.');
    labels[key] = item.name;
  }
  if (normalized.machineId && normalized.machineId === normalized.attachmentId) throw communicationError(400, 'Mašina i priključak moraju biti različiti.');

  const contractorId = normalized.orderType === 'RAD_NJIVA' ? (normalized.contractorId || null) : null;
  if (contractorId) {
    const contractor = await db.contractor.findUnique({ where: { id: contractorId }, select: { id: true, name: true, code: true } });
    if (!contractor) throw communicationError(400, 'Izabrani kooperant ne postoji.');
    labels.contractorId = contractor.code ? `${contractor.name} (${contractor.code})` : contractor.name;
  }

  let workMaterials = [];
  if (normalized.orderType === 'RAD_NJIVA' && normalized.workMaterials?.length) {
    const prepared = await prepareMaterials(db, normalized.workTypeId, normalized.workMaterials, [], { enforceRequired: false });
    workMaterials = prepared.map(({ kind, productId, dosePerHa, notes }) => ({ kind, productId, dosePerHa, notes }));
    labels.workMaterials = prepared.map(({ kind, productId, code, name, unit, dosePerHa, notes }) => ({
      kind, productId, code, name, unit, dosePerHa, notes,
    }));
  }

  return {
    ...normalized,
    contractorId,
    workMaterials,
    photoUrl: normalized.photoUrl || null,
    labels,
  };
}

router.get('/catalog', handle(async (_req, res) => {
  const [workersRaw, machines, parcels, workTypes, directors] = await Promise.all([
    prisma.worker.findMany({
      where: { isActive: true },
      select: { ...named, isActive: true, role: true, type: true, user: { select: { role: true, isActive: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.machine.findMany({ where: { isActive: true }, select: { ...named, type: true, brandModel: true, status: true }, orderBy: { name: 'asc' } }),
    prisma.parcel.findMany({ where: { isActive: true }, select: named, orderBy: { name: 'asc' } }),
    prisma.workType.findMany({
      where: { isActive: true },
      select: { ...named, category: true, materialKind: true, materialRequired: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({ where: { isActive: true, role: 'DIREKTOR' }, select: named, orderBy: { name: 'asc' } }),
  ]);
  const workers = workersRaw.map(({ user, ...worker }) => ({
    ...worker,
    role: user?.role || worker.role || (worker.type === 'SEZONAC' ? 'SEZONAC' : 'OPERATER'),
    canReceivePackingOrder: canReceivePackingOrder({ ...worker, user }),
  }));
  res.json({ workers, machines, parcels, workTypes, directors });
}));

const overviewQuerySchema = z.object({
  view: z.enum(['workers', 'machines', 'seasonal']).default('workers'),
  status: z.string().trim().max(40).optional().default(''),
  q: z.string().trim().max(120).optional().default(''),
});

const sortByIdOrder = (rows, ids) => {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
};

const assignmentSelect = {
  id: true,
  workerId: true,
  machineId: true,
  assignedAt: true,
  parcel,
  machine,
  workOrder: { select: { workType: { select: named } } },
};

const fieldWorkSelect = {
  id: true,
  workerId: true,
  updatedAt: true,
  parcel,
  machine,
  attachment: machine,
  workType: { select: named },
};

const workOrderOverviewSelect = {
  id: true,
  workerId: true,
  orderNumber: true,
  status: true,
  orderDate: true,
  updatedAt: true,
  parcel,
  machine,
  workType: { select: named },
};

router.get('/overview', handle(async (req, res) => {
  const { page, limit, skip, take } = paging(req, OVERVIEW_PAGE_SIZE);
  const { view, status, q } = overviewQuerySchema.parse(req.query);
  const pattern = q ? `%${q}%` : null;

  const payload = await prisma.$transaction(async (db) => {
    const [machineCounts, totalSeasonal, seasonalWithLogs, workerStatRows] = await Promise.all([
      db.machine.groupBy({ by: ['status'], where: { isActive: true }, _count: { _all: true } }),
      db.seasonalWorker.count({ where: { isActive: true } }),
      db.seasonalWorker.count({ where: { isActive: true, workLogs: { some: {} } } }),
      db.$queryRaw(Prisma.sql`
        WITH active_worker_parcels AS (
          SELECT "workerId", "parcelId" FROM machine_assignment WHERE status = 'ZADUZENA' AND "voidedAt" IS NULL AND "parcelId" IS NOT NULL
          UNION
          SELECT "workerId", "parcelId" FROM field_work WHERE status = 'U_TOKU' AND "parcelId" IS NOT NULL
          UNION
          SELECT "workerId", "parcelId" FROM work_order WHERE status = 'U_TOKU' AND "parcelId" IS NOT NULL
        ),
        worker_loc_counts AS (
          SELECT w.id, COUNT(awp."parcelId")::int AS loc_count
          FROM worker w
          LEFT JOIN active_worker_parcels awp ON awp."workerId" = w.id
          WHERE w."isActive" = true
          GROUP BY w.id
        )
        SELECT
          COUNT(*)::int AS "totalWorkers",
          COUNT(*) FILTER (WHERE loc_count = 1)::int AS "evidentirano",
          COUNT(*) FILTER (WHERE loc_count > 1)::int AS "provera",
          COUNT(*) FILTER (WHERE loc_count = 0)::int AS "nepoznato"
        FROM worker_loc_counts
      `),
    ]);

    const machineMap = new Map(machineCounts.map((row) => [row.status, Number(row._count?._all ?? row._count ?? 0)]));
    const zaduzene = machineMap.get('ZADUZENA') || 0;
    const slobodne = machineMap.get('SLOBODNA') || 0;
    const uKvaru = machineMap.get('U_KVARU') || 0;
    const servis = machineMap.get('SERVIS') || 0;
    const wStat = workerStatRows[0] || {};
    const stats = {
      totalWorkers: Number(wStat.totalWorkers || 0),
      evidentirano: Number(wStat.evidentirano || 0),
      provera: Number(wStat.provera || 0),
      nepoznato: Number(wStat.nepoznato || 0),
      totalMachines: zaduzene + slobodne + uKvaru + servis,
      zaduzene,
      slobodne,
      uKvaru,
      servis,
      problemMasine: uKvaru + servis,
      totalSeasonal,
      seasonalWithLogs,
    };

    let total = 0;
    let workers = [];
    let machines = [];
    let seasonalWorkers = [];

    if (view === 'workers') {
      const validWorkerStatus = ['EVIDENTIRANO', 'PROVERA', 'NEPOZNATO'].includes(status) ? status : '';
      let workerIds = [];
      let rawWorkers = [];

      if (!validWorkerStatus && !pattern) {
        total = stats.totalWorkers;
        rawWorkers = await db.worker.findMany({
          where: { isActive: true },
          select: { ...named, role: true, type: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take,
        });
        workerIds = rawWorkers.map((w) => w.id);
      } else {
        const statusCondition =
          validWorkerStatus === 'PROVERA'
            ? Prisma.sql`AND wlc.loc_count > 1`
            : validWorkerStatus === 'EVIDENTIRANO'
              ? Prisma.sql`AND wlc.loc_count = 1`
              : validWorkerStatus === 'NEPOZNATO'
                ? Prisma.sql`AND wlc.loc_count = 0`
                : Prisma.empty;

        const searchCondition = pattern
          ? Prisma.sql`AND (
              w.name ILIKE ${pattern}
              OR COALESCE(w.role::text, '') ILIKE ${pattern}
              OR w.type::text ILIKE ${pattern}
              OR (CASE COALESCE(w.role::text, '')
                WHEN 'DIREKTOR' THEN 'Direktor'
                WHEN 'RUKOVODILAC' THEN 'Rukovodilac'
                WHEN 'MAGACIN' THEN 'Magacioner'
                WHEN 'MEHANICAR' THEN 'Mehaničar'
                WHEN 'OPERATER' THEN 'Operater'
                ELSE '' END) ILIKE ${pattern}
              OR (CASE w.type WHEN 'SEZONAC' THEN 'Sezonac' ELSE 'Stalni radnik' END) ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM machine_assignment ma
                LEFT JOIN parcel p ON p.id = ma."parcelId"
                LEFT JOIN machine m ON m.id = ma."machineId"
                LEFT JOIN work_order wo ON wo.id = ma."workOrderId"
                LEFT JOIN work_type wt ON wt.id = wo."workTypeId"
                WHERE ma."workerId" = w.id AND ma.status = 'ZADUZENA' AND ma."voidedAt" IS NULL
                  AND ('Aktivno zaduženje' ILIKE ${pattern} OR COALESCE(p.name, '') ILIKE ${pattern} OR COALESCE(m.name, '') ILIKE ${pattern} OR COALESCE(wt.name, '') ILIKE ${pattern})
              )
              OR EXISTS (
                SELECT 1 FROM field_work fw
                LEFT JOIN parcel p ON p.id = fw."parcelId"
                LEFT JOIN machine m ON m.id = fw."machineId"
                LEFT JOIN machine a ON a.id = fw."attachmentId"
                LEFT JOIN work_type wt ON wt.id = fw."workTypeId"
                WHERE fw."workerId" = w.id AND fw.status = 'U_TOKU'
                  AND ('Rad u toku' ILIKE ${pattern} OR COALESCE(p.name, '') ILIKE ${pattern} OR COALESCE(m.name, '') ILIKE ${pattern} OR COALESCE(a.name, '') ILIKE ${pattern} OR COALESCE(wt.name, '') ILIKE ${pattern})
              )
              OR EXISTS (
                SELECT 1 FROM work_order wo
                LEFT JOIN parcel p ON p.id = wo."parcelId"
                LEFT JOIN machine m ON m.id = wo."machineId"
                LEFT JOIN work_type wt ON wt.id = wo."workTypeId"
                WHERE wo."workerId" = w.id AND wo.status IN ('PLANIRAN', 'DODELJEN', 'U_TOKU')
                  AND (wo."orderNumber" ILIKE ${pattern} OR COALESCE(p.name, '') ILIKE ${pattern} OR COALESCE(m.name, '') ILIKE ${pattern} OR COALESCE(wt.name, '') ILIKE ${pattern} OR (wo.status = 'U_TOKU' AND 'Nalog u toku' ILIKE ${pattern}))
              )
            )`
          : Prisma.empty;

        const cteSql = Prisma.sql`
          WITH active_worker_parcels AS (
            SELECT "workerId", "parcelId" FROM machine_assignment WHERE status = 'ZADUZENA' AND "voidedAt" IS NULL AND "parcelId" IS NOT NULL
            UNION
            SELECT "workerId", "parcelId" FROM field_work WHERE status = 'U_TOKU' AND "parcelId" IS NOT NULL
            UNION
            SELECT "workerId", "parcelId" FROM work_order WHERE status = 'U_TOKU' AND "parcelId" IS NOT NULL
          ),
          worker_loc_counts AS (
            SELECT w.id, COUNT(awp."parcelId")::int AS loc_count
            FROM worker w
            LEFT JOIN active_worker_parcels awp ON awp."workerId" = w.id
            WHERE w."isActive" = true
            GROUP BY w.id
          )
        `;

        const [idRows, countRows] = await Promise.all([
          db.$queryRaw(Prisma.sql`
            ${cteSql}
            SELECT w.id
            FROM worker w
            JOIN worker_loc_counts wlc ON wlc.id = w.id
            WHERE w."isActive" = true ${statusCondition} ${searchCondition}
            ORDER BY w.name ASC, w.id ASC
            LIMIT ${take} OFFSET ${skip}
          `),
          db.$queryRaw(Prisma.sql`
            ${cteSql}
            SELECT COUNT(*)::int AS total
            FROM worker w
            JOIN worker_loc_counts wlc ON wlc.id = w.id
            WHERE w."isActive" = true ${statusCondition} ${searchCondition}
          `),
        ]);

        total = Number(countRows[0]?.total || 0);
        workerIds = idRows.map((r) => r.id);
        rawWorkers = workerIds.length
          ? sortByIdOrder(
              await db.worker.findMany({ where: { id: { in: workerIds } }, select: { ...named, role: true, type: true } }),
              workerIds
            )
          : [];
      }

      if (workerIds.length) {
        const [assignments, works, orders] = await Promise.all([
          db.machineAssignment.findMany({ where: { workerId: { in: workerIds }, status: 'ZADUZENA', voidedAt: null }, select: assignmentSelect }),
          db.fieldWork.findMany({ where: { workerId: { in: workerIds }, status: 'U_TOKU' }, select: fieldWorkSelect }),
          db.workOrder.findMany({
            where: { workerId: { in: workerIds }, status: { in: ['PLANIRAN', 'DODELJEN', 'U_TOKU'] } },
            select: workOrderOverviewSelect,
            orderBy: { orderDate: 'asc' },
          }),
        ]);
        workers = workerOverview(rawWorkers, assignments, works, orders);
      }
    } else if (view === 'machines') {
      const validMachineStatus = ['SLOBODNA', 'ZADUZENA', 'U_KVARU', 'SERVIS'].includes(status) ? status : '';
      let rawMachines = [];
      let machineIds = [];

      if (!pattern) {
        const machineWhere = { isActive: true, ...(validMachineStatus ? { status: validMachineStatus } : {}) };
        [rawMachines, total] = await Promise.all([
          db.machine.findMany({
            where: machineWhere,
            select: { ...named, type: true, status: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip,
            take,
          }),
          db.machine.count({ where: machineWhere }),
        ]);
        machineIds = rawMachines.map((m) => m.id);
      } else {
        const statusCondition = validMachineStatus ? Prisma.sql`AND m.status::text = ${validMachineStatus}` : Prisma.empty;
        const searchCondition = Prisma.sql`AND (
          m.name ILIKE ${pattern}
          OR m.type::text ILIKE ${pattern}
          OR m.status::text ILIKE ${pattern}
          OR (CASE m.status::text
            WHEN 'SLOBODNA' THEN 'Slobodna'
            WHEN 'ZADUZENA' THEN 'Zadužena'
            WHEN 'U_KVARU' THEN 'U kvaru'
            WHEN 'SERVIS' THEN 'Na servisu'
            ELSE '' END) ILIKE ${pattern}
          OR EXISTS (
            SELECT 1 FROM machine_assignment ma
            JOIN worker w ON w.id = ma."workerId"
            LEFT JOIN parcel p ON p.id = ma."parcelId"
            WHERE ma."machineId" = m.id AND ma.status = 'ZADUZENA' AND ma."voidedAt" IS NULL
              AND (w.name ILIKE ${pattern} OR COALESCE(p.name, '') ILIKE ${pattern} OR 'Aktivno zaduženje' ILIKE ${pattern})
          )
          OR EXISTS (
            SELECT 1 FROM field_work fw
            JOIN worker w ON w.id = fw."workerId"
            LEFT JOIN parcel p ON p.id = fw."parcelId"
            WHERE (fw."machineId" = m.id OR fw."attachmentId" = m.id) AND fw.status = 'U_TOKU'
              AND (w.name ILIKE ${pattern} OR COALESCE(p.name, '') ILIKE ${pattern} OR 'Rad u toku' ILIKE ${pattern})
          )
          OR EXISTS (
            SELECT 1 FROM work_order wo
            JOIN worker w ON w.id = wo."workerId"
            LEFT JOIN parcel p ON p.id = wo."parcelId"
            WHERE (wo."machineId" = m.id OR wo."attachmentId" = m.id) AND wo.status = 'U_TOKU'
              AND (w.name ILIKE ${pattern} OR COALESCE(p.name, '') ILIKE ${pattern} OR wo."orderNumber" ILIKE ${pattern} OR 'Nalog u toku' ILIKE ${pattern})
          )
        )`;

        const [idRows, countRows] = await Promise.all([
          db.$queryRaw(Prisma.sql`
            SELECT m.id FROM machine m
            WHERE m."isActive" = true ${statusCondition} ${searchCondition}
            ORDER BY m.name ASC, m.id ASC
            LIMIT ${take} OFFSET ${skip}
          `),
          db.$queryRaw(Prisma.sql`
            SELECT COUNT(*)::int AS total FROM machine m
            WHERE m."isActive" = true ${statusCondition} ${searchCondition}
          `),
        ]);
        total = Number(countRows[0]?.total || 0);
        machineIds = idRows.map((r) => r.id);
        rawMachines = machineIds.length
          ? sortByIdOrder(
              await db.machine.findMany({ where: { id: { in: machineIds } }, select: { ...named, type: true, status: true } }),
              machineIds
            )
          : [];
      }

      if (machineIds.length) {
        const [linkedAssignments, linkedWorks, linkedOrders] = await Promise.all([
          db.machineAssignment.findMany({ where: { machineId: { in: machineIds }, status: 'ZADUZENA', voidedAt: null }, select: { workerId: true } }),
          db.fieldWork.findMany({ where: { status: 'U_TOKU', OR: [{ machineId: { in: machineIds } }, { attachmentId: { in: machineIds } }] }, select: { workerId: true } }),
          db.workOrder.findMany({ where: { status: 'U_TOKU', OR: [{ machineId: { in: machineIds } }, { attachmentId: { in: machineIds } }] }, select: { workerId: true } }),
        ]);
        const linkedWorkerIds = [...new Set([...linkedAssignments, ...linkedWorks, ...linkedOrders].map((r) => r.workerId))];
        let machineWorkers = [];
        if (linkedWorkerIds.length) {
          const [rawLinkedWorkers, assignments, works, orders] = await Promise.all([
            db.worker.findMany({ where: { id: { in: linkedWorkerIds }, isActive: true }, select: { ...named, role: true, type: true }, orderBy: { name: 'asc' } }),
            db.machineAssignment.findMany({ where: { workerId: { in: linkedWorkerIds }, status: 'ZADUZENA', voidedAt: null }, select: assignmentSelect }),
            db.fieldWork.findMany({ where: { workerId: { in: linkedWorkerIds }, status: 'U_TOKU' }, select: fieldWorkSelect }),
            db.workOrder.findMany({ where: { workerId: { in: linkedWorkerIds }, status: { in: ['PLANIRAN', 'DODELJEN', 'U_TOKU'] } }, select: workOrderOverviewSelect, orderBy: { orderDate: 'asc' } }),
          ]);
          machineWorkers = workerOverview(rawLinkedWorkers, assignments, works, orders);
        }
        machines = rawMachines.map((item) => ({
          ...item,
          workers: machineWorkers.filter((row) => [...row.machines, ...row.attachments].some((m) => m.id === item.id)),
        }));
      }
    } else {
      const seasonalSelect = {
        ...named,
        groupName: true,
        workLogs: { take: 1, orderBy: [{ date: 'desc' }, { id: 'desc' }], select: { date: true, parcel, jobDescription: true } },
      };

      if (!pattern) {
        total = stats.totalSeasonal;
        seasonalWorkers = await db.seasonalWorker.findMany({
          where: { isActive: true },
          select: seasonalSelect,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take,
        });
      } else {
        const seasonalSql = Prisma.sql`
          FROM seasonal_worker sw
          LEFT JOIN LATERAL (
            SELECT swl."jobDescription", p.name AS parcel_name
            FROM seasonal_work_log swl
            LEFT JOIN parcel p ON p.id = swl."parcelId"
            WHERE swl."seasonalWorkerId" = sw.id
            ORDER BY swl.date DESC, swl.id DESC
            LIMIT 1
          ) latest ON true
          WHERE sw."isActive" = true
            AND (
              sw.name ILIKE ${pattern}
              OR COALESCE(sw."groupName", '') ILIKE ${pattern}
              OR COALESCE(latest."jobDescription", '') ILIKE ${pattern}
              OR COALESCE(latest.parcel_name, '') ILIKE ${pattern}
            )
        `;
        const [idRows, countRows] = await Promise.all([
          db.$queryRaw(Prisma.sql`SELECT sw.id ${seasonalSql} ORDER BY sw.name ASC, sw.id ASC LIMIT ${take} OFFSET ${skip}`),
          db.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS total ${seasonalSql}`),
        ]);
        total = Number(countRows[0]?.total || 0);
        const seasonalIds = idRows.map((r) => r.id);
        seasonalWorkers = seasonalIds.length
          ? sortByIdOrder(
              await db.seasonalWorker.findMany({ where: { id: { in: seasonalIds } }, select: seasonalSelect }),
              seasonalIds
            )
          : [];
      }
    }

    return {
      view,
      page,
      pageSize: limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      stats,
      workers,
      machines,
      seasonalWorkers,
      fetchedAt: new Date(),
    };
  }, { isolationLevel: 'RepeatableRead' });

  res.json(payload);
}));

router.get('/messages', handle(async (req, res) => {
  const { skip, take } = paging(req);
  const [items, total] = await Promise.all([
    prisma.directorMessage.findMany({ skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), prisma.directorMessage.count(),
  ]);
  res.json({ items, total });
}));
router.get('/messages/:id', handle(async (req, res) => {
  res.json(await prisma.directorMessage.findUniqueOrThrow({ where: { id: req.params.id } }));
}));
router.post('/messages', handle(async (req, res) => {
  const { body } = textSchema.parse(req.body);
  const message = await prisma.$transaction(async db => {
    const item = await db.directorMessage.create({ data: { authorId: req.user.id, authorName: req.user.name, body } });
    await notify(db, req.user, `${req.user.name}: nova poruka`, { messageId: item.id });
    return item;
  });
  res.status(201).json(message);
}));
router.get('/notifications', handle(async (req, res) => {
  const where = { userId: req.user.id, readAt: null };
  const [items, total] = await Promise.all([
    prisma.directorNotification.findMany({ where, take: 30, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.directorNotification.count({ where }),
  ]);
  res.json({ items, total });
}));
router.post('/notifications/read-all', handle(async (req, res) => {
  await prisma.directorNotification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
router.post('/notifications/:id/read', handle(async (req, res) => {
  await prisma.directorNotification.updateMany({ where: { id: req.params.id, userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
router.get('/proposals', handle(async (req, res) => {
  const { page, limit, skip, take } = paging(req, PROPOSAL_PAGE_SIZE);
  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : null;
  const converted = typeof req.query.converted === 'string' ? req.query.converted.trim() : null;
  const orderType =
    typeof req.query.orderType === 'string' && ['RAD_NJIVA', 'REMONT_SERVIS', 'PAKOVANJE'].includes(req.query.orderType.trim())
      ? req.query.orderType.trim()
      : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const where = {
    ...(status ? { status } : {}),
    ...(converted === 'pending'
      ? { workOrderId: null }
      : converted === 'converted'
        ? { workOrderId: { not: null } }
        : {}),
    ...(orderType ? { data: { path: ['orderType'], equals: orderType } } : {}),
  };
  const orderBy =
    status === 'ODOBREN'
      ? [{ approvedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }];

  let items;
  let total;
  let approvedPendingCount;

  if (!q) {
    [items, total, approvedPendingCount] = await Promise.all([
      prisma.workOrderProposal.findMany({ where, skip, take, orderBy }),
      prisma.workOrderProposal.count({ where }),
      prisma.workOrderProposal.count({ where: { status: 'ODOBREN', workOrderId: null } }),
    ]);
  } else {
    const pattern = `%${q}%`;
    const statusSql = status ? Prisma.sql`AND status = ${status}` : Prisma.empty;
    const convertedSql =
      converted === 'pending'
        ? Prisma.sql`AND "workOrderId" IS NULL`
        : converted === 'converted'
          ? Prisma.sql`AND "workOrderId" IS NOT NULL`
          : Prisma.empty;
    const orderTypeSql = orderType
      ? Prisma.sql`AND data->>'orderType' = ${orderType}`
      : Prisma.empty;
    const searchSql = Prisma.sql`AND (
      "authorName" ILIKE ${pattern}
      OR COALESCE("convertedOrderNumber", '') ILIKE ${pattern}
      OR COALESCE(data->>'title', '') ILIKE ${pattern}
      OR COALESCE(data->>'orderDate', '') ILIKE ${pattern}
      OR COALESCE(data->'labels'->>'lotNumber', '') ILIKE ${pattern}
      OR COALESCE(data->'labels'->>'workerId', '') ILIKE ${pattern}
      OR COALESCE(data->'labels'->>'parcelId', '') ILIKE ${pattern}
      OR COALESCE(data->'labels'->>'machineId', '') ILIKE ${pattern}
      OR COALESCE(data->'labels'->>'contractorId', '') ILIKE ${pattern}
      OR COALESCE(data->'labels'->>'workTypeId', '') ILIKE ${pattern}
    )`;
    const orderSql =
      status === 'ODOBREN'
        ? Prisma.sql`ORDER BY "approvedAt" DESC NULLS LAST, "updatedAt" DESC, id DESC`
        : Prisma.sql`ORDER BY "updatedAt" DESC, id DESC`;

    const [idRows, countRows, pendingCount] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        SELECT id FROM work_order_proposal
        WHERE true ${statusSql} ${convertedSql} ${orderTypeSql} ${searchSql}
        ${orderSql}
        LIMIT ${take} OFFSET ${skip}
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*)::int AS total FROM work_order_proposal
        WHERE true ${statusSql} ${convertedSql} ${orderTypeSql} ${searchSql}
      `),
      prisma.workOrderProposal.count({ where: { status: 'ODOBREN', workOrderId: null } }),
    ]);

    total = Number(countRows[0]?.total || 0);
    approvedPendingCount = pendingCount;
    const ids = idRows.map((row) => row.id);
    items = ids.length
      ? sortByIdOrder(await prisma.workOrderProposal.findMany({ where: { id: { in: ids } } }), ids)
      : [];
  }

  res.json({
    items,
    total,
    page,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    approvedPendingCount,
  });
}));
router.get('/proposals/:id', handle(async (req, res) => {
  res.json(await prisma.workOrderProposal.findUniqueOrThrow({ where: { id: req.params.id } }));
}));
router.get('/proposals/:id/events', handle(async (req, res) => {
  const { skip, take } = paging(req);
  const where = { proposalId: req.params.id };
  const [items, total] = await Promise.all([
    prisma.proposalEvent.findMany({ where, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.proposalEvent.count({ where }),
  ]);
  res.json({ items, total });
}));
router.post('/proposals', handle(async (req, res) => {
  const input = proposalSchema.parse(req.body);
  const item = await prisma.$transaction(async db => {
    const data = await checkedData(db, input);
    return db.workOrderProposal.create({ data: { authorId: req.user.id, authorName: req.user.name, data,
      events: { create: { ...actor(req.user), action: 'create', version: 1, snapshot: data } } } });
  });
  res.status(201).json(item);
}));
router.delete('/proposals/:id', handle(async (req, res) => {
  const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
  const id = req.params.id;
  await prisma.$transaction(async db => {
    // The conversion claims this same row. Recheck eligibility in the delete itself.
    const deleted = await db.workOrderProposal.deleteMany({
      where: { id, version, workOrderId: null, convertedAt: null, convertedOrderNumber: null },
    });
    if (!deleted.count) {
      const current = await db.workOrderProposal.findUnique({ where: { id }, select: {
        workOrderId: true, convertedAt: true, convertedOrderNumber: true,
      } });
      if (!current) return;
      if (current.workOrderId || current.convertedAt || current.convertedOrderNumber) {
        throw communicationError(409, 'Predlog je već pretvoren u radni nalog i ne može se obrisati.');
      }
      throw communicationError(409, 'Predlog je u međuvremenu izmenjen. Pregledajte novu verziju pre brisanja.');
    }
    await db.directorMessage.updateMany({ where: { proposalId: id }, data: { proposalId: null, proposalVersion: null } });
    await db.directorNotification.deleteMany({ where: { proposalId: id } });
  });
  res.json({ ok: true });
}));
router.patch('/proposals/:id', handle(async (req, res) => {
  const input = changeSchema.parse(req.body);
  const item = await prisma.$transaction(async db => {
    const previous = await db.workOrderProposal.findUniqueOrThrow({ where: { id: req.params.id } });
    const data = proposalChange(previous, input, req.user);
    if (!data) return previous;
    if (input.action === 'edit') data.data = await checkedData(db, input.data);
    if (input.action === 'submit' && input.reviewerId) {
      const reviewer = await db.user.findFirst({ where: { id: input.reviewerId, role: 'DIREKTOR', isActive: true }, select: { id: true } });
      if (!reviewer) throw communicationError(400, 'Izabrani direktor više nije aktivan.');
    }
    const changed = await db.workOrderProposal.updateMany({ where: { id: previous.id, version: input.version }, data });
    if (!changed.count) throw communicationError(409, 'Predlog je u međuvremenu promenjen. Osvežite ga.');
    const updated = await db.workOrderProposal.findUniqueOrThrow({ where: { id: previous.id } });
    await db.proposalEvent.create({ data: { proposalId: previous.id, ...actor(req.user), action: input.action,
      version: updated.version, contentVersion: updated.contentVersion, body: input.body || null, snapshot: updated.data } });
    if (input.action === 'submit') {
      await db.directorMessage.create({ data: {
        authorId: req.user.id, authorName: req.user.name,
        body: `Poslat je predlog radnog naloga na pregled: ${updated.data.title}\nVerzija: ${updated.contentVersion}`,
        proposalId: updated.id, proposalVersion: updated.version,
      } });
    }
    await notify(db, req.user, `${updated.data.title}: ${updated.status}`, { proposalId: previous.id },
      updated.reviewerId ? [updated.authorId, updated.reviewerId] : undefined);
    return updated;
  });
  res.json(item);
}));
router.post('/proposals/:id/comments', handle(async (req, res) => {
  const { body } = textSchema.parse(req.body);
  const comment = await prisma.$transaction(async db => {
    const proposal = await db.workOrderProposal.findUniqueOrThrow({ where: { id: req.params.id } });
    const item = await db.proposalEvent.create({ data: { proposalId: proposal.id, ...actor(req.user), action: 'comment', version: proposal.version, contentVersion: proposal.contentVersion, body } });
    await notify(db, req.user, `${proposal.data.title}: novi komentar`, { proposalId: proposal.id },
      proposal.reviewerId ? [proposal.authorId, proposal.reviewerId] : undefined);
    return item;
  });
  res.status(201).json(comment);
}));

router.post('/proposals/:id/convert', machineMutation(async (req, res, db) => {
  try {
    const input = convertProposalSchema.parse(req.body ?? {});
    const previous = await db.workOrderProposal.findUnique({ where: { id: req.params.id } });
    if (!previous) {
      return res.status(404).json({ error: 'Predlog naloga nije pronađen.' });
    }
    if (input.version !== undefined && previous.version !== input.version) {
      return res.status(409).json({ error: 'Predlog je u međuvremenu promenjen. Osvežite podatke.' });
    }
    if (previous.status !== 'ODOBREN') {
      return res.status(409).json({ error: 'Samo odobren predlog može biti pretvoren u radni nalog.' });
    }
    if (previous.workOrderId) {
      return res.status(409).json({
        error: `Predlog je već pretvoren u radni nalog ${previous.convertedOrderNumber || ''}.`.trim(),
      });
    }

    const workOrderInput = buildWorkOrderInputFromProposal(previous.data, input);
    const parsedOrder = createWorkOrderSchema.safeParse(workOrderInput);
    if (!parsedOrder.success) {
      return res.status(400).json({
        error: parsedOrder.error.issues.map((i) => i.message).join('. '),
      });
    }

    const claimed = await db.workOrderProposal.updateMany({
      where: { id: previous.id, version: previous.version, status: 'ODOBREN', workOrderId: null },
      data: {
        version: { increment: 1 },
        approvedVersion: previous.version + 1,
      },
    });
    if (!claimed.count) {
      return res.status(409).json({ error: 'Predlog je u međuvremenu promenjen ili već pretvoren u radni nalog.' });
    }

    const workOrder = await createWorkOrderRecord(db, req.user, parsedOrder.data);

    const updated = await db.workOrderProposal.update({
      where: { id: previous.id },
      data: {
        workOrderId: workOrder.id,
        convertedById: req.user.id,
        convertedByName: req.user.name,
        convertedAt: new Date(),
        convertedOrderNumber: workOrder.orderNumber,
      },
    });

    await db.proposalEvent.create({
      data: {
        proposalId: previous.id,
        ...actor(req.user),
        action: 'convert',
        version: updated.version,
        contentVersion: updated.contentVersion,
        body: `Kreiran radni nalog ${workOrder.orderNumber}`,
        snapshot: updated.data,
      },
    });

    await notify(
      db,
      req.user,
      `${updated.data.title}: kreiran radni nalog ${workOrder.orderNumber}`,
      { proposalId: previous.id },
      updated.reviewerId ? [updated.authorId, updated.reviewerId] : undefined
    );

    return res.status(201).json({ proposal: updated, workOrder });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Proverite unete podatke.', details: error.issues });
    }
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Predlog je već pretvoren u radni nalog.' });
    }
    throw error;
  }
}));

export default router;

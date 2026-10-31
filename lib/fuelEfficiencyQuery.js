import { Prisma } from '@prisma/client';
import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
});
const id = z.string().min(1).max(200).optional();
const page = z.coerce.number().int().min(1).max(1000000).default(1);
export const fuelEfficiencyQuery = z.object({
  dateFrom: date.optional(), dateTo: date.optional(), machineId: id, workerId: id, parcelId: id,
  search: z.string().trim().max(200).optional(), operationsPage: page, criticalPage: page,
  limit: z.coerce.number().int().refine(value => value === 10).default(10),
}).refine(q => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo);

// Prisma TIMESTAMP values are UTC. Bounds retain indexed timestamp columns;
// only the outer assignment/day values are converted to Belgrade calendar days.
const dayStart = column => Prisma.sql`(((${Prisma.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date)::timestamp AT TIME ZONE 'Europe/Belgrade' AT TIME ZONE 'UTC')`;
const dayEnd = column => Prisma.sql`(((${Prisma.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date + 1)::timestamp AT TIME ZONE 'Europe/Belgrade' AT TIME ZONE 'UTC')`;

export function fuelEfficiencySql(q) {
  const from = q.dateFrom ? `${q.dateFrom}T00:00:00.000` : null;
  const to = q.dateTo ? `${q.dateTo}T23:59:59.999` : null;
  const search = `%${(q.search || '').replace(/[\\%_]/g, '\\$&')}%`;
  return Prisma.sql`WITH target AS MATERIALIZED (
    SELECT w.*, t.name AS "workTypeName", t.category, t."fuelNormLitersPerHa" AS norm,
      p.name AS parcel, m.name AS machine, r.name AS worker
    FROM field_work w JOIN work_type t ON t.id = w."workTypeId"
      JOIN parcel p ON p.id = w."parcelId" JOIN machine m ON m.id = w."machineId"
      JOIN worker r ON r.id = w."workerId"
    WHERE w.status = 'ZAVRSENO'
      AND (${from}::timestamp IS NULL OR w.date >= ${from}::timestamp)
      AND (${to}::timestamp IS NULL OR w.date <= ${to}::timestamp)
      AND (${q.machineId ?? null}::text IS NULL OR w."machineId" = ${q.machineId ?? null})
      AND (${q.workerId ?? null}::text IS NULL OR w."workerId" = ${q.workerId ?? null})
      AND (${q.parcelId ?? null}::text IS NULL OR w."parcelId" = ${q.parcelId ?? null})
      AND (${q.search || ''} = '' OR concat_ws(' ', t.name, p.name, m.name, r.name) ILIKE ${search})
  ), relevant_assignments AS MATERIALIZED (
    SELECT a.*, ${dayStart('a."assignedAt"')} AS day_start, ${dayEnd('a."returnedAt"')} AS day_end
    FROM machine_assignment a
    WHERE a.status IN ('RAZDUZENA', 'VRACENA_SA_KVAROM') AND a."returnedAt" IS NOT NULL
      AND EXISTS (SELECT 1 FROM target w WHERE w."machineId" = a."machineId" AND w."workerId" = a."workerId"
        AND (a."parcelId" IS NULL OR a."parcelId" = w."parcelId")
        AND a."assignedAt" < ${dayEnd('w.date')} AND a."returnedAt" >= ${dayStart('w.date')})
  ), balances AS MATERIALIZED (
    SELECT a.*, a."startFuelLiters" + COALESCE(f.liters, 0) - a."endFuelLiters" AS consumed,
      a."startFuelLiters" IS NOT NULL AND a."endFuelLiters" IS NOT NULL
      AND a."startFuelLiters" >= 0 AND a."endFuelLiters" >= 0 AND a."returnedAt" > a."assignedAt"
      AND NOT EXISTS (SELECT 1 FROM machine_assignment b WHERE b.id <> a.id AND b."machineId" = a."machineId"
        AND b.status IN ('RAZDUZENA', 'VRACENA_SA_KVAROM') AND b."returnedAt" IS NOT NULL
        AND b."assignedAt" < a."returnedAt" AND b."returnedAt" > a."assignedAt") AS valid
    FROM relevant_assignments a LEFT JOIN LATERAL (
      SELECT SUM(e.liters) AS liters FROM fuel_entry e WHERE e."machineId" = a."machineId"
        AND e.date >= a."assignedAt" AND e.date < a."returnedAt"
    ) f ON TRUE
  ), full_pairs AS MATERIALIZED (
    SELECT a.id AS assignment_id, w.id AS work_id, w."areaDoneHa" AS ha, w."workHours" AS hours,
      (SELECT COUNT(*) FROM machine_assignment b WHERE b."machineId" = w."machineId" AND b."workerId" = w."workerId"
        AND (b."parcelId" IS NULL OR b."parcelId" = w."parcelId")
        AND b.status IN ('RAZDUZENA', 'VRACENA_SA_KVAROM') AND b."returnedAt" IS NOT NULL
        AND b."assignedAt" < ${dayEnd('w.date')} AND b."returnedAt" >= ${dayStart('w.date')}) AS candidates
    FROM balances a JOIN field_work w ON w."machineId" = a."machineId" AND w."workerId" = a."workerId"
      AND (a."parcelId" IS NULL OR a."parcelId" = w."parcelId")
      AND w.date >= a.day_start AND w.date < a.day_end AND w.status = 'ZAVRSENO'
  ), weights AS (
    SELECT assignment_id, BOOL_AND(ha > 0 AND candidates = 1) AS valid,
      BOOL_AND(COALESCE(hours > 0, FALSE)) AS use_hours, SUM(hours) AS hours, SUM(ha) AS ha
    FROM full_pairs GROUP BY assignment_id
  ), allocations AS (
    SELECT p.work_id, a.id AS assignment_id,
      CASE WHEN x.use_hours THEN 'RADNI_SATI' ELSE 'HEKTARI' END AS basis,
      a.consumed * CASE WHEN x.use_hours THEN p.hours / NULLIF(x.hours, 0) ELSE p.ha / NULLIF(x.ha, 0) END AS liters
    FROM full_pairs p JOIN balances a ON a.id = p.assignment_id JOIN weights x ON x.assignment_id = a.id
    WHERE a.valid AND a.consumed >= 0 AND x.valid
  ), measured AS MATERIALIZED (
    SELECT w.*, a.liters, a.basis, a.assignment_id,
      CASE WHEN w.norm > 0 AND w."areaDoneHa" > 0 THEN (a.liters / w."areaDoneHa" / w.norm - 1) * 100 END AS variance
    FROM target w LEFT JOIN allocations a ON a.work_id = w.id
  ), grouped AS (
    SELECT "workTypeId", "workTypeName", category, norm, SUM("areaDoneHa") AS ha,
      COALESCE(SUM("areaDoneHa") FILTER (WHERE liters IS NOT NULL), 0) AS covered,
      COALESCE(SUM("workHours"), 0) AS hours, COALESCE(SUM(liters), 0) AS liters,
      COUNT(*)::int AS count, COUNT(liters)::int AS covered_count FROM measured
    GROUP BY "workTypeId", "workTypeName", category, norm
  ), operations AS MATERIALIZED (
    SELECT "workTypeId", "workTypeName", category, norm AS "normLPerHa", ha AS "totalHa", covered AS "coveredHa",
      hours AS "totalHours", liters AS "totalLiters", count AS "worksCount", covered_count AS "coveredWorksCount",
      liters / NULLIF(covered, 0) AS "actualLPerHa",
      CASE WHEN norm > 0 THEN (liters / NULLIF(covered, 0) / norm - 1) * 100 END AS "variancePercent",
      CASE WHEN covered <= 0 OR norm IS NULL OR norm <= 0 THEN 'NEMA_PODATAKA'
        WHEN (liters / covered / norm - 1) * 100 > 25.000000001 THEN 'ANOMALIJA'
        WHEN (liters / covered / norm - 1) * 100 > 10.000000001 THEN 'UPOZORENJE' ELSE 'OPTIMALNO' END AS status
    FROM grouped
  ), critical AS MATERIALIZED (
    SELECT id, date, parcel, machine, worker, "workTypeName" AS "workType", "areaDoneHa",
      liters AS "totalLiters", liters / "areaDoneHa" AS "actualLPerHa", norm AS "normLPerHa",
      variance AS "variancePercent", basis AS "allocationBasis", assignment_id AS "assignmentId"
    FROM measured WHERE variance > 25.000000001
  ), costs AS (
    SELECT COALESCE(SUM(e."totalCost"), 0) AS cost, COALESCE(SUM(e.liters), 0) AS liters FROM fuel_entry e
    WHERE (${from}::timestamp IS NULL OR e.date >= ${from}::timestamp)
      AND (${to}::timestamp IS NULL OR e.date <= ${to}::timestamp)
      AND (${q.machineId ?? null}::text IS NULL OR e."machineId" = ${q.machineId ?? null})
      AND (${q.workerId ?? null}::text IS NULL OR e."workerId" = ${q.workerId ?? null})
      AND ((${q.parcelId ?? null}::text IS NULL AND ${q.search || ''} = '') OR EXISTS (
        SELECT 1 FROM relevant_assignments a WHERE a."machineId" = e."machineId"
          AND e.date >= a."assignedAt" AND e.date < a."returnedAt"))
  )
  SELECT json_build_object(
    'operations', COALESCE((SELECT json_agg(row_to_json(p)) FROM (SELECT * FROM operations ORDER BY "workTypeName", "workTypeId" LIMIT 10 OFFSET ${(q.operationsPage - 1) * 10}) p), '[]'::json),
    'criticalWorks', COALESCE((SELECT json_agg(row_to_json(p)) FROM (SELECT * FROM critical ORDER BY date DESC, id LIMIT 10 OFFSET ${(q.criticalPage - 1) * 10}) p), '[]'::json),
    'operationsPagination', json_build_object('total', (SELECT COUNT(*) FROM operations), 'page', ${q.operationsPage}::int, 'limit', 10, 'totalPages', GREATEST(1, CEIL((SELECT COUNT(*) FROM operations) / 10.0))),
    'criticalPagination', json_build_object('total', (SELECT COUNT(*) FROM critical), 'page', ${q.criticalPage}::int, 'limit', 10, 'totalPages', GREATEST(1, CEIL((SELECT COUNT(*) FROM critical) / 10.0))),
    'summary', (SELECT json_build_object('totalLiters', COALESCE(SUM(liters), 0),
      'totalHa', COALESCE(SUM("areaDoneHa"), 0), 'coveredHa', COALESCE(SUM("areaDoneHa") FILTER (WHERE liters IS NOT NULL), 0),
      'actualLPerHa', SUM(liters) / NULLIF(SUM("areaDoneHa") FILTER (WHERE liters IS NOT NULL), 0),
      'uncoveredWorksCount', COUNT(*) - COUNT(liters), 'criticalWorksCount', (SELECT COUNT(*) FROM critical),
      'invalidAssignments', (SELECT COUNT(*) FROM balances WHERE NOT valid OR consumed < 0),
      'dispensedCostRSD', (SELECT cost FROM costs), 'dispensedLiters', (SELECT liters FROM costs)) FROM measured)
  ) AS report`;
}

export async function loadPagedFuelEfficiency(db, input) {
  const parsed = fuelEfficiencyQuery.safeParse(input);
  if (!parsed.success) throw new Error('INVALID_FUEL_QUERY');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
    const [row] = await tx.$queryRaw(fuelEfficiencySql(parsed.data));
    return row.report;
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 12000 });
}

import { Prisma } from "@prisma/client";
import { z } from "zod";

const ZONE = "Europe/Belgrade";
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Neispravan datum.");
export const reportingQuery = z.object({
  dateFrom: calendarDate.optional(), dateTo: calendarDate.optional(),
  period: z.enum(["danas", "nedelja", "mesec", "custom", "sve"]).default("sve"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, "Početni datum mora biti pre krajnjeg.");

// Timestamps in Prisma's TIMESTAMP columns are UTC. Compare assignments with
// the UTC bounds of the work's Belgrade calendar day; keep assignedAt uncast
// so PostgreSQL can use the (machineId, assignedAt) B-tree index, including DST.
const missingAssignment = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM machine_assignment a
  WHERE a."machineId" = w."machineId"
    AND a."assignedAt" >= (((w.date AT TIME ZONE 'UTC' AT TIME ZONE ${ZONE})::date)::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC')
    AND a."assignedAt" < ((((w.date AT TIME ZONE 'UTC' AT TIME ZONE ${ZONE})::date + 1)::timestamp) AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC')
)`;

function bounds(query, now, warningList = false) {
  return Prisma.sql`WITH local_day AS (
    SELECT (${now}::timestamptz AT TIME ZONE ${ZONE})::date AS today
  ), calendar AS (
    SELECT today, date_trunc('week', today::timestamp)::date AS week,
      date_trunc('month', today::timestamp)::date AS month,
      CASE WHEN ${query.dateFrom ?? null}::date IS NOT NULL THEN ${query.dateFrom ?? null}::date
        WHEN ${query.dateTo ?? null}::date IS NOT NULL AND NOT ${warningList} THEN NULL
        WHEN ${query.period} = 'danas' OR ${warningList} THEN today
        WHEN ${query.period} = 'nedelja' THEN date_trunc('week', today::timestamp)::date
        WHEN ${query.period} = 'mesec' THEN date_trunc('month', today::timestamp)::date END AS selected_from,
      CASE WHEN ${query.dateTo ?? null}::date IS NOT NULL THEN ${query.dateTo ?? null}::date + 1
        WHEN ${query.dateFrom ?? null}::date IS NOT NULL AND NOT ${warningList} THEN NULL
        WHEN ${query.period} IN ('danas', 'nedelja', 'mesec') OR ${warningList} THEN today + 1 END AS selected_to
    FROM local_day
  ), bounds AS (
    SELECT today::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC' AS today_start,
      (today + 1)::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC' AS today_end,
      week::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC' AS week_start,
      month::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC' AS month_start,
      selected_from::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC' AS selected_start,
      selected_to::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC' AS selected_end
    FROM calendar
  )`;
}

async function reportingRead(db, callback) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    return callback(tx);
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
}

export async function fieldWorkStats(db, query, workerId = null, now = new Date()) {
  return reportingRead(db, async (tx) => {
    const rows = await tx.$queryRaw`${bounds(query, now)}, classified AS MATERIALIZED (
      SELECT w.date, w."areaDoneHa", w."workHours", ${missingAssignment} AS missing
      FROM field_work w WHERE w.status <> 'STORNO'
        AND ${workerId ? Prisma.sql`w."workerId" = ${workerId}` : Prisma.sql`TRUE`}
    ), periods AS (
      SELECT p.* FROM bounds b CROSS JOIN LATERAL (VALUES
        ('today', b.today_start, b.today_end), ('week', b.week_start, b.today_end),
        ('month', b.month_start, b.today_end), ('current', b.selected_start, b.selected_end),
        ('all', NULL::timestamp, NULL::timestamp)
      ) p(name, starts, ends)
    )
    SELECT p.name, COUNT(c.date)::int AS count,
      COALESCE(SUM(c."areaDoneHa"), 0)::float8 AS area,
      COALESCE(SUM(c."workHours"), 0)::float8 AS hours,
      COUNT(c.date) FILTER (WHERE c.missing)::int AS missing
    FROM periods p LEFT JOIN classified c ON (p.starts IS NULL OR c.date >= p.starts) AND (p.ends IS NULL OR c.date < p.ends)
    GROUP BY p.name`;
    const workTypesBreakdown = await tx.fieldWork.groupBy({
      by: ["workTypeId"], where: { status: { not: "STORNO" }, ...(workerId ? { workerId } : {}) },
      _sum: { areaDoneHa: true, workHours: true }, _count: { id: true },
    });
    const result = Object.fromEntries(rows.map((row) => [row.name, {
      count: row.count, areaDoneHa: Math.round(row.area * 100) / 100,
      workHours: Math.round(row.hours * 10) / 10, unassignedWarnings: row.missing,
    }]));
    return { unassignedWarningsTotal: result.all.unassignedWarnings,
      current: result.current, today: result.today, week: result.week, month: result.month, workTypesBreakdown };
  });
}

export async function unassignedWorkPage(db, query, now = new Date()) {
  return reportingRead(db, async (tx) => {
    const filtered = Prisma.sql`${bounds(query, now, true)}, missing AS (
      SELECT w.id, w.date FROM field_work w CROSS JOIN bounds b
      WHERE w.status <> 'STORNO' AND w.date >= b.selected_start AND w.date < b.selected_end AND ${missingAssignment}
    )`;
    const [summary] = await tx.$queryRaw`${filtered}
      SELECT (SELECT COUNT(*)::int FROM missing) AS count, selected_start AS "from", selected_end AS "toExclusive" FROM bounds`;
    const ids = await tx.$queryRaw`${filtered} SELECT id FROM missing ORDER BY date DESC, id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
    const items = ids.length ? await tx.fieldWork.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: { parcel: true, machine: true, attachment: true, worker: true, workType: true,
        createdBy: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ date: "desc" }, { id: "desc" }], take: query.limit,
    }) : [];
    return { count: summary.count, page: query.page, limit: query.limit, totalPages: Math.ceil(summary.count / query.limit),
      period: { from: summary.from, to: new Date(summary.toExclusive.getTime() - 1) }, items };
  });
}

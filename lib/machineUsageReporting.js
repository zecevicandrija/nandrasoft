import { Prisma } from "@prisma/client";

// Aggregate machine segments, while FieldWork remains the source for worker/parcel totals.
// Column names come from this closed allowlist, never from request input.
const columns = new Set(["machineId", "workerId", "parcelId", "workTypeId"]);
export async function usageGroupBy(db, args) {
  if (!args.by.length || args.by.some(key => !columns.has(key))) throw new Error("Invalid usage grouping");
  const keys = args.by.map(key => Prisma.raw(`"${key}"`));
  const conditions = [Prisma.sql`status = 'ZAVRSENO'`];
  const where = args.where || {};
  for (const key of columns) {
    if (typeof where[key] === "string") conditions.push(Prisma.sql`${Prisma.raw(`"${key}"`)} = ${where[key]}`);
    else if (where[key]?.in) conditions.push(where[key].in.length
      ? Prisma.sql`${Prisma.raw(`"${key}"`)} IN (${Prisma.join(where[key].in)})` : Prisma.sql`FALSE`);
  }
  for (const [op, sql] of [["gte", ">="], ["gt", ">"], ["lte", "<="], ["lt", "<"]]) {
    if (where.date?.[op]) conditions.push(Prisma.sql`date ${Prisma.raw(sql)} ${where.date[op]}::timestamp`);
  }
  const query = Prisma.sql`SELECT ${Prisma.join(keys)}, SUM("areaDoneHa")::float8 AS area,
    SUM("workHours")::float8 AS hours, COUNT(DISTINCT "fieldWorkId")::int AS count
    FROM field_work_machine_usage WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY ${Prisma.join(keys)} ${args.orderBy ? Prisma.sql`ORDER BY SUM("areaDoneHa") DESC` : Prisma.empty}`;
  const rows = await db.$queryRaw(query);
  return rows.map(({ area, hours, count, ...keys }) => ({ ...keys,
    _sum: { ...(args._sum?.areaDoneHa && { areaDoneHa: area || 0 }), ...(args._sum?.workHours && { workHours: hours || 0 }) },
    _count: count,
  }));
}

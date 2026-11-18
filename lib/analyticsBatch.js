import { Prisma } from "@prisma/client";
import { usageGroupBy } from "./machineUsageReporting.js";

const emptyAggregate = () => ({ _sum: {}, _count: 0 });
const index = (rows, key) => new Map(rows.map((row) => [row[key], row]));

function partition(rows, key, limit = Infinity) {
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row[key])) result.set(row[key], []);
    const bucket = result.get(row[key]);
    if (bucket.length < limit) bucket.push(row);
  }
  return result;
}

async function names(db, model, rows, key, select) {
  const ids = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  return ids.length ? db[model].findMany({ where: { id: { in: ids } }, select }) : [];
}

// All queries are scoped to the selected page; none run inside an entity loop.
export async function loadAnalyticsBatch(db, kind, ids, dateWhere, reportedWhere, orderWhere = {}, extraFilters = {}) {
  if (!ids.length) return new Map();
  const machine = kind === "machine";
  const key = machine ? "machineId" : "workerId";
  const filterMachineId = !machine && extraFilters?.machineId ? extraFilters.machineId : undefined;
  const filterWorkerId = machine && extraFilters?.workerId ? extraFilters.workerId : undefined;
  const filterParcelId = extraFilters?.parcelId || undefined;

  const where = { ...dateWhere, [key]: { in: ids } };
  const completed = {
    ...where,
    status: "ZAVRSENO",
    ...(filterMachineId && { machineId: filterMachineId }),
    ...(filterWorkerId && { workerId: filterWorkerId }),
    ...(filterParcelId && { parcelId: filterParcelId }),
  };
  const fuelWhere = {
    ...where,
    ...(filterMachineId && { machineId: filterMachineId }),
    ...(filterWorkerId && { workerId: filterWorkerId }),
    ...(filterParcelId && { fieldWork: { parcelId: filterParcelId } }),
  };
  const maintKey = machine ? "machineId" : "reportedById";
  const maintWhere = {
    ...reportedWhere,
    [maintKey]: { in: ids },
    ...(filterMachineId && { machineId: filterMachineId }),
    ...(filterWorkerId && { reportedById: filterWorkerId }),
    ...(filterParcelId && { parcelId: filterParcelId }),
  };
  const tollWhere = {
    ...where,
    ...(filterMachineId && { machineId: filterMachineId }),
    ...(filterWorkerId && { workerId: filterWorkerId }),
  };
  const relatedKey = machine ? "workerId" : "machineId";
  const useMachineUsage = machine || Boolean(filterMachineId);

  const [fieldWork, fuel, maintenance, tolls, related, workTypes, parcels, orders, repairs] = await Promise.all([
    (useMachineUsage
      ? usageGroupBy(db, { by: [key], where: completed, _sum: { areaDoneHa: true, workHours: true }, _count: true })
      : db.fieldWork.groupBy({ by: [key], where: completed, _sum: { areaDoneHa: true, workHours: true }, _count: true })),
    db.fuelEntry.groupBy({ by: [key], where: fuelWhere, _sum: { liters: true, totalCost: true }, _count: true }),
    db.maintenanceIssue.groupBy({
      by: [maintKey],
      where: maintWhere,
      ...(machine ? { _sum: { totalCost: true, partsCost: true, laborCost: true, downtimeHours: true } } : {}),
      _count: true,
    }),
    filterParcelId
      ? Promise.resolve([])
      : db.tollEntry.groupBy({ by: [key], where: tollWhere, _sum: { amount: true }, _count: true }),
    usageGroupBy(db, { by: [key, relatedKey], where: completed, _sum: { areaDoneHa: true, workHours: true }, _count: true,
      orderBy: { _sum: { areaDoneHa: "desc" } } }),
    (useMachineUsage
      ? usageGroupBy(db, { by: [key, "workTypeId"], where: completed, _sum: { areaDoneHa: true }, _count: true })
      : db.fieldWork.groupBy({ by: [key, "workTypeId"], where: completed, _sum: { areaDoneHa: true }, _count: true })),
    machine
      ? []
      : (useMachineUsage
          ? usageGroupBy(db, { by: [key, "parcelId"], where: completed, _sum: { areaDoneHa: true }, _count: true, orderBy: { _sum: { areaDoneHa: "desc" } } })
          : db.fieldWork.groupBy({ by: [key, "parcelId"], where: completed, _sum: { areaDoneHa: true }, _count: true, orderBy: { _sum: { areaDoneHa: "desc" } } })),
    machine
      ? []
      : db.workOrder.groupBy({
          by: [key, "status"],
          where: {
            ...orderWhere,
            [key]: { in: ids },
            ...(filterMachineId && { machineId: filterMachineId }),
            ...(filterParcelId && { parcelId: filterParcelId }),
          },
          _count: true,
        }),
    // LATERAL applies LIMIT in PostgreSQL per machine, avoiding an unbounded history fetch.
    // Recent repairs intentionally ignore the aggregate date filter, as before.
    machine ? db.$queryRaw(Prisma.sql`
      SELECT repairs.* FROM unnest(ARRAY[${Prisma.join(ids)}]::text[]) AS selected("machineId")
      CROSS JOIN LATERAL (
        SELECT "machineId", id, title, "serviceType", priority, status, "totalCost",
          "partsReplaced", "repairNotes", "dateReported", "repairedAt", "downtimeHours",
          "lubricantType", "lubricantLiters"
        FROM maintenance_issue WHERE "machineId" = selected."machineId"
          AND (${filterWorkerId ?? null}::text IS NULL OR "reportedById" = ${filterWorkerId ?? null})
          AND (${filterParcelId ?? null}::text IS NULL OR "parcelId" = ${filterParcelId ?? null})
        ORDER BY "dateReported" DESC, id DESC LIMIT 10
      ) repairs ORDER BY repairs."machineId", repairs."dateReported" DESC, repairs.id DESC
    `) : [],
  ]);

  const relatedGroups = partition(related, key, machine ? 5 : 10);
  const parcelGroups = partition(parcels, key, 10);
  const [relatedNames, typeNames, parcelNames] = await Promise.all([
    names(db, machine ? "worker" : "machine", [...relatedGroups.values()].flat(), relatedKey, { id: true, name: true }),
    names(db, "workType", workTypes, "workTypeId", { id: true, name: true }),
    names(db, "parcel", [...parcelGroups.values()].flat(), "parcelId", { id: true, name: true, code: true }),
  ]);
  const relatedMap = Object.fromEntries(relatedNames.map((row) => [row.id, row.name]));
  const workTypeMap = Object.fromEntries(typeNames.map((row) => [row.id, row.name]));
  const parcelMap = Object.fromEntries(parcelNames.map((row) => [row.id, `[${row.code}] ${row.name}`]));
  const fieldIndex = index(fieldWork, key), fuelIndex = index(fuel, key), tollIndex = index(tolls, key);
  const maintenanceIndex = index(maintenance, machine ? "machineId" : "reportedById");
  const typeGroups = partition(workTypes, key), orderGroups = partition(orders, key), repairGroups = partition(repairs, key);
  return new Map(ids.map((id) => [id, {
    fieldWork: fieldIndex.get(id) || emptyAggregate(),
    fuel: fuelIndex.get(id) || emptyAggregate(),
    maintenance: machine ? maintenanceIndex.get(id) || emptyAggregate() : maintenanceIndex.get(id)?._count || 0,
    tolls: tollIndex.get(id) || emptyAggregate(),
    related: relatedGroups.get(id) || [], relatedMap,
    workTypeBreakdown: typeGroups.get(id) || [], workTypeMap,
    parcelBreakdown: parcelGroups.get(id) || [], parcelMap,
    orderStats: orderGroups.get(id) || [],
    recentRepairs: (repairGroups.get(id) || []).map(({ machineId, ...repair }) => repair),
  }]));
}

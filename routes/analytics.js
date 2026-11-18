import { usageGroupBy } from "../lib/machineUsageReporting.js";
import { loadFuelEfficiency } from "../lib/fuelEfficiency.js";
import { loadAnalyticsBatch } from "../lib/analyticsBatch.js";
import { addMoney, multiplyMoney } from "../lib/money.js";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

// Samo DIREKTOR može pristupiti analitici
router.use(requireAuth);
router.use(requireRole(["DIREKTOR"]));

router.get("/fuel-efficiency", async (req, res) => {
  try {
    res.json(await loadFuelEfficiency(prisma, req.query));
  } catch (error) {
    if (error.message === "INVALID_FUEL_QUERY") return res.status(400).json({ error: "Neispravni filteri ili stranica izvestaja." });
    console.error("Fuel efficiency report failed:", error);
    res.status(500).json({ error: "Analitika goriva nije dostupna." });
  }
});

// ============================
// HELPER: Parse date range
// ============================
function parseDateRange(query) {
  const { dateFrom, dateTo } = query;
  const where = {};
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = new Date(dateFrom + "T00:00:00.000Z");
    if (dateTo) where.date.lte = new Date(dateTo + "T23:59:59.999Z");
  }
  return where;
}

function parseDateRangeField(query, field = "date") {
  const { dateFrom, dateTo } = query;
  const where = {};
  if (dateFrom || dateTo) {
    where[field] = {};
    if (dateFrom) where[field].gte = new Date(dateFrom + "T00:00:00.000Z");
    if (dateTo) where[field].lte = new Date(dateTo + "T23:59:59.999Z");
  }
  return where;
}

function cleanFilterId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getIsoDateBounds(query) {
  const { date } = parseDateRange(query);
  return {
    fromIso: date?.gte ? date.gte.toISOString().slice(0, 23) : null,
    toIso: date?.lte ? date.lte.toISOString().slice(0, 23) : null,
  };
}

function sqlDateBounds(columnSql, fromIso, toIso) {
  const fromClause = fromIso ? Prisma.sql`AND ${columnSql} >= ${fromIso}::timestamp` : Prisma.empty;
  const toClause = toIso ? Prisma.sql`AND ${columnSql} <= ${toIso}::timestamp` : Prisma.empty;
  return Prisma.sql`${fromClause} ${toClause}`;
}

function sqlBelgradeMonth(columnSql) {
  return Prisma.sql`to_char((${columnSql} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'), 'YYYY-MM')`;
}

// ============================
// 1. GENERALNI PREGLED (Dashboard kartice)
// ============================
router.get("/overview", async (req, res) => {
  try {
    const dateWhere = parseDateRange(req.query);
    const machineId = cleanFilterId(req.query.machineId);
    const workerId = cleanFilterId(req.query.workerId);
    const parcelId = cleanFilterId(req.query.parcelId);
    const hasEntityFilter = Boolean(machineId || workerId || parcelId);

    const fieldWorkPromise = machineId
      ? usageGroupBy(prisma, {
          by: ["machineId"],
          where: {
            ...dateWhere,
            status: "ZAVRSENO",
            machineId,
            ...(workerId && { workerId }),
            ...(parcelId && { parcelId }),
          },
          _sum: { areaDoneHa: true },
        }).then((rows) => ({
          count: rows[0]?._count || 0,
          ha: rows[0]?._sum.areaDoneHa || 0,
        }))
      : Promise.all([
          prisma.fieldWork.count({
            where: {
              ...dateWhere,
              status: "ZAVRSENO",
              ...(workerId && { workerId }),
              ...(parcelId && { parcelId }),
            },
          }),
          prisma.fieldWork.aggregate({
            where: {
              ...dateWhere,
              status: "ZAVRSENO",
              ...(workerId && { workerId }),
              ...(parcelId && { parcelId }),
            },
            _sum: { areaDoneHa: true },
          }),
        ]).then(([count, agg]) => ({ count, ha: agg._sum.areaDoneHa || 0 }));

    const fertilizerPromise = machineId
      ? Promise.resolve({ _sum: { totalCost: 0 } })
      : parcelId || workerId
        ? prisma.fertilizerMovement.aggregate({
            where: {
              ...dateWhere,
              movementType: "IZDAVANJE_NJIVA",
              ...(parcelId && { parcelId }),
              ...(workerId && { receivedWorkerId: workerId }),
            },
            _sum: { totalCost: true },
          })
        : prisma.fertilizerMovement.aggregate({
            where: {
              ...dateWhere,
              movementType: "PRIJEM_NABAVKA",
            },
            _sum: { totalCost: true },
          });

    const [
      fieldWorkSummary,
      totalFuelLiters,
      totalMaintenanceCost,
      totalWorkOrders,
      completedWorkOrders,
      totalTollCost,
      totalFertilizerCost,
      totalSeasonalHours,
      machineCount,
      workerCount,
      parcelCount,
      onionShippedKg,
    ] = await Promise.all([
      fieldWorkPromise,
      prisma.fuelEntry.aggregate({
        where: {
          ...dateWhere,
          ...(machineId && { machineId }),
          ...(workerId && { workerId }),
          ...(parcelId && { fieldWork: { parcelId } }),
        },
        _sum: { liters: true, totalCost: true },
      }),
      prisma.maintenanceIssue.aggregate({
        where: {
          ...parseDateRangeField(req.query, "dateReported"),
          ...(machineId && { machineId }),
          ...(workerId && { reportedById: workerId }),
          ...(parcelId && { parcelId }),
        },
        _sum: { totalCost: true, partsCost: true, laborCost: true },
      }),
      prisma.workOrder.count({
        where: {
          ...parseDateRangeField(req.query, "orderDate"),
          ...(machineId && { machineId }),
          ...(workerId && { workerId }),
          ...(parcelId && { parcelId }),
        },
      }),
      prisma.workOrder.count({
        where: {
          ...parseDateRangeField(req.query, "orderDate"),
          status: "ZAVRSEN",
          ...(machineId && { machineId }),
          ...(workerId && { workerId }),
          ...(parcelId && { parcelId }),
        },
      }),
      parcelId
        ? Promise.resolve({ _sum: { amount: 0 } })
        : prisma.tollEntry.aggregate({
            where: {
              ...dateWhere,
              ...(machineId && { machineId }),
              ...(workerId && { workerId }),
            },
            _sum: { amount: true },
          }),
      fertilizerPromise,
      machineId || workerId
        ? Promise.resolve({ _sum: { hoursWorked: 0, dailyWageApplied: 0 } })
        : prisma.seasonalWorkLog.aggregate({
            where: {
              ...dateWhere,
              ...(parcelId && { parcelId }),
            },
            _sum: { hoursWorked: true, dailyWageApplied: true },
          }),
      prisma.machine.count({ where: { isActive: true, ...(machineId && { id: machineId }) } }),
      prisma.worker.count({ where: { isActive: true, ...(workerId && { id: workerId }) } }),
      prisma.parcel.count({ where: { isActive: true, ...(parcelId && { id: parcelId }) } }),
      hasEntityFilter
        ? Promise.resolve({ _sum: { totalWeightKg: 0, totalValue: 0 } })
        : prisma.onionShipment.aggregate({
            where: dateWhere,
            _sum: { totalWeightKg: true, totalValue: true },
          }),
    ]);

    res.json({
      totalFieldWorks: fieldWorkSummary.count,
      totalHaDone: fieldWorkSummary.ha,
      totalFuelLiters: totalFuelLiters._sum.liters || 0,
      totalFuelCost: totalFuelLiters._sum.totalCost || 0,
      totalMaintenanceCost: totalMaintenanceCost._sum.totalCost || 0,
      maintenancePartsCost: totalMaintenanceCost._sum.partsCost || 0,
      maintenanceLaborCost: totalMaintenanceCost._sum.laborCost || 0,
      totalWorkOrders,
      completedWorkOrders,
      totalTollCost: totalTollCost._sum.amount || 0,
      totalFertilizerCost: totalFertilizerCost._sum.totalCost || 0,
      totalSeasonalHours: totalSeasonalHours._sum.hoursWorked || 0,
      totalSeasonalWages: totalSeasonalHours._sum.dailyWageApplied || 0,
      machineCount,
      workerCount,
      parcelCount,
      onionShippedKg: onionShippedKg._sum.totalWeightKg || 0,
      onionShipmentValue: onionShippedKg._sum.totalValue || 0,
    });
  } catch (error) {
    console.error("Analytics overview error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju pregleda analitike." });
  }
});

// ============================
// 1.1 NAJAKTIVNIJE MAŠINE (Sa DB paginacijom)
// ============================
router.get("/top-machines", async (req, res) => {
  try {
    const dateWhere = parseDateRange(req.query);
    const machineId = cleanFilterId(req.query.machineId);
    const workerId = cleanFilterId(req.query.workerId);
    const parcelId = cleanFilterId(req.query.parcelId);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    // Pronađi mašine grupisane i rangirane po obrađenoj površini
    const activeMachineAggs = await usageGroupBy(prisma, {
      by: ["machineId"],
      where: {
        ...dateWhere,
        status: "ZAVRSENO",
        ...(machineId && { machineId }),
        ...(workerId && { workerId }),
        ...(parcelId && { parcelId }),
      },
      _sum: { areaDoneHa: true, workHours: true },
      orderBy: { _sum: { areaDoneHa: "desc" } },
    });

    const total = activeMachineAggs.length;
    const pagedAggs = limit ? activeMachineAggs.slice(skip, skip + limit) : activeMachineAggs;
    const machineIds = pagedAggs.map((a) => a.machineId);

    const machines = await prisma.machine.findMany({
      where: { id: { in: machineIds } },
      select: { id: true, name: true, type: true, brandModel: true },
    });
    const machineMap = Object.fromEntries(machines.map((m) => [m.id, m]));

    // Batch: 2 groupBy upita za celu stranicu umesto 2 upita po mašini (N+1).
    const [fuelAggs, maintenanceAggs] = machineIds.length
      ? await Promise.all([
          prisma.fuelEntry.groupBy({
            by: ["machineId"],
            where: {
              ...dateWhere,
              machineId: { in: machineIds },
              ...(workerId && { workerId }),
              ...(parcelId && { fieldWork: { parcelId } }),
            },
            _sum: { liters: true, totalCost: true },
          }),
          prisma.maintenanceIssue.groupBy({
            by: ["machineId"],
            where: {
              ...parseDateRangeField(req.query, "dateReported"),
              machineId: { in: machineIds },
              ...(workerId && { reportedById: workerId }),
              ...(parcelId && { parcelId }),
            },
            _sum: { totalCost: true },
          }),
        ])
      : [[], []];
    const fuelMap = new Map(fuelAggs.map((r) => [r.machineId, r]));
    const maintMap = new Map(maintenanceAggs.map((r) => [r.machineId, r]));

    const topMachines = pagedAggs.map((agg) => {
      const machine = machineMap[agg.machineId] || { id: agg.machineId, name: "Nepoznata", type: "TRAKTOR" };
      const fuel = fuelMap.get(agg.machineId);
      const fuelTotal = fuel?._sum.totalCost || 0;
      const maintTotal = maintMap.get(agg.machineId)?._sum.totalCost || 0;

      return {
        machine,
        fieldWork: {
          totalHa: agg._sum.areaDoneHa || 0,
          totalWorkHours: agg._sum.workHours || 0,
        },
        fuel: {
          totalLiters: fuel?._sum.liters || 0,
          totalCost: fuelTotal,
        },
        maintenance: {
          totalCost: maintTotal,
        },
        totalCostMachine: addMoney(fuelTotal, maintTotal),
      };
    });

    res.json({
      topMachines,
      pagination: {
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    });
  } catch (error) {
    console.error("Top machines error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju najaktivnijih mašina." });
  }
});

// ============================
// 2. ANALITIKA PO MAŠINI (Sa DB paginacijom & Search)
// ============================
router.get("/machines", async (req, res) => {
  try {
    const { search, all } = req.query;
    const machineId = cleanFilterId(req.query.machineId);
    const workerId = cleanFilterId(req.query.workerId);
    const parcelId = cleanFilterId(req.query.parcelId);
    const dateWhere = parseDateRange(req.query);
    const reportedWhere = parseDateRangeField(req.query, "dateReported");

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const machineFilter = { isActive: true };
    if (machineId) {
      machineFilter.id = machineId;
    } else {
      if (search && search.trim()) {
        machineFilter.OR = [
          { name: { contains: search.trim(), mode: "insensitive" } },
          { brandModel: { contains: search.trim(), mode: "insensitive" } },
        ];
      }
      if (workerId || parcelId) {
        const fwWhere = {
          ...dateWhere,
          status: "ZAVRSENO",
          ...(workerId && { workerId }),
          ...(parcelId && { parcelId }),
        };
        const [fwIds, fuelIds, maintIds, tollIds] = await Promise.all([
          usageGroupBy(prisma, { by: ["machineId"], where: fwWhere, _sum: { areaDoneHa: true } }),
          prisma.fuelEntry.groupBy({
            by: ["machineId"],
            where: {
              ...dateWhere,
              ...(workerId && { workerId }),
              ...(parcelId && { fieldWork: { parcelId } }),
            },
          }),
          prisma.maintenanceIssue.groupBy({
            by: ["machineId"],
            where: {
              ...reportedWhere,
              ...(workerId && { reportedById: workerId }),
              ...(parcelId && { parcelId }),
            },
          }),
          parcelId
            ? Promise.resolve([])
            : prisma.tollEntry.groupBy({
                by: ["machineId"],
                where: { ...dateWhere, ...(workerId && { workerId }) },
              }),
        ]);
        const activeIds = [
          ...new Set(
            [
              ...fwIds.map((r) => r.machineId),
              ...fuelIds.map((r) => r.machineId),
              ...maintIds.map((r) => r.machineId),
              ...tollIds.map((r) => r.machineId),
            ].filter(Boolean)
          ),
        ];
        if (!activeIds.length) {
          return res.json({
            machines: [],
            pagination: { total: 0, page, limit: limit || 0, totalPages: 1 },
          });
        }
        machineFilter.id = { in: activeIds };
      }
    }

    const total = await prisma.machine.count({ where: machineFilter });

    const machines = await prisma.machine.findMany({
      where: machineFilter,
      select: {
        id: true,
        name: true,
        type: true,
        brandModel: true,
        currentHours: true,
        status: true,
        tankCapacityLiters: true,
        currentFuelLiters: true,
      },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    });

    const stats = await loadAnalyticsBatch(
      prisma,
      "machine",
      machines.map((item) => item.id),
      dateWhere,
      reportedWhere,
      {},
      { workerId, parcelId }
    );
    const machineStats = machines.map((machine) => {
      const { fieldWork, fuel, maintenance, tolls, related: topWorkers,
        workTypeBreakdown, workTypeMap, relatedMap: workerMap, recentRepairs } = stats.get(machine.id);

      return {
        machine,
        fieldWork: {
          totalHa: fieldWork._sum.areaDoneHa || 0,
          totalWorkHours: fieldWork._sum.workHours || 0,
          count: fieldWork._count,
        },
        fuel: {
          totalLiters: fuel._sum.liters || 0,
          totalCost: fuel._sum.totalCost || 0,
          count: fuel._count,
          // Dispensed liters do not measure consumption. Use /fuel-efficiency.
          avgLPerHa: null,
        },
        maintenance: {
          totalCost: maintenance._sum.totalCost || 0,
          partsCost: maintenance._sum.partsCost || 0,
          laborCost: maintenance._sum.laborCost || 0,
          downtimeHours: Math.round((maintenance._sum.downtimeHours || 0) * 10) / 10,
          count: maintenance._count,
          recentRepairs,
        },
        tolls: {
          totalCost: tolls._sum.amount || 0,
          count: tolls._count,
        },
        totalCostMachine:
          addMoney(fuel._sum.totalCost || 0, maintenance._sum.totalCost || 0, tolls._sum.amount || 0),
        topWorkers: topWorkers.map((tw) => ({
          workerName: workerMap[tw.workerId] || "Nepoznat",
          workerId: tw.workerId,
          totalHa: tw._sum.areaDoneHa || 0,
          totalHours: tw._sum.workHours || 0,
          count: tw._count,
        })),
        workTypeBreakdown: workTypeBreakdown.map((wt) => ({
          workTypeName: workTypeMap[wt.workTypeId] || "Nepoznat",
          workTypeId: wt.workTypeId,
          totalHa: wt._sum.areaDoneHa || 0,
          count: wt._count,
        })),
      };
    });

    res.json({
      machines: machineStats,
      pagination: {
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    });
  } catch (error) {
    console.error("Analytics machines error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju analitike mašina." });
  }
});

// ============================
// 3. ANALITIKA PO RADNIKU (Sa DB paginacijom & Search)
// ============================
router.get("/workers", async (req, res) => {
  try {
    const { search, all } = req.query;
    const workerId = cleanFilterId(req.query.workerId);
    const machineId = cleanFilterId(req.query.machineId);
    const parcelId = cleanFilterId(req.query.parcelId);
    const dateWhere = parseDateRange(req.query);
    const reportedWhere = parseDateRangeField(req.query, "dateReported");
    const orderWhere = parseDateRangeField(req.query, "orderDate");

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const workerFilter = { isActive: true };
    if (workerId) {
      workerFilter.id = workerId;
    } else {
      if (search && search.trim()) {
        workerFilter.name = { contains: search.trim(), mode: "insensitive" };
      }
      if (machineId || parcelId) {
        const fwWhere = {
          ...dateWhere,
          status: "ZAVRSENO",
          ...(machineId && { machineId }),
          ...(parcelId && { parcelId }),
        };
        const [fwIds, fuelIds, maintIds, orderIds, tollIds] = await Promise.all([
          machineId
            ? usageGroupBy(prisma, { by: ["workerId"], where: fwWhere, _sum: { areaDoneHa: true } })
            : prisma.fieldWork.groupBy({ by: ["workerId"], where: fwWhere }),
          prisma.fuelEntry.groupBy({
            by: ["workerId"],
            where: {
              ...dateWhere,
              ...(machineId && { machineId }),
              ...(parcelId && { fieldWork: { parcelId } }),
            },
          }),
          prisma.maintenanceIssue.groupBy({
            by: ["reportedById"],
            where: {
              ...reportedWhere,
              ...(machineId && { machineId }),
              ...(parcelId && { parcelId }),
            },
          }),
          prisma.workOrder.groupBy({
            by: ["workerId"],
            where: {
              ...orderWhere,
              ...(machineId && { machineId }),
              ...(parcelId && { parcelId }),
            },
          }),
          parcelId
            ? Promise.resolve([])
            : prisma.tollEntry.groupBy({
                by: ["workerId"],
                where: { ...dateWhere, ...(machineId && { machineId }) },
              }),
        ]);
        const activeIds = [
          ...new Set(
            [
              ...fwIds.map((r) => r.workerId),
              ...fuelIds.map((r) => r.workerId),
              ...maintIds.map((r) => r.reportedById),
              ...orderIds.map((r) => r.workerId),
              ...tollIds.map((r) => r.workerId),
            ].filter(Boolean)
          ),
        ];
        if (!activeIds.length) {
          return res.json({
            workers: [],
            pagination: { total: 0, page, limit: limit || 0, totalPages: 1 },
          });
        }
        workerFilter.id = { in: activeIds };
      }
    }

    const total = await prisma.worker.count({ where: workerFilter });

    const workers = await prisma.worker.findMany({
      where: workerFilter,
      select: {
        id: true,
        name: true,
        type: true,
        role: true,
        phone: true,
        hourlyRate: true,
        dailyWage: true,
      },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    });

    const stats = await loadAnalyticsBatch(
      prisma,
      "worker",
      workers.map((item) => item.id),
      dateWhere,
      reportedWhere,
      orderWhere,
      { machineId, parcelId }
    );
    const workerStats = workers.map((worker) => {
      const { fieldWork, fuel, maintenance, tolls, related: machineBreakdown,
        workTypeBreakdown, workTypeMap, relatedMap: machineMap, parcelBreakdown, parcelMap, orderStats } = stats.get(worker.id);

      return {
        worker,
        fieldWork: {
          totalHa: fieldWork._sum.areaDoneHa || 0,
          totalWorkHours: fieldWork._sum.workHours || 0,
          count: fieldWork._count,
          estimatedLabourCost: worker.hourlyRate
            ? multiplyMoney(fieldWork._sum.workHours || 0, worker.hourlyRate)
            : null,
        },
        fuel: {
          totalLiters: fuel._sum.liters || 0,
          totalCost: fuel._sum.totalCost || 0,
          // Dispensed liters do not measure consumption. Use /fuel-efficiency.
          avgLPerHa: null,
        },
        maintenanceReported: maintenance,
        tolls: {
          totalCost: tolls._sum.amount || 0,
          count: tolls._count,
        },
        machineBreakdown: machineBreakdown.map((m) => ({
          machineName: machineMap[m.machineId] || "Nepoznata",
          machineId: m.machineId,
          totalHa: m._sum.areaDoneHa || 0,
          totalHours: m._sum.workHours || 0,
          count: m._count,
        })),
        workTypeBreakdown: workTypeBreakdown.map((wt) => ({
          workTypeName: workTypeMap[wt.workTypeId] || "Nepoznat",
          totalHa: wt._sum.areaDoneHa || 0,
          count: wt._count,
        })),
        parcelBreakdown: parcelBreakdown.map((p) => ({
          parcelName: parcelMap[p.parcelId] || "Nepoznata",
          totalHa: p._sum.areaDoneHa || 0,
          count: p._count,
        })),
        orderStats: orderStats.reduce(
          (acc, os) => {
            acc[os.status] = os._count;
            return acc;
          },
          {}
        ),
      };
    });

    res.json({
      workers: workerStats,
      pagination: {
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    });
  } catch (error) {
    console.error("Analytics workers error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju analitike radnika." });
  }
});

// ============================
// 4. ANALITIKA PO PARCELI (Sa DB paginacijom & Search)
// ============================
router.get("/parcels", async (req, res) => {
  try {
    const { search, all } = req.query;
    const parcelId = cleanFilterId(req.query.parcelId);
    const machineId = cleanFilterId(req.query.machineId);
    const workerId = cleanFilterId(req.query.workerId);
    const dateWhere = parseDateRange(req.query);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const parcelFilter = { isActive: true };
    if (parcelId) {
      parcelFilter.id = parcelId;
    } else {
      if (search && search.trim()) {
        parcelFilter.OR = [
          { name: { contains: search.trim(), mode: "insensitive" } },
          { code: { contains: search.trim(), mode: "insensitive" } },
        ];
      }
      if (machineId) {
        const fwParcels = await usageGroupBy(prisma, {
          by: ["parcelId"],
          where: {
            ...dateWhere,
            status: "ZAVRSENO",
            machineId,
            ...(workerId && { workerId }),
          },
          _sum: { areaDoneHa: true },
        });
        const activeIds = [...new Set(fwParcels.map((r) => r.parcelId).filter(Boolean))];
        if (!activeIds.length) {
          return res.json({
            parcels: [],
            pagination: { total: 0, page, limit: limit || 0, totalPages: 1 },
          });
        }
        parcelFilter.id = { in: activeIds };
      } else if (workerId) {
        const [fwParcels, fertParcels] = await Promise.all([
          prisma.fieldWork.groupBy({
            by: ["parcelId"],
            where: { ...dateWhere, status: "ZAVRSENO", workerId },
          }),
          prisma.fertilizerMovement.groupBy({
            by: ["parcelId"],
            where: {
              ...dateWhere,
              movementType: "IZDAVANJE_NJIVA",
              receivedWorkerId: workerId,
              parcelId: { not: null },
            },
          }),
        ]);
        const activeIds = [
          ...new Set(
            [...fwParcels.map((r) => r.parcelId), ...fertParcels.map((r) => r.parcelId)].filter(Boolean)
          ),
        ];
        if (!activeIds.length) {
          return res.json({
            parcels: [],
            pagination: { total: 0, page, limit: limit || 0, totalPages: 1 },
          });
        }
        parcelFilter.id = { in: activeIds };
      }
    }

    const total = await prisma.parcel.count({ where: parcelFilter });

    const parcels = await prisma.parcel.findMany({
      where: parcelFilter,
      select: {
        id: true,
        name: true,
        code: true,
        areaHa: true,
        currentCrop: true,
        location: true,
      },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    });

    // Batch: 3 groupBy upita za celu stranicu umesto 3 upita po parceli (N+1).
    const parcelIds = parcels.map((p) => p.id);
    const pageWhere = { ...dateWhere, parcelId: { in: parcelIds } };
    const [fieldWorkAggs, fertilizerAggs, seasonalAggs] = parcelIds.length
      ? await Promise.all([
          machineId
            ? usageGroupBy(prisma, {
                by: ["parcelId"],
                where: {
                  ...pageWhere,
                  status: "ZAVRSENO",
                  machineId,
                  ...(workerId && { workerId }),
                },
                _sum: { areaDoneHa: true, workHours: true },
              })
            : prisma.fieldWork.groupBy({
                by: ["parcelId"],
                where: {
                  ...pageWhere,
                  status: "ZAVRSENO",
                  ...(workerId && { workerId }),
                },
                _sum: { areaDoneHa: true, workHours: true },
                _count: { _all: true },
              }),
          machineId
            ? Promise.resolve([])
            : prisma.fertilizerMovement.groupBy({
                by: ["parcelId"],
                where: {
                  ...pageWhere,
                  movementType: "IZDAVANJE_NJIVA",
                  ...(workerId && { receivedWorkerId: workerId }),
                },
                _sum: { quantity: true, totalCost: true },
                _count: { _all: true },
              }),
          machineId || workerId
            ? Promise.resolve([])
            : prisma.seasonalWorkLog.groupBy({
                by: ["parcelId"],
                where: pageWhere,
                _sum: { hoursWorked: true, dailyWageApplied: true },
                _count: { _all: true },
              }),
        ])
      : [[], [], []];
    const byParcel = (rows) => new Map(rows.map((r) => [r.parcelId, r]));
    const fwMap = byParcel(fieldWorkAggs);
    const fertMap = byParcel(fertilizerAggs);
    const seasMap = byParcel(seasonalAggs);

    const parcelStats = parcels.map((parcel) => {
      const fieldWork = fwMap.get(parcel.id);
      const fertilizer = fertMap.get(parcel.id);
      const seasonal = seasMap.get(parcel.id);
      const fieldWorkCount =
        typeof fieldWork?._count === "number" ? fieldWork._count : (fieldWork?._count?._all || 0);
      return {
        parcel,
        fieldWork: {
          totalHa: fieldWork?._sum.areaDoneHa || 0,
          totalWorkHours: fieldWork?._sum.workHours || 0,
          count: fieldWorkCount,
        },
        fertilizer: {
          totalQuantity: fertilizer?._sum.quantity || 0,
          totalCost: fertilizer?._sum.totalCost || 0,
          count: fertilizer?._count._all || 0,
        },
        seasonal: {
          totalHours: seasonal?._sum.hoursWorked || 0,
          totalWages: seasonal?._sum.dailyWageApplied || 0,
          count: seasonal?._count._all || 0,
        },
      };
    });

    res.json({
      parcels: parcelStats,
      pagination: {
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    });
  } catch (error) {
    console.error("Analytics parcels error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju analitike parcela." });
  }
});

// ============================
// 5. FINANSIJSKI PREGLED (Sa paginacijom meseci)
// ============================
router.get("/financial", async (req, res) => {
  try {
    const { fromIso, toIso } = getIsoDateBounds(req.query);
    const machineId = cleanFilterId(req.query.machineId);
    const workerId = cleanFilterId(req.query.workerId);
    const parcelId = cleanFilterId(req.query.parcelId);
    const hasEntityFilter = Boolean(machineId || workerId || parcelId);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));

    const fuelJoinSql = parcelId ? Prisma.sql`JOIN field_work fw ON fw.id = fe."fieldWorkId"` : Prisma.empty;
    const fuelParcelSql = parcelId ? Prisma.sql`AND fw."parcelId" = ${parcelId}` : Prisma.empty;
    const fuelMachineSql = machineId ? Prisma.sql`AND fe."machineId" = ${machineId}` : Prisma.empty;
    const fuelWorkerSql = workerId ? Prisma.sql`AND fe."workerId" = ${workerId}` : Prisma.empty;

    const maintMachineSql = machineId ? Prisma.sql`AND mi."machineId" = ${machineId}` : Prisma.empty;
    const maintWorkerSql = workerId ? Prisma.sql`AND mi."reportedById" = ${workerId}` : Prisma.empty;
    const maintParcelSql = parcelId ? Prisma.sql`AND mi."parcelId" = ${parcelId}` : Prisma.empty;

    const tollMachineSql = machineId ? Prisma.sql`AND te."machineId" = ${machineId}` : Prisma.empty;
    const tollWorkerSql = workerId ? Prisma.sql`AND te."workerId" = ${workerId}` : Prisma.empty;

    const seasonalParcelSql = parcelId ? Prisma.sql`AND sw."parcelId" = ${parcelId}` : Prisma.empty;

    const [fuelByMonthRows, maintenanceByMonth, fuelSupplyByMonth, tollsByMonth, seasonalByMonth] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        SELECT
          ${sqlBelgradeMonth(Prisma.raw("fe.date"))} AS month,
          COALESCE(SUM(fe.liters), 0)::float8 AS total_liters,
          ROUND(COALESCE(SUM(fe."totalCost"), 0), 2)::float8 AS total_cost,
          COUNT(*)::int AS entry_count
        FROM fuel_entry fe
        ${fuelJoinSql}
        WHERE 1 = 1
          ${sqlDateBounds(Prisma.raw("fe.date"), fromIso, toIso)}
          ${fuelMachineSql}
          ${fuelWorkerSql}
          ${fuelParcelSql}
        GROUP BY 1
        ORDER BY month DESC
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT
          ${sqlBelgradeMonth(Prisma.raw('mi."dateReported"'))} AS month,
          ROUND(COALESCE(SUM(mi."totalCost"), 0), 2)::float8 AS total_cost,
          ROUND(COALESCE(SUM(mi."partsCost"), 0), 2)::float8 AS parts_cost,
          ROUND(COALESCE(SUM(mi."laborCost"), 0), 2)::float8 AS labor_cost,
          COUNT(*)::int AS issue_count
        FROM maintenance_issue mi
        WHERE 1 = 1
          ${sqlDateBounds(Prisma.raw('mi."dateReported"'), fromIso, toIso)}
          ${maintMachineSql}
          ${maintWorkerSql}
          ${maintParcelSql}
        GROUP BY 1
        ORDER BY month DESC
      `),
      hasEntityFilter
        ? Promise.resolve([])
        : prisma.$queryRaw(Prisma.sql`
            SELECT
              ${sqlBelgradeMonth(Prisma.raw("fs.date"))} AS month,
              COALESCE(SUM(fs.liters), 0)::float8 AS total_liters,
              ROUND(COALESCE(SUM(fs."totalCost"), 0), 2)::float8 AS total_cost
            FROM fuel_supply fs
            WHERE 1 = 1
              ${sqlDateBounds(Prisma.raw("fs.date"), fromIso, toIso)}
            GROUP BY 1
            ORDER BY month DESC
          `),
      parcelId
        ? Promise.resolve([])
        : prisma.$queryRaw(Prisma.sql`
            SELECT
              ${sqlBelgradeMonth(Prisma.raw("te.date"))} AS month,
              ROUND(COALESCE(SUM(te.amount), 0), 2)::float8 AS total_amount,
              COUNT(*)::int AS entry_count
            FROM toll_entry te
            WHERE 1 = 1
              ${sqlDateBounds(Prisma.raw("te.date"), fromIso, toIso)}
              ${tollMachineSql}
              ${tollWorkerSql}
            GROUP BY 1
            ORDER BY month DESC
          `),
      machineId || workerId
        ? Promise.resolve([])
        : prisma.$queryRaw(Prisma.sql`
            SELECT
              ${sqlBelgradeMonth(Prisma.raw("sw.date"))} AS month,
              COALESCE(SUM(sw."hoursWorked"), 0)::float8 AS total_hours,
              ROUND(COALESCE(SUM(sw."dailyWageApplied"), 0), 2)::float8 AS total_wages,
              COUNT(*)::int AS log_count
            FROM seasonal_work_log sw
            WHERE 1 = 1
              ${sqlDateBounds(Prisma.raw("sw.date"), fromIso, toIso)}
              ${seasonalParcelSql}
            GROUP BY 1
            ORDER BY month DESC
          `),
    ]);

    const fuelMap = Object.fromEntries(fuelByMonthRows.map((row) => [row.month, row]));

    const allMonthKeys = [
      ...new Set([
        ...fuelByMonthRows.map((row) => row.month),
        ...maintenanceByMonth.map((row) => row.month),
        ...tollsByMonth.map((row) => row.month),
        ...seasonalByMonth.map((row) => row.month),
      ]),
    ].sort((a, b) => b.localeCompare(a));

    const sortedMonths = allMonthKeys.map(
      (month) => fuelMap[month] || { month, total_liters: 0, total_cost: 0, entry_count: 0 }
    );
    const total = sortedMonths.length;
    const paginatedMonths = limit ? sortedMonths.slice((page - 1) * limit, page * limit) : sortedMonths;

    res.json({
      fuelByMonth: paginatedMonths,
      allFuelByMonth: sortedMonths,
      maintenanceByMonth,
      fuelSupplyByMonth,
      tollsByMonth,
      seasonalByMonth,
      pagination: {
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    });
  } catch (error) {
    console.error("Analytics financial error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju finansijske analitike." });
  }
});

// ============================
// 5.1 DETALJAN DNEVNIK RADOVA (Svi radovi + statistike po radniku/mašini/parceli)
// ============================
router.get("/works", async (req, res) => {
  try {
    const { search, all } = req.query;
    const dateWhere = parseDateRange(req.query);
    const { fromIso, toIso } = getIsoDateBounds(req.query);
    const machineId = cleanFilterId(req.query.machineId);
    const workerId = cleanFilterId(req.query.workerId);
    const parcelId = cleanFilterId(req.query.parcelId);
    const workTypeId = cleanFilterId(req.query.workTypeId);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const where = {
      ...dateWhere,
      status: "ZAVRSENO",
      ...(workerId && { workerId }),
      ...(parcelId && { parcelId }),
      ...(workTypeId && { workTypeId }),
    };

    if (machineId) {
      where.OR = [
        { machineId },
        { attachmentId: machineId },
        { machineAssignments: { some: { machineId, voidedAt: null } } },
      ];
    }

    const trimmedSearch = search && search.trim() ? search.trim() : undefined;
    if (trimmedSearch) {
      const searchCond = {
        OR: [
          { workType: { name: { contains: trimmedSearch, mode: "insensitive" } } },
          { parcel: { name: { contains: trimmedSearch, mode: "insensitive" } } },
          { parcel: { code: { contains: trimmedSearch, mode: "insensitive" } } },
          { worker: { name: { contains: trimmedSearch, mode: "insensitive" } } },
          { machine: { name: { contains: trimmedSearch, mode: "insensitive" } } },
          { attachment: { name: { contains: trimmedSearch, mode: "insensitive" } } },
          { notes: { contains: trimmedSearch, mode: "insensitive" } },
        ],
      };
      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchCond];
        delete where.OR;
      } else {
        where.OR = searchCond.OR;
      }
    }

    const searchPattern = trimmedSearch ? `%${trimmedSearch.replace(/[\\%_]/g, "\\$&")}%` : null;
    const searchJoinSql = searchPattern
      ? Prisma.sql`
          LEFT JOIN work_type wt ON wt.id = w."workTypeId"
          LEFT JOIN parcel p ON p.id = w."parcelId"
          LEFT JOIN worker r ON r.id = w."workerId"
          LEFT JOIN machine m ON m.id = w."machineId"
          LEFT JOIN machine att ON att.id = w."attachmentId"
        `
      : Prisma.empty;
    const searchSql = searchPattern
      ? Prisma.sql`AND (
          wt.name ILIKE ${searchPattern}
          OR p.name ILIKE ${searchPattern}
          OR p.code ILIKE ${searchPattern}
          OR r.name ILIKE ${searchPattern}
          OR m.name ILIKE ${searchPattern}
          OR att.name ILIKE ${searchPattern}
          OR w.notes ILIKE ${searchPattern}
        )`
      : Prisma.empty;
    const machineSql = machineId
      ? Prisma.sql`AND (
          w."machineId" = ${machineId}
          OR w."attachmentId" = ${machineId}
          OR EXISTS (
            SELECT 1 FROM machine_assignment ma
            WHERE ma."fieldWorkId" = w.id
              AND ma."machineId" = ${machineId}
              AND ma."voidedAt" IS NULL
          )
        )`
      : Prisma.empty;
    const workerSql = workerId ? Prisma.sql`AND w."workerId" = ${workerId}` : Prisma.empty;
    const parcelSql = parcelId ? Prisma.sql`AND w."parcelId" = ${parcelId}` : Prisma.empty;
    const workTypeSql = workTypeId ? Prisma.sql`AND w."workTypeId" = ${workTypeId}` : Prisma.empty;

    const [total, works, agg, workTypeGroups, parcelGroups, workerHourGroups, distinctDaysRows] = await Promise.all([
      prisma.fieldWork.count({ where }),
      prisma.fieldWork.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
        select: {
          id: true,
          date: true,
          shift: true,
          areaDoneHa: true,
          startTime: true,
          endTime: true,
          workHours: true,
          notes: true,
          worker: { select: { id: true, name: true, role: true } },
          parcel: { select: { id: true, code: true, name: true, currentCrop: true, areaHa: true } },
          machine: { select: { id: true, name: true, type: true } },
          attachment: { select: { id: true, name: true, type: true } },
          contractor: { select: { id: true, name: true } },
          workType: { select: { id: true, name: true, category: true, unit: true } },
          materials: { select: { id: true, kind: true, name: true, unit: true, dosePerHa: true } },
          machineAssignments: {
            where: { voidedAt: null },
            select: {
              id: true,
              machineId: true,
              areaDoneHa: true,
              startHours: true,
              endHours: true,
              machine: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.fieldWork.aggregate({
        where,
        _sum: { areaDoneHa: true, workHours: true },
      }),
      prisma.fieldWork.groupBy({
        by: ["workTypeId"],
        where,
        _sum: { areaDoneHa: true, workHours: true },
        _count: { _all: true },
        orderBy: { _sum: { areaDoneHa: "desc" } },
      }),
      prisma.fieldWork.groupBy({
        by: ["parcelId"],
        where,
      }),
      prisma.fieldWork.groupBy({
        by: ["workerId"],
        where,
        _sum: { workHours: true },
      }),
      prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT (w.date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date)::int AS "distinctDays"
        FROM field_work w
        ${searchJoinSql}
        WHERE w.status = 'ZAVRSENO'
          ${sqlDateBounds(Prisma.raw("w.date"), fromIso, toIso)}
          ${workerSql}
          ${parcelSql}
          ${workTypeSql}
          ${machineSql}
          ${searchSql}
      `),
    ]);

    const wtIds = workTypeGroups.map((g) => g.workTypeId);
    const wIds = workerHourGroups.map((g) => g.workerId);
    const [workTypeRows, workerRateRows] = await Promise.all([
      wtIds.length
        ? prisma.workType.findMany({
            where: { id: { in: wtIds } },
            select: { id: true, name: true, category: true },
          })
        : [],
      wIds.length
        ? prisma.worker.findMany({
            where: { id: { in: wIds } },
            select: { id: true, hourlyRate: true },
          })
        : [],
    ]);
    const wtMap = new Map(workTypeRows.map((wt) => [wt.id, wt]));
    const rateMap = new Map(workerRateRows.map((w) => [w.id, w.hourlyRate]));

    let estimatedLabourCost = 0;
    let hasRateData = false;
    for (const row of workerHourGroups) {
      const hourlyRate = rateMap.get(row.workerId);
      if (hourlyRate) {
        hasRateData = true;
        estimatedLabourCost = addMoney(estimatedLabourCost, multiplyMoney(row._sum.workHours || 0, hourlyRate));
      }
    }

    const distinctDays = distinctDaysRows[0]?.distinctDays || 0;
    const totalHa = agg._sum.areaDoneHa || 0;
    const totalHours = agg._sum.workHours || 0;

    const byWorkType = workTypeGroups.map((g) => {
      const wt = wtMap.get(g.workTypeId);
      return {
        workTypeId: g.workTypeId,
        name: wt?.name || "Nepoznato",
        category: wt?.category || "OSTALO",
        totalHa: g._sum.areaDoneHa || 0,
        totalHours: g._sum.workHours || 0,
        count: g._count._all || 0,
      };
    });

    res.json({
      works,
      byWorkType,
      summary: {
        totalWorks: total,
        totalHa,
        totalHours,
        avgHaPerHour: totalHours > 0 ? totalHa / totalHours : null,
        avgHaPerWork: total > 0 ? totalHa / total : null,
        distinctParcels: parcelGroups.length,
        distinctWorkTypes: workTypeGroups.length,
        distinctDays,
        avgHoursPerDay: distinctDays > 0 ? totalHours / distinctDays : null,
        estimatedLabourCost: hasRateData ? estimatedLabourCost : null,
      },
      pagination: {
        total,
        page,
        limit: limit || total,
        totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
      },
    });
  } catch (error) {
    console.error("Analytics works error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju dnevnika radova." });
  }
});

// ============================
// 6. DROPDOWN LISTE ZA FILTERE
// ============================
router.get("/filters", async (req, res) => {
  try {
    const [machines, workers, parcels, workTypes] = await Promise.all([
      prisma.machine.findMany({
        where: { isActive: true },
        select: { id: true, name: true, type: true },
        orderBy: { name: "asc" },
      }),
      prisma.worker.findMany({
        where: { isActive: true, type: "STALNI" },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.parcel.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, areaHa: true },
        orderBy: { name: "asc" },
      }),
      prisma.workType.findMany({
        where: { isActive: true },
        select: { id: true, name: true, category: true },
        orderBy: { name: "asc" },
      }),
    ]);

    res.json({ machines, workers, parcels, workTypes });
  } catch (error) {
    console.error("Analytics filters error:", error);
    res.status(500).json({ error: "Greška pri dohvatanju filtera." });
  }
});

export default router;

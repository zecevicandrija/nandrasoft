import { loadFuelEfficiency } from "../lib/fuelEfficiency.js";
import { loadAnalyticsBatch } from "../lib/analyticsBatch.js";
import { addMoney, multiplyMoney } from "../lib/money.js";
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

// ============================
// 1. GENERALNI PREGLED (Dashboard kartice)
// ============================
router.get("/overview", async (req, res) => {
  try {
    const dateWhere = parseDateRange(req.query);

    const [
      totalFieldWorks,
      totalHaDone,
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
      prisma.fieldWork.count({
        where: { ...dateWhere, status: "ZAVRSENO" },
      }),
      prisma.fieldWork.aggregate({
        where: { ...dateWhere, status: "ZAVRSENO" },
        _sum: { areaDoneHa: true },
      }),
      prisma.fuelEntry.aggregate({
        where: dateWhere,
        _sum: { liters: true, totalCost: true },
      }),
      prisma.maintenanceIssue.aggregate({
        where: parseDateRangeField(req.query, "dateReported"),
        _sum: { totalCost: true, partsCost: true, laborCost: true },
      }),
      prisma.workOrder.count({
        where: parseDateRangeField(req.query, "orderDate"),
      }),
      prisma.workOrder.count({
        where: {
          ...parseDateRangeField(req.query, "orderDate"),
          status: "ZAVRSEN",
        },
      }),
      prisma.tollEntry.aggregate({
        where: dateWhere,
        _sum: { amount: true },
      }),
      prisma.fertilizerMovement.aggregate({
        where: {
          ...dateWhere,
          movementType: "PRIJEM_NABAVKA",
        },
        _sum: { totalCost: true },
      }),
      prisma.seasonalWorkLog.aggregate({
        where: dateWhere,
        _sum: { hoursWorked: true, dailyWageApplied: true },
      }),
      prisma.machine.count({ where: { isActive: true } }),
      prisma.worker.count({ where: { isActive: true } }),
      prisma.parcel.count({ where: { isActive: true } }),
      prisma.onionShipment.aggregate({
        where: dateWhere,
        _sum: { totalWeightKg: true, totalValue: true },
      }),
    ]);

    res.json({
      totalFieldWorks,
      totalHaDone: totalHaDone._sum.areaDoneHa || 0,
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    // Pronađi mašine grupisane i rangirane po obrađenoj površini
    const activeMachineAggs = await prisma.fieldWork.groupBy({
      by: ["machineId"],
      where: { ...dateWhere, status: "ZAVRSENO" },
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
            where: { ...dateWhere, machineId: { in: machineIds } },
            _sum: { liters: true, totalCost: true },
          }),
          prisma.maintenanceIssue.groupBy({
            by: ["machineId"],
            where: { ...parseDateRangeField(req.query, "dateReported"), machineId: { in: machineIds } },
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
    const { machineId, search, all } = req.query;
    const dateWhere = parseDateRange(req.query);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const machineFilter = { isActive: true };
    if (machineId) {
      machineFilter.id = machineId;
    } else if (search && search.trim()) {
      machineFilter.OR = [
        { name: { contains: search.trim(), mode: "insensitive" } },
        { brandModel: { contains: search.trim(), mode: "insensitive" } },
      ];
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
      prisma, "machine", machines.map((item) => item.id), dateWhere,
      parseDateRangeField(req.query, "dateReported")
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
          downtimeHours: maintenance._sum.downtimeHours || 0,
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
    const { workerId, search, all } = req.query;
    const dateWhere = parseDateRange(req.query);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const workerFilter = { isActive: true };
    if (workerId) {
      workerFilter.id = workerId;
    } else if (search && search.trim()) {
      workerFilter.name = { contains: search.trim(), mode: "insensitive" };
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
      prisma, "worker", workers.map((item) => item.id), dateWhere,
      parseDateRangeField(req.query, "dateReported"),
      parseDateRangeField(req.query, "orderDate")
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
    const { dateFrom, dateTo, parcelId, search, all } = req.query;
    const dateWhere = parseDateRange(req.query);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const parcelFilter = { isActive: true };
    if (parcelId) {
      parcelFilter.id = parcelId;
    } else if (search && search.trim()) {
      parcelFilter.OR = [
        { name: { contains: search.trim(), mode: "insensitive" } },
        { code: { contains: search.trim(), mode: "insensitive" } },
      ];
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
          prisma.fieldWork.groupBy({
            by: ["parcelId"],
            where: { ...pageWhere, status: "ZAVRSENO" },
            _sum: { areaDoneHa: true, workHours: true },
            _count: { _all: true },
          }),
          prisma.fertilizerMovement.groupBy({
            by: ["parcelId"],
            where: { ...pageWhere, movementType: "IZDAVANJE_NJIVA" },
            _sum: { quantity: true, totalCost: true },
            _count: { _all: true },
          }),
          prisma.seasonalWorkLog.groupBy({
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
      return {
        parcel,
        fieldWork: {
          totalHa: fieldWork?._sum.areaDoneHa || 0,
          totalWorkHours: fieldWork?._sum.workHours || 0,
          count: fieldWork?._count._all || 0,
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
    const dateWhere = parseDateRange(req.query);
    const mReportedWhere = parseDateRangeField(req.query, "dateReported");

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.all === "true" ? undefined : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));

    const [fuelEntries, maintenanceIssues, fuelSupplies, tollEntries, seasonalLogs] = await Promise.all([
      prisma.fuelEntry.findMany({
        where: dateWhere,
        select: { date: true, liters: true, totalCost: true },
        orderBy: { date: "asc" },
      }),
      prisma.maintenanceIssue.findMany({
        where: mReportedWhere,
        select: { dateReported: true, totalCost: true, partsCost: true, laborCost: true },
        orderBy: { dateReported: "asc" },
      }),
      prisma.fuelSupply.findMany({
        where: dateWhere,
        select: { date: true, liters: true, totalCost: true },
        orderBy: { date: "asc" },
      }),
      prisma.tollEntry.findMany({
        where: dateWhere,
        select: { date: true, amount: true },
        orderBy: { date: "asc" },
      }),
      prisma.seasonalWorkLog.findMany({
        where: dateWhere,
        select: { date: true, hoursWorked: true, dailyWageApplied: true },
        orderBy: { date: "asc" },
      }),
    ]);

    const toMonthKey = (d) => {
      const date = new Date(d);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    };

    const fuelMap = {};
    for (const fe of fuelEntries) {
      const m = toMonthKey(fe.date);
      if (!fuelMap[m]) fuelMap[m] = { month: m, total_liters: 0, total_cost: 0, entry_count: 0 };
      fuelMap[m].total_liters += fe.liters || 0;
      fuelMap[m].total_cost = addMoney(fuelMap[m].total_cost, fe.totalCost || 0);
      fuelMap[m].entry_count += 1;
    }

    const maintMap = {};
    for (const mi of maintenanceIssues) {
      const m = toMonthKey(mi.dateReported);
      if (!maintMap[m]) maintMap[m] = { month: m, total_cost: 0, parts_cost: 0, labor_cost: 0, issue_count: 0 };
      maintMap[m].total_cost = addMoney(maintMap[m].total_cost, mi.totalCost || 0);
      maintMap[m].parts_cost = addMoney(maintMap[m].parts_cost, mi.partsCost || 0);
      maintMap[m].labor_cost = addMoney(maintMap[m].labor_cost, mi.laborCost || 0);
      maintMap[m].issue_count += 1;
    }

    const supplyMap = {};
    for (const fs of fuelSupplies) {
      const m = toMonthKey(fs.date);
      if (!supplyMap[m]) supplyMap[m] = { month: m, total_liters: 0, total_cost: 0 };
      supplyMap[m].total_liters += fs.liters || 0;
      supplyMap[m].total_cost = addMoney(supplyMap[m].total_cost, fs.totalCost || 0);
    }

    const tollMap = {};
    for (const te of tollEntries) {
      const m = toMonthKey(te.date);
      if (!tollMap[m]) tollMap[m] = { month: m, total_amount: 0, entry_count: 0 };
      tollMap[m].total_amount = addMoney(tollMap[m].total_amount, te.amount || 0);
      tollMap[m].entry_count += 1;
    }

    const seasonalMap = {};
    for (const sw of seasonalLogs) {
      const m = toMonthKey(sw.date);
      if (!seasonalMap[m]) seasonalMap[m] = { month: m, total_hours: 0, total_wages: 0, log_count: 0 };
      seasonalMap[m].total_hours += sw.hoursWorked || 0;
      seasonalMap[m].total_wages = addMoney(seasonalMap[m].total_wages, sw.dailyWageApplied || 0);
      seasonalMap[m].log_count += 1;
    }

    const sortedMonths = Object.values(fuelMap).sort((a, b) => b.month.localeCompare(a.month));
    const total = sortedMonths.length;
    const paginatedMonths = limit ? sortedMonths.slice((page - 1) * limit, page * limit) : sortedMonths;

    res.json({
      fuelByMonth: paginatedMonths,
      allFuelByMonth: sortedMonths,
      maintenanceByMonth: Object.values(maintMap).sort((a, b) => b.month.localeCompare(a.month)),
      fuelSupplyByMonth: Object.values(supplyMap).sort((a, b) => b.month.localeCompare(a.month)),
      tollsByMonth: Object.values(tollMap).sort((a, b) => b.month.localeCompare(a.month)),
      seasonalByMonth: Object.values(seasonalMap).sort((a, b) => b.month.localeCompare(a.month)),
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

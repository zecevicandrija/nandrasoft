import { enrichPackingWorkOrders, requirePackingWorker, validatePackingOrder } from "../lib/packingWorkOrders.js";
import { materialsInclude, prepareMaterials } from "../lib/workMaterials.js";
import { createWorkOrderSchema, orderStatusEnum, createWorkOrderRecord, REMONT_PRIORITY_MAP } from "../lib/workOrderCreate.js";
import { assertOrderTransition, assertGenericOrderEdit } from "../lib/workOrderStatusService.js";
import { machineSnapshot } from "../lib/machineUsageService.js";
import { validateContractor } from "../lib/contractors.js";
import { machineMutation, hasOpenMaintenance, syncMachineStatus } from "../lib/machineAvailability.js";
import { fuelSnapshotError, measuredFuelData } from "../lib/machineFuel.js";
import { requireWorkerIdentity, getRequestWorker, canAccessWorkerRecord } from "../lib/workerIdentity.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";
import { enqueueWorkOrderPush } from "../lib/pushOutbox.js";
import { isActiveAssignmentConflict } from "../lib/assignmentConflict.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);
router.use(requireWorkerIdentity);

const ORDER_STATUSES = ["PLANIRAN", "DODELJEN", "U_TOKU", "ZAVRSEN", "OTKAZAN"];
const ORDER_TYPES = ["RAD_NJIVA", "REMONT_SERVIS", "PAKOVANJE", "OSTALO"];
const ACTIVE_ORDER_STATUSES = ["PLANIRAN", "DODELJEN", "U_TOKU"];

const orderRelationSelect = {
  worker: { select: { id: true, name: true } },
  machine: {
    select: {
      id: true,
      name: true,
      updatedAt: true,
      tankCapacityLiters: true,
      currentFuelLiters: true,
      currentHours: true,
    },
  },
  attachment: { select: { id: true, name: true } },
  parcel: { select: { id: true, name: true, code: true } },
  contractor: { select: { id: true, name: true, code: true } },
  workType: { select: { id: true, name: true } },
  materials: materialsInclude,
  maintenance: {
    select: {
      id: true,
      serviceType: true,
      priority: true,
      status: true,
    },
  },
  issuedBy: { select: { id: true, name: true, role: true } },
};

const orderAssignmentSelect = {
  id: true,
  machineId: true,
  status: true,
  startFuelLiters: true,
  endFuelLiters: true,
  voidedAt: true,
  startHours: true,
  assignedAt: true,
  machine: { select: { name: true } },
};

const orderListInclude = {
  ...orderRelationSelect,
  machineAssignments: {
    orderBy: { assignedAt: "desc" },
    select: orderAssignmentSelect,
  },
  fieldWork: {
    select: { id: true, areaDoneHa: true, workHours: true, status: true, photoUrl: true },
  },
};

const orderDetailInclude = {
  ...orderRelationSelect,
  machineAssignments: {
    orderBy: { assignedAt: "desc" },
    select: orderAssignmentSelect,
  },
  fieldWork: true,
};

function parseUtcDayRange(dateInput) {
  const raw = String(dateInput).trim();
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getUTCFullYear();
  const m = parsed.getUTCMonth();
  const d = parsed.getUTCDate();
  return {
    gte: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
    lte: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)),
  };
}

// ==========================================
// 1. DANAŠNJI NALOG ZA ULOGOVANOG RADNIKA
// ==========================================
// Koristi se za mobilni popup / banner radniku kada otvori aplikaciju
router.get("/my-today", async (req, res) => {
  try {
    // Identity comes exclusively from the unique userId foreign key.
    const linkedWorker = await getRequestWorker(req, prisma);
    if (!linkedWorker) return res.status(403).json({ error: "Nalog nije povezan sa aktivnim profilom radnika." });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const orderInclude = {
      machine: orderRelationSelect.machine,
      attachment: orderRelationSelect.attachment,
      parcel: orderRelationSelect.parcel,
      contractor: orderRelationSelect.contractor,
      workType: orderRelationSelect.workType,
      materials: materialsInclude,
      machineAssignments: {
        where: { status: "ZADUZENA" },
        orderBy: { assignedAt: "desc" },
        take: 1,
        select: {
          id: true,
          machineId: true,
          status: true,
          startFuelLiters: true,
          startHours: true,
          assignedAt: true,
        },
      },
      issuedBy: orderRelationSelect.issuedBy,
    };

    // Prvo potraži aktivan nalog za današnji dan
    let todayOrder = await prisma.workOrder.findFirst({
      where: {
        workerId: linkedWorker.id,
        orderDate: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: { in: ACTIVE_ORDER_STATUSES },
      },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    });

    // Ako nema naloga tačno za današnji datum, vrati najnoviji aktivan dodeljen nalog (npr. za sutra)
    if (!todayOrder) {
      todayOrder = await prisma.workOrder.findFirst({
        where: {
          workerId: linkedWorker.id,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      });
    }

    res.json({ todayOrder });
  } catch (error) {
    console.error("Greška pri dohvatanju današnjeg naloga radnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2. SVI NALOZI SA FILTERIMA (ZA RUKOVODIOCA I PREGLED)
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { date, status, workerId, machineId, parcelId, type } = req.query;

    const where = {};

    // Filter po statusu za sve uloge (podrška za AKTIVNI i SVE)
    if (status && status !== "SVE") {
      if (status === "AKTIVNI") {
        where.status = { in: ACTIVE_ORDER_STATUSES };
      } else if (ORDER_STATUSES.includes(String(status))) {
        where.status = String(status);
      } else {
        return res.status(400).json({ error: "Neispravan status filtera." });
      }
    }

    // Ako je korisnik OPERATER ili MEHANICAR, vidi samo svoje radne naloge!
    if (!["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
      const linkedWorker = await getRequestWorker(req, prisma);
      if (linkedWorker) {
        where.workerId = linkedWorker.id;
      } else {
        return res.json({ workOrders: [] });
      }

      // Za operatere: ako nije prosleđen nikakav status, podrazumevano prikazujemo samo aktivne naloge
      if (!status) {
        where.status = { in: ACTIVE_ORDER_STATUSES };
      }
    } else if (workerId) {
      where.workerId = String(workerId);
    }

    if (machineId) where.machineId = String(machineId);
    if (parcelId) where.parcelId = String(parcelId);
    if (type) {
      if (!ORDER_TYPES.includes(String(type))) {
        return res.status(400).json({ error: "Neispravan tip naloga u filteru." });
      }
      where.orderType = String(type);
    }

    if (date) {
      const range = parseUtcDayRange(date);
      if (!range) {
        return res.status(400).json({ error: "Neispravan format datuma." });
      }
      where.orderDate = range;
    }

    // Paginacija (podrazumevano 25 po stranici)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    // Za KPI statistiku koristimo iste filtere (datum, mašina, radnik, parcela, tip) osim statusa;
    // jedan GROUP BY status zamenjuje 5 odvojenih COUNT(*) upita.
    const statsWhere = { ...where };
    delete statsWhere.status;

    const [statusGroups, workOrders] = await Promise.all([
      prisma.workOrder.groupBy({
        by: ["status"],
        where: statsWhere,
        _count: { _all: true },
      }),
      prisma.workOrder.findMany({
        where,
        include: orderListInclude,
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
    ]);

    const countsByStatus = new Map(statusGroups.map((row) => [row.status, row._count._all]));
    const totalOrdersCount = statusGroups.reduce((sum, row) => sum + row._count._all, 0);
    const pendingOrdersCount = (countsByStatus.get("PLANIRAN") || 0) + (countsByStatus.get("DODELJEN") || 0);
    const inProgressOrdersCount = countsByStatus.get("U_TOKU") || 0;
    const completedOrdersCount = countsByStatus.get("ZAVRSEN") || 0;

    let total = totalOrdersCount;
    if (typeof where.status === "string") {
      total = countsByStatus.get(where.status) || 0;
    } else if (Array.isArray(where.status?.in)) {
      total = where.status.in.reduce((sum, s) => sum + (countsByStatus.get(s) || 0), 0);
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const enrichedOrders = await enrichPackingWorkOrders(prisma, workOrders);

    res.json({
      workOrders: enrichedOrders,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
      stats: {
        totalOrders: totalOrdersCount,
        pendingOrders: pendingOrdersCount,
        inProgressOrders: inProgressOrdersCount,
        completedOrders: completedOrdersCount,
      },
    });
  } catch (error) {
    console.error("Greška pri dohvatanju radnih naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2b. POJEDINAČAN RADNI NALOG (DETALJI)
// ==========================================
router.get("/:id", async (req, res) => {
  try {
    const order = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: orderDetailInclude,
    });

    if (!order) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    if (!canAccessWorkerRecord(req, order)) {
      return res.status(403).json({ error: "Nemate dozvolu za pristup ovom radnom nalogu." });
    }

    const [enrichedOrder] = await enrichPackingWorkOrders(prisma, [order]);
    res.json({ workOrder: enrichedOrder });
  } catch (error) {
    console.error("Greška pri dohvatanju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2c. PRIHVATANJE NALOGA & ZADUŽENJE MAŠINE (OPERATER)
// ==========================================
const acceptOrderSchema = z.object({
  startFuelLiters: z.number().nonnegative("Početno gorivo ne može biti negativno").optional(),
  startHours: z.number().nonnegative("Radni sati ne mogu biti negativni").optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

router.post("/:id/accept", machineMutation(async (req, res, prisma) => {
  try {
    const parsed = acceptOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const order = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: { machine: true, worker: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    if (!canAccessWorkerRecord(req, order)) {
      return res.status(403).json({ error: "Nemate dozvolu za pristup ovom radnom nalogu." });
    }

    if (!["PLANIRAN", "DODELJEN"].includes(order.status)) {
      return res.status(400).json({ error: `Nalog je već u statusu ${order.status}.` });
    }
    if (order.orderType === "PAKOVANJE") return res.status(409).json({ error: "Prihvatite nalog u magacinu." });
    assertOrderTransition(order, "U_TOKU", "accept");

    const { startFuelLiters, startHours, notes } = parsed.data;

    // Workshop acceptance never creates an operator checkout or changes fuel/hours.
    if (order.orderType === "REMONT_SERVIS") {
      if (!order.machineId || !order.maintenanceId) {
        return res.status(409).json({ error: "Servisni nalog nema povezanu mašinu i zapis servisa. Potrebna je dopuna starih naloga ili izmena naloga." });
      }
      const issue = await prisma.maintenanceIssue.findUnique({ where: { id: order.maintenanceId } });
      if (!issue || !["OTVOREN", "U_RADU", "CEKA_DELOVE"].includes(issue.status)) {
        return res.status(409).json({ error: "Povezani servis nije aktivan." });
      }
      await prisma.maintenanceIssue.update({
        where: { id: issue.id }, data: { status: "U_RADU", mechanicId: issue.mechanicId || order.workerId },
      });
      const updated = await prisma.workOrder.update({
        where: { id: order.id, workerId: order.workerId, status: order.status },
        data: { status: "U_TOKU" }, include: { machine: true, worker: true, maintenance: true },
      });
      await syncMachineStatus(prisma, order.machineId);
      await prisma.auditLog.create({ data: {
        entityType: "WorkOrder", entityId: order.id, action: "IZMENA", userId: req.user.id,
        userName: req.user.name, userRole: req.user.role,
        description: `Preuzet servisni nalog ${order.orderNumber}.`,
        newValues: { status: "U_TOKU", maintenanceId: issue.id },
      } });
      return res.json({ message: "Servisni nalog je preuzet u rad. Mašina ostaje nedostupna za zaduživanje.", workOrder: updated });
    }

    // Ako nalog nema pridruženu mašinu (npr. ručni magacinski rad)
    if (!order.machineId) {
      const updated = await prisma.workOrder.update({
        where: { id: order.id, workerId: order.workerId, status: order.status },
        data: { status: "U_TOKU" },
        include: { worker: true, parcel: true, contractor: true, workType: true },
      });
      await prisma.auditLog.create({ data: {
        entityType: "WorkOrder", entityId: order.id, action: "IZMENA", userId: req.user.id,
        userName: req.user.name, userRole: req.user.role,
        description: `Prihvaćen nalog ${order.orderNumber} bez zaduženja mašine.`,
        oldValues: { status: order.status }, newValues: { status: "U_TOKU", workerId: order.workerId },
      } });
      return res.json({
        message: `Radni nalog ${order.orderNumber} je prihvaćen i stavljen u rad.`,
        workOrder: updated,
      });
    }

    if (startFuelLiters === undefined) {
      return res.status(400).json({ error: "Početno gorivo je obavezno za zaduživanje mašine." });
    }

    const activeAssignment = await prisma.machineAssignment.findFirst({
      where: { machineId: order.machineId, status: "ZADUZENA" },
    });
    if (activeAssignment || order.machine?.isActive === false || order.machine?.status !== "SLOBODNA" || await hasOpenMaintenance(prisma, order.machineId)) {
      return res.status(409).json({ error: "Mašina nije dostupna za zaduživanje (zadužena, u kvaru ili na servisu)." });
    }

    // Provera kapaciteta rezervoara mašine
    const tankCapacity = order.machine?.tankCapacityLiters || 200;
    if (startFuelLiters > tankCapacity) {
      return res.status(400).json({
        error: `Nije moguće uneti više od maksimalnog kapaciteta rezervoara mašine "${order.machine?.name}" (${tankCapacity} L). Pokušano zaduženje: ${startFuelLiters} L.`,
      });
    }

    const calculatedStartFuelLevel =
      tankCapacity > 0 ? Math.round((startFuelLiters / tankCapacity) * 100) : null;

    const conflict = fuelSnapshotError(order.machine, req.body.expectedMachineUpdatedAt);
    if (conflict) return res.status(409).json(conflict);

    const initialHours =
      startHours !== undefined && startHours !== null
        ? startHours
        : order.machine?.currentHours || 0;

    // Atomska transakcija: kreiraj MachineAssignment, ažuriraj Machine, prebaci WorkOrder u U_TOKU
    const [assignment, updatedMachine, updatedOrder] = await prisma.$transaction([
      prisma.machineAssignment.create({
        data: {
          machineId: order.machineId,
          workerId: order.workerId,
          machineStateBefore: machineSnapshot(order.machine),
          parcelId: order.parcelId || null,
          workOrderId: order.id,
          startFuelLiters,
          startFuelLevel: calculatedStartFuelLevel,
          startHours: initialHours,
          assignNotes: notes || `Zaduženo prihvatanjem radnog naloga ${order.orderNumber}`,
          status: "ZADUZENA",
          createdById: req.user.id,
        },
        include: {
          machine: true,
          worker: true,
          parcel: true,
        },
      }),
      prisma.machine.update({
        where: { id: order.machineId, status: order.machine.status },
        data: {
          status: "ZADUZENA",
          ...measuredFuelData(order.machine, startFuelLiters),
          currentHours: initialHours,
        },
      }),
      prisma.workOrder.update({
        where: { id: order.id, workerId: order.workerId, status: order.status },
        data: { status: "U_TOKU" },
        include: {
          worker: true,
          machine: true,
          attachment: true,
          parcel: true, contractor: true,
          workType: true, materials: materialsInclude,
          machineAssignments: {
            where: { status: "ZADUZENA" },
            take: 1,
          },
        },
      }),
    ]);

    // Evidentiraj u AuditLog
    await prisma.auditLog.create({
      data: {
        entityType: "WorkOrder",
        entityId: order.id,
        action: "IZMENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Radnik prihvatio radni nalog ${order.orderNumber} i zadužio mašinu "${order.machine.name}" sa ${startFuelLiters} L goriva`,
        newValues: {
          orderId: order.id,
          machineId: order.machineId,
          startFuelLiters,
          startHours: initialHours,
          assignmentId: assignment.id,
        },
      },
    });

    res.json({
      message: `Radni nalog ${order.orderNumber} je uspešno prihvaćen, a mašina "${order.machine.name}" je zadužena sa ${startFuelLiters} L goriva.`,
      workOrder: updatedOrder,
      assignment,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (isActiveAssignmentConflict(error)) {
      return res.status(409).json({ error: "Mašina već ima aktivno zaduženje." });
    }
    console.error("Greška pri prihvatanju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
// 3. IZDAVANJE NOVOG RADNOG NALOGA (RUKOVODILAC / DIREKTOR)
// ==========================================
router.post("/", requireManager, machineMutation(async (req, res, prisma) => {
  try {
    const parsed = createWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const workOrder = await createWorkOrderRecord(prisma, req.user, parsed.data);
    res.status(201).json({ workOrder });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("Greška pri kreiranju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
// 4. PROMENA STATUSA / IZMENA NALOGA
// ==========================================
router.patch("/:id/status", machineMutation(async (req, res, prisma) => {
  try {
    const { status } = req.body;
    if (!status || !["PLANIRAN", "DODELJEN", "U_TOKU", "ZAVRSEN", "OTKAZAN"].includes(status)) {
      return res.status(400).json({ error: "Neispravan status naloga." });
    }

    const order = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    if (!canAccessWorkerRecord(req, order)) {
      return res.status(403).json({ error: "Nemate dozvolu za pristup ovom radnom nalogu." });
    }

    // Samo rukovodilac/direktor može otkazati ili ponovo aktivirati nalog
    if (order.orderType === "PAKOVANJE" && (order.status === "ZAVRSEN" || order.packingPlan?.cancelledAfterReversal)) {
      return res.status(409).json({ error: "Za završen nalog poništite potvrdu u magacinu. Za otkazan storno nalog izdajte novi nalog." });
    }
    {
      const operation = status === "OTKAZAN" ? "cancel" : order.status === "OTKAZAN" ? "reactivate" : "generic";
      assertOrderTransition(order, status, operation);
      if (await prisma.machineAssignment.findFirst({ where: { workOrderId: order.id, status: "ZADUZENA" } })) {
        return res.status(409).json({ error: "Prvo evidentirajte stvarno obavljeni rad i razdužite sve mašine. Otkazivanje ne sme preskočiti razduženje." });
      }
      if (operation === "reactivate" && await prisma.machineAssignment.findFirst({ where: { workOrderId: order.id, voidedAt: null } })) {
        return res.status(409).json({ error: "Nalog već ima evidentirano korišćenje. Za nastavak izdajte novi nalog." });
      }
    }
    if (
      (status === "OTKAZAN" || order.status === "OTKAZAN") &&
      !["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "Samo rukovodilac ili direktor može otkazati ili ponovo aktivirati nalog." });
    }

    let machineStateChanged = Boolean(order.maintenanceId);
    if (order.orderType === "REMONT_SERVIS" &&
        (status === "ZAVRSEN" || (order.status === "ZAVRSEN" && status !== "OTKAZAN"))) {
      return res.status(409).json({ error: "Završetak i ponovno otvaranje popravke obavite u radionici." });
    }

    // Ako se nalog otkazuje:
    if (status === "OTKAZAN") {
      // Active assignments are rejected above; workshop cancellation preserves its own workflow.
      if (order.maintenanceId) {
        await prisma.maintenanceIssue.update({
          where: { id: order.maintenanceId },
          data: { status: "OTKAZAN" },
        });
        if (order.machineId) {
          await prisma.machine.update({
            where: { id: order.machineId },
            data: { status: "SLOBODNA" },
          });
        }
      }
    }

    // Ako se nalog ponovo aktivira iz statusa OTKAZAN:
    if (order.status === "OTKAZAN" && status !== "OTKAZAN") {
      if (order.maintenanceId) {
        await prisma.maintenanceIssue.update({
          where: { id: order.maintenanceId },
          data: { status: "OTVOREN" },
        });
        if (order.machineId) {
          await prisma.machine.update({
            where: { id: order.machineId },
            data: { status: "SERVIS" },
          });
        }
      }
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id, workerId: order.workerId, status: order.status },
      data: { status },
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true, contractor: true,
        workType: true, materials: materialsInclude,
      },
    });

    // Zapiši u revizorski trag (AuditLog)
    await prisma.auditLog.create({
      data: {
        entityType: "WorkOrder",
        entityId: order.id,
        action: status === "OTKAZAN" ? "STORNO" : "IZMENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description:
          status === "OTKAZAN"
            ? `Otkazan radni nalog ${order.orderNumber}`
            : order.status === "OTKAZAN"
            ? `Ponovo aktiviran radni nalog ${order.orderNumber} (prebačen u status ${status})`
            : `Promenjen status radnog naloga ${order.orderNumber} sa ${order.status} na ${status}`,
        oldValues: { status: order.status },
        newValues: { status },
      },
    });

    if (order.status === "OTKAZAN" && status !== "OTKAZAN") {
      await enqueueWorkOrderPush(prisma, updated);
    }

    if (machineStateChanged) await syncMachineStatus(prisma, order.machineId);
    res.json({ workOrder: updated });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("Greška pri izmeni statusa naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
// Completion of non-field tasks still has an explicit operation and audit.
router.post("/:id/complete", machineMutation(async (req, res, db) => {
  try {
    const data = z.object({ notes: z.string().trim().min(3).max(1000), workHours: z.number().finite().nonnegative() }).parse(req.body);
    const order = await db.workOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "Nalog nije pronađen." });
    if (!canAccessWorkerRecord(req, order)) return res.status(403).json({ error: "Nemate pristup nalogu." });
    if (order.orderType !== "OSTALO") return res.status(409).json({ error: "Rad na njivi završite unosom rada, a servis u radionici." });
    assertOrderTransition(order, "ZAVRSEN", "complete");
    if (await db.machineAssignment.findFirst({ where: { workOrderId: order.id, status: "ZADUZENA" } })) {
      return res.status(409).json({ error: "Prvo razdužite korišćene mašine, pa završite ovaj nalog." });
    }
    const workOrder = await db.workOrder.update({ where: { id: order.id, status: order.status }, data: { status: "ZAVRSEN" } });
    await db.auditLog.create({ data: { entityType: "WorkOrder", entityId: order.id, action: "IZMENA", userId: req.user.id,
      userName: req.user.name, userRole: req.user.role, description: `Završen nalog: ${data.notes}`,
      oldValues: { status: order.status }, newValues: { status: "ZAVRSEN", workerId: order.workerId, workHours: data.workHours, completionNotes: data.notes } } });
    return res.json({ workOrder });
  } catch (e) { return res.status(e instanceof z.ZodError ? 400 : e.status || 500).json({ error: e.status ? e.message : "Proverite podatke o završetku naloga." }); }
}));

// 4.1 KOMPLETNA IZMENA RADNOG NALOGA (RUKOVODILAC / DIREKTOR)
// ==========================================
const updateWorkOrderSchema = createWorkOrderSchema.partial().extend({
  status: orderStatusEnum.optional(),
});

router.put("/:id", requireManager, machineMutation(async (req, res, prisma) => {
  try {
    const { id } = req.params;
    const parsed = updateWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }
    // Zod defaults from the create schema must not turn an omitted edit field into a write.
    parsed.data = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => Object.hasOwn(req.body, key)));

    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true, contractor: true,
        workType: true, materials: materialsInclude,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    // Za direktore i rukovodioce uvek su dozvoljene izmene svih radnih naloga (uključujući i završene naloge od ranije)
    const history = existing.fieldWorkId || await prisma.machineAssignment.findFirst({ where: { workOrderId: id } });
    assertGenericOrderEdit(existing, parsed.data, Boolean(history));

    if ((existing.orderType === "REMONT_SERVIS" || parsed.data.orderType === "REMONT_SERVIS") &&
        ((parsed.data.status !== undefined && parsed.data.status !== existing.status) ||
         (parsed.data.machineId !== undefined && parsed.data.machineId !== existing.machineId) ||
         (parsed.data.orderType !== undefined && parsed.data.orderType !== existing.orderType))) {
      return res.status(409).json({ error: "Status servisa menjajte u radionici. Za drugu mašinu ili vrstu rada kreirajte novi nalog." });
    }

    for (const field of ["machineId", "attachmentId"]) {
      if (parsed.data[field] && parsed.data[field] !== existing[field]) {
        const selected = await prisma.machine.findUnique({ where: { id: parsed.data[field] } });
        if (selected?.isActive === false) return res.status(409).json({ error: "Ne možete izabrati arhiviranu mašinu ili priključak." });
      }
    }
    const dataToUpdate = {};
    let expectedOrderUpdatedAt;
    if (existing.orderType === "PAKOVANJE" || parsed.data.orderType === "PAKOVANJE") {
      if ((parsed.data.orderType && parsed.data.orderType !== existing.orderType) || !["PLANIRAN", "DODELJEN"].includes(existing.status)) {
        return res.status(409).json({ error: "Možete izmeniti samo otvoren nalog za pakovanje i zadržati njegov tip." });
      }
      const rawOrderUpdatedAt = req.body.orderUpdatedAt ?? req.body.updatedAt;
      const hasValidOrderUpdatedAt =
        (typeof rawOrderUpdatedAt === "string" && z.iso.datetime().safeParse(rawOrderUpdatedAt).success) ||
        (rawOrderUpdatedAt instanceof Date && !Number.isNaN(rawOrderUpdatedAt.getTime()));
      expectedOrderUpdatedAt = hasValidOrderUpdatedAt ? new Date(rawOrderUpdatedAt) : null;
      const currentOrderUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : NaN;
      if (!expectedOrderUpdatedAt || expectedOrderUpdatedAt.getTime() !== currentOrderUpdatedAt) {
        return res.status(409).json({
          error: "Plan pakovanja je u međuvremenu izmenjen. Učitajte aktuelni plan i pokušajte ponovo.",
          workOrder: existing,
        });
      }
      if (parsed.data.workerId !== undefined) {
        requirePackingWorker(await prisma.worker.findUnique({
          where: { id: parsed.data.workerId },
          include: { user: { select: { role: true, isActive: true } } },
        }));
      }
      if (parsed.data.packingPlan) {
        await validatePackingOrder(prisma, parsed.data);
        dataToUpdate.packingPlan = parsed.data.packingPlan;
        parsed.data.orderDate = parsed.data.packingPlan.packagingForm.date;
      }
      dataToUpdate.updatedAt = new Date(Math.max(Date.now(), expectedOrderUpdatedAt.getTime() + 1));
    }
    if ((parsed.data.orderType ?? existing.orderType) !== "RAD_NJIVA") dataToUpdate.contractorId = null;
    else if (parsed.data.contractorId !== undefined) {
      await validateContractor(prisma, parsed.data.contractorId);
      dataToUpdate.contractorId = parsed.data.contractorId;
    }
    const targetType = parsed.data.orderType ?? existing.orderType;
    const workTypeChanged = parsed.data.workTypeId !== undefined && parsed.data.workTypeId !== existing.workTypeId;
    if (parsed.data.materials !== undefined || workTypeChanged || (parsed.data.orderType !== undefined && targetType !== existing.orderType)) {
      const submitted = parsed.data.materials ?? (workTypeChanged || targetType !== "RAD_NJIVA" ? [] : existing.materials ?? []);
      const rows = await prepareMaterials(prisma, targetType === "RAD_NJIVA" ? parsed.data.workTypeId ?? existing.workTypeId : null,
        submitted, existing.materials ?? []);
      dataToUpdate.materials = { deleteMany: {}, ...(rows.length && { createMany: { data: rows } }) };
    }
    if (parsed.data.orderDate !== undefined) dataToUpdate.orderDate = new Date(parsed.data.orderDate);
    if (parsed.data.orderType !== undefined) dataToUpdate.orderType = parsed.data.orderType;
    if (parsed.data.priority !== undefined) dataToUpdate.priority = parsed.data.priority;
    if (parsed.data.workerId !== undefined) dataToUpdate.workerId = parsed.data.workerId;
    if (parsed.data.machineId !== undefined) dataToUpdate.machineId = parsed.data.machineId || null;
    if (parsed.data.attachmentId !== undefined) dataToUpdate.attachmentId = parsed.data.attachmentId || null;
    if (parsed.data.parcelId !== undefined) dataToUpdate.parcelId = parsed.data.parcelId || null;
    if (parsed.data.workTypeId !== undefined) dataToUpdate.workTypeId = parsed.data.workTypeId || null;
    if (parsed.data.plannedAreaHa !== undefined) dataToUpdate.plannedAreaHa = parsed.data.plannedAreaHa || null;
    if (parsed.data.shift !== undefined) dataToUpdate.shift = parsed.data.shift;
    if (parsed.data.instructions !== undefined) dataToUpdate.instructions = parsed.data.instructions || null;
    if (parsed.data.photoUrl !== undefined) dataToUpdate.photoUrl = parsed.data.photoUrl;
    if (parsed.data.status !== undefined) dataToUpdate.status = parsed.data.status;

    if (existing.orderType === "REMONT_SERVIS" && existing.maintenanceId) {
      const issueUpdate = {};
      if (parsed.data.serviceType) issueUpdate.serviceType = parsed.data.serviceType;
      if (parsed.data.priority !== undefined) {
        issueUpdate.priority = REMONT_PRIORITY_MAP[parsed.data.priority] || "VISOKA";
      }
      if (parsed.data.instructions !== undefined) {
        const instr = parsed.data.instructions || "";
        issueUpdate.title = `Radni nalog ${existing.orderNumber}: ${instr ? instr.slice(0, 50) : "Servis mašine"}`;
        issueUpdate.description = instr || "Planski remont i servis mehanizacije.";
      }
      if (parsed.data.workerId !== undefined) issueUpdate.mechanicId = parsed.data.workerId;
      if (parsed.data.photoUrl !== undefined) issueUpdate.photoUrl = parsed.data.photoUrl;
      if (Object.keys(issueUpdate).length > 0) {
        await prisma.maintenanceIssue.update({
          where: { id: existing.maintenanceId },
          data: issueUpdate,
        });
        if (issueUpdate.serviceType !== undefined && existing.machineId) {
          await syncMachineStatus(prisma, existing.machineId);
        }
      }
    }

    const updated = await prisma.workOrder.update({
      where: { id, ...(existing.orderType === "PAKOVANJE" && { updatedAt: expectedOrderUpdatedAt }) },
      data: dataToUpdate,
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true, contractor: true,
        workType: true, materials: materialsInclude,
        maintenance: orderRelationSelect.maintenance,
        machineAssignments: {
          where: { status: "ZADUZENA" },
          orderBy: { assignedAt: "desc" },
          take: 1,
        },
      },
    });

    // Zapiši u AuditLog
    await prisma.auditLog.create({
      data: {
        entityType: "WorkOrder",
        entityId: id,
        action: "IZMENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Izmenjen radni nalog ${existing.orderNumber}`,
        oldValues: existing,
        newValues: updated,
      },
    });

    if (
      updated.workerId !== existing.workerId ||
      (existing.status === "OTKAZAN" && updated.status !== "OTKAZAN")
    ) {
      await enqueueWorkOrderPush(prisma, updated);
    }

    res.json({ workOrder: updated });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(409).json({ error: "Plan pakovanja je u međuvremenu izmenjen. Učitajte aktuelni plan i pokušajte ponovo." });
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("Greška pri izmeni radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
// 5. BRISANJE RADNOG NALOGA (DIREKTOR / RUKOVODILAC)
// ==========================================
router.delete("/:id", requireManager, machineMutation(async (req, res, prisma) => {
  try {
    const existing = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: {
        worker: true,
        machine: true,
        maintenance: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    // 1. Ako postoji povezivanje sa zaduženjem mašine, razdužujemo/otkačinjemo nalog
    if (existing.orderType === "PAKOVANJE" && (existing.status === "ZAVRSEN" || existing.packingPlan?.cancelledAfterReversal)) {
      return res.status(409).json({ error: "Nalog sa istorijom knjiženja ne može se obrisati. Za završeni nalog koristite Poništi potvrdu u magacinu." });
    }
    if (existing.fieldWorkId || await prisma.machineAssignment.findFirst({ where: { workOrderId: existing.id } })) {
      return res.status(409).json({ error: "Nalog sa istorijom rada ili zaduženja ne može se trajno obrisati. Koristite otkazivanje ili korekciju." });
    }
    if (existing.maintenance?.status === "POPRAVLJENO") {
      return res.status(409).json({ error: "Nalog sa završenom popravkom u servisnoj knjižici ne može se trajno obrisati." });
    }
    await prisma.machineAssignment.updateMany({
      where: { workOrderId: existing.id },
      data: { workOrderId: null },
    });

    // 2. Trajno brisanje naloga (i povezanog nezavršenog servisnog zapisa ako postoji)
    await prisma.workOrder.delete({
      where: { id: req.params.id, ...(existing.orderType === "PAKOVANJE" && { updatedAt: existing.updatedAt }) },
    });

    if (existing.maintenanceId) {
      await prisma.maintenanceIssue.delete({
        where: { id: existing.maintenanceId },
      });
    }

    if (existing.machineId && (existing.orderType === "REMONT_SERVIS" || existing.maintenanceId)) {
      await syncMachineStatus(prisma, existing.machineId);
    }

    // 3. Upis u revizorski trag (AuditLog)
    await prisma.auditLog.create({
      data: {
        entityType: "WorkOrder",
        entityId: req.params.id,
        action: "BRISANJE",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Trajno obrisan radni nalog ${existing.orderNumber} (Status: ${existing.status})`,
        oldValues: existing,
      },
    });

    res.json({ message: "Radni nalog uspešno obrisan." });
  } catch (error) {
    console.error("Greška pri brisanju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru pri brisanju radnog naloga." });
  }
}));

export default router;

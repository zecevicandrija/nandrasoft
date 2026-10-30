import { machineMutation, hasOpenMaintenance, syncMachineStatus } from "../lib/machineAvailability.js";
import { requireWorkerIdentity, resolveWorkerForUser, canAccessWorkerRecord } from "../lib/workerIdentity.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";
import { sendWorkOrderPushNotification } from "../lib/pushNotification.js";
import { isActiveAssignmentConflict } from "../lib/assignmentConflict.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);
router.use(requireWorkerIdentity);

const orderTypeEnum = z.enum(["RAD_NJIVA", "REMONT_SERVIS", "OSTALO"]);
const orderStatusEnum = z.enum(["PLANIRAN", "DODELJEN", "U_TOKU", "ZAVRSEN", "OTKAZAN"]);
const shiftTypeEnum = z.enum(["PRVA", "DRUGA", "TRECA"]);

const createWorkOrderSchema = z.object({
  orderDate: z.string().or(z.date()),
  orderType: orderTypeEnum.default("RAD_NJIVA"),
  priority: z.string().default("NORMALNO"),
  workerId: z.string().min(1, "Radnik je obavezan"),
  machineId: z.string().optional().nullable(),
  attachmentId: z.string().optional().nullable(),
  parcelId: z.string().optional().nullable(),
  workTypeId: z.string().optional().nullable(),
  plannedAreaHa: z.number().positive("Površina mora biti pozitivna").optional().nullable(),
  shift: shiftTypeEnum.default("PRVA"),
  instructions: z.string().max(500).optional().nullable(),
});

/**
 * Pomoćna funkcija za generisanje sledećeg broja radnog naloga (npr. RN-2026-0001)
 */
async function generateOrderNumber(prisma) {
  const currentYear = new Date().getFullYear();
  const prefix = `RN-${currentYear}-`;
  
  const lastOrder = await prisma.workOrder.findFirst({
    where: {
      orderNumber: { startsWith: prefix },
    },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  let nextSeq = 1;
  if (lastOrder && lastOrder.orderNumber) {
    const parts = lastOrder.orderNumber.split("-");
    const lastNum = parseInt(parts[2], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

// ==========================================
// 1. DANAŠNJI NALOG ZA ULOGOVANOG RADNIKA
// ==========================================
// Koristi se za mobilni popup / banner radniku kada otvori aplikaciju
router.get("/my-today", async (req, res) => {
  try {
    // Identity comes exclusively from the unique userId foreign key.
    const linkedWorker = req.worker || await resolveWorkerForUser(req.user);
    if (!linkedWorker) return res.status(403).json({ error: "Nalog nije povezan sa aktivnim profilom radnika." });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const orderInclude = {
      machine: true,
      attachment: true,
      parcel: true,
      workType: true,
      machineAssignments: {
        where: { status: "ZADUZENA" },
        orderBy: { assignedAt: "desc" },
        take: 1,
      },
      issuedBy: {
        select: { id: true, name: true, role: true },
      },
    };

    // Prvo potraži aktivan nalog za današnji dan
    let todayOrder = await prisma.workOrder.findFirst({
      where: {
        workerId: linkedWorker.id,
        orderDate: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] },
      },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    });

    // Ako nema naloga tačno za današnji datum, vrati najnoviji aktivan dodeljen nalog (npr. za sutra)
    if (!todayOrder) {
      todayOrder = await prisma.workOrder.findFirst({
        where: {
          workerId: linkedWorker.id,
          status: { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] },
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
        where.status = { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] };
      } else {
        where.status = String(status);
      }
    }

    // Ako je korisnik OPERATER ili MEHANICAR, vidi samo svoje radne naloge!
    if (!["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
      const linkedWorker = await resolveWorkerForUser(req.user);
      if (linkedWorker) {
        where.workerId = linkedWorker.id;
      } else {
        return res.json({ workOrders: [] });
      }

      // Za operatere: ako nije prosleđen nikakav status, podrazumevano prikazujemo samo aktivne naloge
      if (!status) {
        where.status = { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] };
      }
    } else {
      if (workerId) where.workerId = String(workerId);
    }

    if (machineId) where.machineId = String(machineId);
    if (parcelId) where.parcelId = String(parcelId);
    if (type) where.orderType = String(type);


    if (date) {
      const d = new Date(date);
      const startOfDay = new Date(d.setHours(0, 0, 0, 0));
      const endOfDay = new Date(d.setHours(23, 59, 59, 999));
      where.orderDate = { gte: startOfDay, lte: endOfDay };
    }

    // Paginacija (podrazumevano 25 po stranici)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    // Za KPI statistiku koristimo iste filtere (datum, mašina, radnik, parcela, tip) osim statusa
    const statsWhere = { ...where };
    delete statsWhere.status;

    const [
      total,
      totalOrdersCount,
      pendingOrdersCount,
      inProgressOrdersCount,
      completedOrdersCount,
      workOrders,
    ] = await Promise.all([
      prisma.workOrder.count({ where }),
      prisma.workOrder.count({ where: statsWhere }),
      prisma.workOrder.count({
        where: { ...statsWhere, status: { in: ["PLANIRAN", "DODELJEN"] } },
      }),
      prisma.workOrder.count({
        where: { ...statsWhere, status: "U_TOKU" },
      }),
      prisma.workOrder.count({
        where: { ...statsWhere, status: "ZAVRSEN" },
      }),
      prisma.workOrder.findMany({
        where,
        include: {
          worker: true,
          machine: true,
          attachment: true,
          parcel: true,
          workType: true,
          machineAssignments: {
            orderBy: { assignedAt: "desc" },
            take: 1,
          },
          fieldWork: {
            select: { id: true, areaDoneHa: true, workHours: true, status: true },
          },
          issuedBy: {
            select: { id: true, name: true, role: true },
          },
        },
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      workOrders,
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
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true,
        workType: true,
        machineAssignments: {
          orderBy: { assignedAt: "desc" },
          take: 1,
        },
        fieldWork: true,
        issuedBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    if (!canAccessWorkerRecord(req, order)) {
      return res.status(403).json({ error: "Nemate dozvolu za pristup ovom radnom nalogu." });
    }

    res.json({ workOrder: order });
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

    const { startFuelLiters, startHours, notes } = parsed.data;

    // Workshop acceptance never creates an operator checkout or changes fuel/hours.
    if (order.orderType === "REMONT_SERVIS") {
      if (!order.machineId || !order.maintenanceId) {
        return res.status(409).json({ error: "Servisni nalog nema povezanu mašinu i zapis servisa. Otvorite nalog u radionici." });
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
        include: { worker: true, parcel: true, workType: true },
      });
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
          currentFuelLiters: startFuelLiters,
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
          parcel: true,
          workType: true,
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

    const orderNumber = await generateOrderNumber(prisma);

    let maintenanceId = null;
    if (parsed.data.orderType === "REMONT_SERVIS" && parsed.data.machineId) {
      const priorityMap = {
        KRITICNO: "KRITICNA",
        HITNO: "VISOKA",
        NORMALNO: "SREDNJA",
      };
      const issuePriority = priorityMap[parsed.data.priority] || "VISOKA";

      const issue = await prisma.maintenanceIssue.create({
        data: {
          machineId: parsed.data.machineId,
          serviceType: "REDOVAN_SERVIS",
          priority: issuePriority,
          status: "OTVOREN",
          reportedById: parsed.data.workerId,
          mechanicId: parsed.data.workerId,
          title: `Radni nalog ${orderNumber}: ${
            parsed.data.instructions ? parsed.data.instructions.slice(0, 50) : "Servis mašine"
          }`,
          description: parsed.data.instructions || "Planski remont i servis mehanizacije.",
          isMachineStopped: true,
          createdById: req.user.id,
        },
      });
      maintenanceId = issue.id;

      await prisma.machine.update({
        where: { id: parsed.data.machineId },
        data: { status: "SERVIS" },
      });
    }

    const workOrder = await prisma.workOrder.create({
      data: {
        orderNumber,
        orderDate: new Date(parsed.data.orderDate),
        orderType: parsed.data.orderType,
        priority: parsed.data.priority,
        workerId: parsed.data.workerId,
        machineId: parsed.data.machineId || null,
        attachmentId: parsed.data.attachmentId || null,
        parcelId: parsed.data.parcelId || null,
        workTypeId: parsed.data.workTypeId || null,
        plannedAreaHa: parsed.data.plannedAreaHa || null,
        shift: parsed.data.shift,
        instructions: parsed.data.instructions || null,
        status: "DODELJEN", // automatski dodeljen radniku
        maintenanceId,
        issuedById: req.user.id,
      },
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true,
        workType: true,
      },
    });

    // Zapiši u AuditLog
    await prisma.auditLog.create({
      data: {
        entityType: "WorkOrder",
        entityId: workOrder.id,
        action: "KREIRANJE",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Izdat radni nalog ${workOrder.orderNumber} za radnika ${workOrder.worker.name}`,
        newValues: workOrder,
      },
    });

    // Pošalji Web Push notifikaciju radniku na telefon/uređaj
    prisma.$afterCommit(() => sendWorkOrderPushNotification(workOrder.workerId, workOrder));

    res.status(201).json({ workOrder });
  } catch (error) {
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
      // 1. Ako postoji aktivno zaduženje mašine za ovaj nalog, automatski ga razdužujemo i oslobađamo mašinu
      const activeAssignment = await prisma.machineAssignment.findFirst({
        where: { workOrderId: order.id, status: "ZADUZENA" },
      });
      if (activeAssignment) {
        machineStateChanged = true;
        await prisma.machineAssignment.update({
          where: { id: activeAssignment.id },
          data: {
            status: "RAZDUZENA",
            returnedAt: new Date(),
            returnNotes: "Nalog otkazan od strane rukovodioca.",
          },
        });
        if (order.machineId) {
          await prisma.machine.update({
            where: { id: order.machineId },
            data: { status: "SLOBODNA" },
          });
        }
      }

      // 2. Ako je vezano za servis mehanizacije, otkazujemo i maintenance zapis i oslobađamo mašinu
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

    if (order.orderType === "REMONT_SERVIS" && order.maintenanceId && status === "U_TOKU") {
      await prisma.maintenanceIssue.update({ where: { id: order.maintenanceId }, data: { status: "U_RADU" } });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id, workerId: order.workerId, status: order.status },
      data: { status },
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true,
        workType: true,
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
      prisma.$afterCommit(() => sendWorkOrderPushNotification(updated.workerId, updated));
    }

    if (machineStateChanged) await syncMachineStatus(prisma, order.machineId);
    res.json({ workOrder: updated });
  } catch (error) {
    console.error("Greška pri izmeni statusa naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
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

    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true,
        workType: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    // Za direktore i rukovodioce uvek su dozvoljene izmene svih radnih naloga (uključujući i završene naloge od ranije)

    if ((existing.orderType === "REMONT_SERVIS" || parsed.data.orderType === "REMONT_SERVIS") &&
        ((parsed.data.status !== undefined && parsed.data.status !== existing.status) ||
         (parsed.data.machineId !== undefined && parsed.data.machineId !== existing.machineId) ||
         (parsed.data.orderType !== undefined && parsed.data.orderType !== existing.orderType))) {
      return res.status(409).json({ error: "Status servisa menjajte u radionici. Za drugu mašinu ili vrstu rada kreirajte novi nalog." });
    }

    const dataToUpdate = {};
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
    if (parsed.data.status !== undefined) dataToUpdate.status = parsed.data.status;

    const updated = await prisma.workOrder.update({
      where: { id },
      data: dataToUpdate,
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true,
        workType: true,
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
      prisma.$afterCommit(() => sendWorkOrderPushNotification(updated.workerId, updated));
    }

    res.json({ workOrder: updated });
  } catch (error) {
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
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Radni nalog nije pronađen." });
    }

    // 1. Ako postoji povezivanje sa zaduženjem mašine, razdužujemo/otkačinjemo nalog
    await prisma.machineAssignment.updateMany({
      where: { workOrderId: existing.id },
      data: { workOrderId: null },
    });

    // 2. Trajno brisanje naloga
    await prisma.workOrder.delete({
      where: { id: req.params.id },
    });

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

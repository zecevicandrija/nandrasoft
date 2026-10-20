import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

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
async function generateOrderNumber() {
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
    const userId = req.user.id;

    // Pronađi radnika povezanog sa ovim nalogom
    const linkedWorker = await prisma.worker.findFirst({
      where: { userId },
      select: { id: true, name: true },
    });

    if (!linkedWorker) {
      return res.json({ todayOrder: null });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayOrder = await prisma.workOrder.findFirst({
      where: {
        workerId: linkedWorker.id,
        orderDate: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] },
      },
      include: {
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
      },
      orderBy: { createdAt: "desc" },
    });

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
    if (["OPERATER", "MEHANICAR"].includes(req.user.role)) {
      const linkedWorker = await prisma.worker.findFirst({
        where: { userId: req.user.id },
        select: { id: true },
      });
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

    const workOrders = await prisma.workOrder.findMany({
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
    });

    res.json({ workOrders });
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
  startFuelLiters: z.number().nonnegative("Početno gorivo ne može biti negativno"),
  startHours: z.number().nonnegative("Radni sati ne mogu biti negativni").optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

router.post("/:id/accept", async (req, res) => {
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

    if (order.status === "ZAVRSEN" || order.status === "OTKAZAN") {
      return res.status(400).json({ error: `Nalog je već u statusu ${order.status}.` });
    }

    const { startFuelLiters, startHours, notes } = parsed.data;

    // Ako nalog nema pridruženu mašinu (npr. ručni magacinski rad)
    if (!order.machineId) {
      const updated = await prisma.workOrder.update({
        where: { id: order.id },
        data: { status: "U_TOKU" },
        include: { worker: true, parcel: true, workType: true },
      });
      return res.json({
        message: `Radni nalog ${order.orderNumber} je prihvaćen i stavljen u rad.`,
        workOrder: updated,
      });
    }

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
        where: { id: order.machineId },
        data: {
          status: "ZADUZENA",
          currentFuelLiters: startFuelLiters,
          currentHours: initialHours,
        },
      }),
      prisma.workOrder.update({
        where: { id: order.id },
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
    console.error("Greška pri prihvatanju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 3. IZDAVANJE NOVOG RADNOG NALOGA (RUKOVODILAC / DIREKTOR)
// ==========================================
router.post("/", requireManager, async (req, res) => {
  try {
    const parsed = createWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const orderNumber = await generateOrderNumber();

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

    res.status(201).json({ workOrder });
  } catch (error) {
    console.error("Greška pri kreiranju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 4. PROMENA STATUSA / IZMENA NALOGA
// ==========================================
router.patch("/:id/status", async (req, res) => {
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

    // Samo rukovodilac/direktor može otkazati, a radnik može označiti U_TOKU
    if (status === "OTKAZAN" && !["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
      return res.status(403).json({ error: "Samo rukovodilac može otkazati nalog." });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        worker: true,
        machine: true,
        attachment: true,
        parcel: true,
        workType: true,
      },
    });

    res.json({ workOrder: updated });
  } catch (error) {
    console.error("Greška pri izmeni statusa naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 4.1 KOMPLETNA IZMENA RADNOG NALOGA (RUKOVODILAC / DIREKTOR)
// ==========================================
const updateWorkOrderSchema = createWorkOrderSchema.partial().extend({
  status: orderStatusEnum.optional(),
});

router.put("/:id", requireManager, async (req, res) => {
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

    // Provera za ZAVRŠENE naloge:
    // Ako je nalog već završen, rukovodilac ga može izmeniti samo do kraja tog dana (do 23:59:59)
    if (existing.status === "ZAVRSEN") {
      const now = new Date();
      const completionDate = new Date(existing.updatedAt);
      const isSameDay =
        now.getFullYear() === completionDate.getFullYear() &&
        now.getMonth() === completionDate.getMonth() &&
        now.getDate() === completionDate.getDate();

      if (!isSameDay) {
        return res.status(403).json({
          error: "Završeni radni nalog možete menjati samo do kraja istog dana (do 23:59h). Nakon toga je zaključan.",
        });
      }
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

    res.json({ workOrder: updated });
  } catch (error) {
    console.error("Greška pri izmeni radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 5. BRISANJE / OTKAZIVANJE NALOGA
// ==========================================
router.delete("/:id", requireManager, async (req, res) => {
  try {
    await prisma.workOrder.delete({
      where: { id: req.params.id },
    });
    res.json({ message: "Radni nalog uspešno obrisan." });
  } catch (error) {
    console.error("Greška pri brisanju radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

export default router;

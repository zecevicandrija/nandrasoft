import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

// ==========================================
// 1. STATISTIKA ZADUŽIVANJA
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const [activeAssignments, freeMachines, brokenMachines, totalToday] = await Promise.all([
      prisma.machineAssignment.count({
        where: { status: "ZADUZENA" },
      }),
      prisma.machine.count({
        where: { status: "SLOBODNA", isActive: true },
      }),
      prisma.machine.count({
        where: { status: "U_KVARU", isActive: true },
      }),
      prisma.machineAssignment.count({
        where: {
          assignedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    res.json({
      activeAssignments,
      freeMachines,
      brokenMachines,
      totalToday,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju statistike zaduživanja:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2. AKTIVNA ZADUŽENJA (CHECKOUTS U TOKU)
// ==========================================
router.get("/active", async (req, res) => {
  try {
    const active = await prisma.machineAssignment.findMany({
      where: { status: "ZADUZENA" },
      include: {
        machine: true,
        worker: true,
        parcel: true,
        createdBy: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { assignedAt: "desc" },
    });

    res.json({ assignments: active });
  } catch (error) {
    console.error("Greška pri dohvatanju aktivnih zaduženja:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 3. SVA ZADUŽENJA SA FILTERIMA (ISTORIJAT)
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { machineId, workerId, parcelId, status, dateFrom, dateTo, limit = 50, page = 1 } = req.query;

    const where = {};
    if (machineId) where.machineId = String(machineId);
    if (workerId) where.workerId = String(workerId);
    if (parcelId) where.parcelId = String(parcelId);
    if (status) where.status = String(status);

    if (dateFrom || dateTo) {
      where.assignedAt = {};
      if (dateFrom) where.assignedAt.gte = new Date(String(dateFrom));
      if (dateTo) {
        const end = new Date(String(dateTo));
        end.setHours(23, 59, 59, 999);
        where.assignedAt.lte = end;
      }
    }

    const take = Math.min(Number(limit) || 50, 100);
    const skip = ((Number(page) || 1) - 1) * take;

    const [total, assignments] = await Promise.all([
      prisma.machineAssignment.count({ where }),
      prisma.machineAssignment.findMany({
        where,
        include: {
          machine: true,
          worker: true,
          parcel: true,
          createdBy: {
            select: { id: true, name: true, role: true },
          },
        },
        orderBy: { assignedAt: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: Number(page) || 1,
      totalPages: Math.ceil(total / take),
      assignments,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju zaduženja:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 4. NOVO ZADUŽENJE (CHECKOUT)
// ==========================================
const checkoutSchema = z.object({
  machineId: z.string().min(1, "Mašina je obavezna"),
  workerId: z.string().min(1, "Radnik je obavezan"),
  parcelId: z.string().optional().nullable(),
  startFuelLevel: z.number().min(0).max(100).optional().nullable(),
  startHours: z.number().nonnegative("Početni radni sati ne mogu biti negativni").optional().nullable(),
  assignNotes: z.string().max(500).optional().nullable(),
});

router.post("/checkout", async (req, res) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const { machineId, workerId, parcelId, startFuelLevel, startHours, assignNotes } = parsed.data;

    // 1. Provera postojanja mašine i concurrency zaštita
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
    });

    if (!machine) {
      return res.status(404).json({ error: "Izabrana mašina ne postoji u sistemu." });
    }

    if (machine.status !== "SLOBODNA") {
      return res.status(409).json({
        error: `Mašina "${machine.name}" trenutno nije slobodna (status: ${machine.status}).`,
      });
    }

    // Dodatna provera da li već postoji otvoreno zaduženje
    const existingActive = await prisma.machineAssignment.findFirst({
      where: {
        machineId,
        status: "ZADUZENA",
      },
    });

    if (existingActive) {
      return res.status(409).json({
        error: `Mašina "${machine.name}" je već aktivno zadužena.`,
      });
    }

    // 2. Početni sati: uzmi unete, ili automatski sa mašine
    const initialHours = startHours !== undefined && startHours !== null ? startHours : machine.currentHours;

    // 3. Atomska Prisma transakcija: kreiraj zaduženje i postavi status mašine na ZADUZENA
    const [assignment] = await prisma.$transaction([
      prisma.machineAssignment.create({
        data: {
          machineId,
          workerId,
          parcelId: parcelId || null,
          startFuelLevel: startFuelLevel !== undefined ? startFuelLevel : null,
          startHours: initialHours,
          assignNotes: assignNotes || null,
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
        where: { id: machineId },
        data: { status: "ZADUZENA" },
      }),
    ]);

    res.status(201).json({
      message: `Mašina "${machine.name}" je uspešno zadužena.`,
      assignment,
    });
  } catch (error) {
    console.error("Greška pri zaduživanju mašine:", error);
    res.status(500).json({ error: "Greška na serveru pri zaduživanju mašine." });
  }
});

// ==========================================
// 5. RAZDUŽIVANJE MAŠINE (CHECKIN)
// ==========================================
const checkinSchema = z.object({
  assignmentId: z.string().min(1, "ID zaduženja je obavezan"),
  endHours: z.number().nonnegative("Krajnji radni sati moraju biti pozitivan broj"),
  endFuelLevel: z.number().min(0).max(100).optional().nullable(),
  isOperational: z.boolean().default(true),
  returnNotes: z.string().max(500).optional().nullable(),
});

router.post("/checkin", async (req, res) => {
  try {
    const parsed = checkinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const { assignmentId, endHours, endFuelLevel, isOperational, returnNotes } = parsed.data;

    const assignment = await prisma.machineAssignment.findUnique({
      where: { id: assignmentId },
      include: { machine: true },
    });

    if (!assignment) {
      return res.status(404).json({ error: "Zaduženje nije pronađeno." });
    }

    if (assignment.status !== "ZADUZENA") {
      return res.status(400).json({ error: "Ovo zaduženje je već zatvoreno." });
    }

    // Validacija da krajnji sati ne mogu biti manji od početnih
    if (endHours < assignment.startHours) {
      return res.status(400).json({
        error: `Krajnji radni sati (${endHours} rh) ne mogu biti manji od početnih (${assignment.startHours} rh).`,
      });
    }

    const newMachineStatus = isOperational ? "SLOBODNA" : "U_KVARU";
    const newAssignmentStatus = isOperational ? "RAZDUZENA" : "VRACENA_SA_KVAROM";

    // Atomska Prisma transakcija:
    // 1. Ažuriraj MachineAssignment (status, returnedAt, endHours, endFuelLevel, isOperational, returnNotes)
    // 2. Ažuriraj Machine (status, currentHours = endHours)
    const [updatedAssignment] = await prisma.$transaction([
      prisma.machineAssignment.update({
        where: { id: assignmentId },
        data: {
          status: newAssignmentStatus,
          returnedAt: new Date(),
          endHours,
          endFuelLevel: endFuelLevel !== undefined ? endFuelLevel : null,
          isOperational,
          returnNotes: returnNotes || null,
        },
        include: {
          machine: true,
          worker: true,
          parcel: true,
        },
      }),
      prisma.machine.update({
        where: { id: assignment.machineId },
        data: {
          status: newMachineStatus,
          currentHours: endHours,
        },
      }),
    ]);

    res.json({
      message: isOperational
        ? `Mašina "${assignment.machine.name}" je uspešno razdužena i vraćena u slobodan status.`
        : `Mašina "${assignment.machine.name}" je razdužena uz prijavu kvara (status: U KVARU).`,
      assignment: updatedAssignment,
    });
  } catch (error) {
    console.error("Greška pri razduživanju mašine:", error);
    res.status(500).json({ error: "Greška na serveru pri razduživanju mašine." });
  }
});

export default router;

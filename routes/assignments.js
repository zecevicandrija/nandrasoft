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

// Pomoćna funkcija za izolaciju podataka operatera (radnika)
async function getOperatorFilter(userId) {
  const linkedWorker = await prisma.worker.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (linkedWorker) {
    return {
      OR: [{ createdById: userId }, { workerId: linkedWorker.id }],
    };
  }
  return { createdById: userId };
}

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

    // Izolacija podataka: Radnici/operateri vide isključivo sopstvena zaduženja
    if (req.user.role === "OPERATER") {
      const opFilter = await getOperatorFilter(req.user.id);
      where.AND = where.AND || [];
      where.AND.push(opFilter);
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
  workerId: z.string().min(1, "Radnik je obavezan").optional().nullable(),
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

    // Automatsko prepoznavanje / vezivanje radnika za operatera
    let finalWorkerId = workerId;
    if (req.user.role === "OPERATER" || !finalWorkerId) {
      let worker = await prisma.worker.findFirst({
        where: { userId: req.user.id },
      });

      if (!worker) {
        worker = await prisma.worker.findFirst({
          where: { name: { equals: req.user.name, mode: "insensitive" } },
        });

        if (worker) {
          await prisma.worker.update({
            where: { id: worker.id },
            data: { userId: req.user.id },
          });
        }
      }

      if (!worker) {
        worker = await prisma.worker.create({
          data: {
            name: req.user.name,
            userId: req.user.id,
            type: "STALNI",
          },
        });
      }

      finalWorkerId = worker.id;
    }

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
          workerId: finalWorkerId,
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

// ==========================================
// 6. DIREKTNO / RETROAKTIVNO ZADUŽENJE I RAZDUŽENJE U JEDNOM KORAKU (DIREKTOR & RUKOVODILAC)
// ==========================================
const directAssignSchema = z.object({
  machineId: z.string().min(1, "Mašina je obavezna"),
  workerId: z.string().min(1, "Radnik je obavezan"),
  parcelId: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  startHours: z.number().nonnegative("Početni radni sati ne mogu biti negativni"),
  endHours: z.number().nonnegative("Krajnji radni sati moraju biti pozitivan broj"),
  startFuelLevel: z.number().min(0).max(100).optional().nullable(),
  endFuelLevel: z.number().min(0).max(100).optional().nullable(),
  isOperational: z.boolean().default(true),
  notes: z.string().max(500).optional().nullable(),
});

router.post("/direct", async (req, res) => {
  try {
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      return res.status(403).json({ error: "Samo direktor i rukovodilac mogu vršiti direktno zaduživanje." });
    }

    const parsed = directAssignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const {
      machineId,
      workerId,
      parcelId,
      date,
      startHours,
      endHours,
      startFuelLevel,
      endFuelLevel,
      isOperational,
      notes,
    } = parsed.data;

    if (endHours < startHours) {
      return res.status(400).json({
        error: `Krajnji radni sati (${endHours} rh) ne mogu biti manji od početnih (${startHours} rh).`,
      });
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
    });

    if (!machine) {
      return res.status(404).json({ error: "Izabrana mašina ne postoji u sistemu." });
    }

    let assignDate = new Date();
    if (date) {
      const parsedDate = new Date(date);
      if (!isNaN(parsedDate.getTime())) {
        assignDate = parsedDate;
      }
    }

    const newAssignmentStatus = isOperational ? "RAZDUZENA" : "VRACENA_SA_KVAROM";
    const newMachineStatus = isOperational ? (machine.status === "ZADUZENA" ? "SLOBODNA" : machine.status) : "U_KVARU";
    const updatedCurrentHours = Math.max(machine.currentHours || 0, endHours);

    const [assignment] = await prisma.$transaction([
      prisma.machineAssignment.create({
        data: {
          machineId,
          workerId,
          parcelId: parcelId || null,
          assignedAt: assignDate,
          returnedAt: assignDate,
          startHours,
          endHours,
          startFuelLevel: startFuelLevel !== undefined ? startFuelLevel : null,
          endFuelLevel: endFuelLevel !== undefined ? endFuelLevel : null,
          isOperational,
          assignNotes: notes || "Direktno evidentirano zaduženje (rešena neusklađenost)",
          returnNotes: notes || null,
          status: newAssignmentStatus,
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
        data: {
          status: newMachineStatus,
          currentHours: updatedCurrentHours,
        },
      }),
    ]);

    // Audit log zapis
    try {
      await prisma.auditLog.create({
        data: {
          entityType: "MachineAssignment",
          entityId: assignment.id,
          action: "DIREKTNO_ZADUZENJE",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Direktno evidentirano i zatvoreno zaduženje za mašinu "${machine.name}" (rešena neusklađenost sa njive).`,
          newValues: {
            machineName: machine.name,
            startHours,
            endHours,
            startFuelLevel,
            endFuelLevel,
            isOperational,
            assignedAt: assignDate,
          },
        },
      });
    } catch (auditErr) {
      console.warn("Audit log greška:", auditErr);
    }

    res.status(201).json({
      message: `Zaduženje i razduženje za mašinu "${machine.name}" je uspešno evidentirano u jednom koraku.`,
      assignment,
    });
  } catch (error) {
    console.error("Greška pri direktnom zaduživanju:", error);
    res.status(500).json({ error: "Greška na serveru pri direktnom zaduživanju." });
  }
});

// ==========================================
// 7. IZMENA ZADUŽENJA (UZ PROVERU PRAVA I AUDIT LOG)
// ==========================================
const updateAssignmentSchema = z.object({
  parcelId: z.string().optional().nullable(),
  startHours: z.number().nonnegative("Početni radni sati ne mogu biti negativni").optional().nullable(),
  endHours: z.number().nonnegative("Krajnji radni sati ne mogu biti negativni").optional().nullable(),
  startFuelLevel: z.number().min(0).max(100).optional().nullable(),
  endFuelLevel: z.number().min(0).max(100).optional().nullable(),
  isOperational: z.boolean().optional(),
  assignNotes: z.string().max(500).optional().nullable(),
  returnNotes: z.string().max(500).optional().nullable(),
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.machineAssignment.findUnique({
      where: { id },
      include: { machine: true, worker: true, parcel: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zaduženje nije pronađeno." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    const isOperator = req.user.role === "OPERATER";

    if (!isManager && !isOperator) {
      return res.status(403).json({ error: "Nemate ovlašćenje za izmenu zaduženja." });
    }

    // Specifična pravila za operatera:
    if (isOperator) {
      const isOwnAssignment =
        existing.createdById === req.user.id ||
        (existing.worker && existing.worker.userId === req.user.id);

      if (!isOwnAssignment) {
        return res.status(403).json({ error: "Možete menjati isključivo sopstvena zaduženja." });
      }

      // Dozvoljeno samo do kraja dana u kojem je zaduženje evidentirano
      const now = new Date();
      const recordDate = new Date(existing.assignedAt);
      const isSameDay =
        now.getFullYear() === recordDate.getFullYear() &&
        now.getMonth() === recordDate.getMonth() &&
        now.getDate() === recordDate.getDate();

      if (!isSameDay) {
        return res.status(403).json({
          error: "Istekao je rok za izmenu. Zaduženje možete izmeniti samo do kraja dana u kojem je zabeleženo.",
        });
      }

      if (req.body.workerId && req.body.workerId !== existing.workerId) {
        return res.status(403).json({ error: "Ne možete menjati dodeljenog radnika." });
      }
    }

    const parsed = updateAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const updateData = { ...parsed.data };

    // Validacija radnih sati
    const targetStartHours =
      updateData.startHours !== undefined && updateData.startHours !== null
        ? updateData.startHours
        : existing.startHours;
    const targetEndHours =
      updateData.endHours !== undefined && updateData.endHours !== null
        ? updateData.endHours
        : existing.endHours;

    if (targetEndHours !== null && targetEndHours !== undefined && targetEndHours < targetStartHours) {
      return res.status(400).json({
        error: `Krajnji radni sati (${targetEndHours} rh) ne mogu biti manji od početnih (${targetStartHours} rh).`,
      });
    }

    // Ažuriranje statusa zaduženja ako je razduženo i menja se ispravnost
    let newStatus = existing.status;
    let newMachineStatus = undefined;

    if (existing.status !== "ZADUZENA" && updateData.isOperational !== undefined) {
      newStatus = updateData.isOperational ? "RAZDUZENA" : "VRACENA_SA_KVAROM";
      newMachineStatus = updateData.isOperational ? "SLOBODNA" : "U_KVARU";
    }

    // Razlike (Diff) za Audit Log
    const changes = [];
    const oldValues = {};
    const newValues = {};

    if (updateData.startHours !== undefined && updateData.startHours !== existing.startHours) {
      changes.push(`Početni sati: ${existing.startHours} rh → ${updateData.startHours} rh`);
      oldValues.startHours = existing.startHours;
      newValues.startHours = updateData.startHours;
    }
    if (updateData.endHours !== undefined && updateData.endHours !== existing.endHours) {
      changes.push(`Krajnji sati: ${existing.endHours || "-"} rh → ${updateData.endHours} rh`);
      oldValues.endHours = existing.endHours;
      newValues.endHours = updateData.endHours;
    }
    if (updateData.startFuelLevel !== undefined && updateData.startFuelLevel !== existing.startFuelLevel) {
      changes.push(`Gorivo polazak: ${existing.startFuelLevel ?? "-"}% → ${updateData.startFuelLevel}%`);
      oldValues.startFuelLevel = existing.startFuelLevel;
      newValues.startFuelLevel = updateData.startFuelLevel;
    }
    if (updateData.endFuelLevel !== undefined && updateData.endFuelLevel !== existing.endFuelLevel) {
      changes.push(`Gorivo povratak: ${existing.endFuelLevel ?? "-"}% → ${updateData.endFuelLevel}%`);
      oldValues.endFuelLevel = existing.endFuelLevel;
      newValues.endFuelLevel = updateData.endFuelLevel;
    }
    if (updateData.isOperational !== undefined && updateData.isOperational !== existing.isOperational) {
      changes.push(`Ispravnost: ${existing.isOperational ? "Ispravna" : "U kvaru"} → ${updateData.isOperational ? "Ispravna" : "U kvaru"}`);
      oldValues.isOperational = existing.isOperational;
      newValues.isOperational = updateData.isOperational;
    }
    if (updateData.parcelId !== undefined && updateData.parcelId !== existing.parcelId) {
      const newP = updateData.parcelId ? await prisma.parcel.findUnique({ where: { id: updateData.parcelId } }) : null;
      changes.push(`Parcela: ${existing.parcel?.name || "Bez parcele"} → ${newP ? newP.name : "Bez parcele"}`);
      oldValues.parcel = existing.parcel?.name || null;
      newValues.parcel = newP ? newP.name : null;
    }
    if (updateData.assignNotes !== undefined && updateData.assignNotes !== existing.assignNotes) {
      changes.push(`Napomena zaduženja izmenjena`);
      oldValues.assignNotes = existing.assignNotes;
      newValues.assignNotes = updateData.assignNotes;
    }
    if (updateData.returnNotes !== undefined && updateData.returnNotes !== existing.returnNotes) {
      changes.push(`Napomena razduženja izmenjena`);
      oldValues.returnNotes = existing.returnNotes;
      newValues.returnNotes = updateData.returnNotes;
    }

    const assignmentUpdatePayload = {
      ...updateData,
      status: newStatus,
    };

    const transactionOps = [
      prisma.machineAssignment.update({
        where: { id },
        data: assignmentUpdatePayload,
        include: {
          machine: true,
          worker: true,
          parcel: true,
        },
      }),
    ];

    // Ako je potrebno ažurirati status ili sate mašine
    const machineUpdateData = {};
    if (newMachineStatus) {
      machineUpdateData.status = newMachineStatus;
    }
    if (targetEndHours !== null && targetEndHours !== undefined) {
      machineUpdateData.currentHours = Math.max(existing.machine.currentHours || 0, targetEndHours);
    }
    if (Object.keys(machineUpdateData).length > 0) {
      transactionOps.push(
        prisma.machine.update({
          where: { id: existing.machineId },
          data: machineUpdateData,
        })
      );
    }

    const [updated] = await prisma.$transaction(transactionOps);

    if (changes.length > 0) {
      try {
        await prisma.auditLog.create({
          data: {
            entityType: "MachineAssignment",
            entityId: existing.id,
            action: "IZMENA",
            userId: req.user.id,
            userName: req.user.name || "Korisnik",
            userRole: req.user.role,
            description: `Izmenjeno zaduženje mašine "${existing.machine.name}": ${changes.join("; ")}`,
            oldValues,
            newValues,
          },
        });
      } catch (logErr) {
        console.warn("Audit log greška pri izmeni zaduženja:", logErr);
      }
    }

    res.json({
      message: "Zaduženje je uspešno ažurirano.",
      assignment: updated,
    });
  } catch (error) {
    console.error("Greška pri ažuriranju zaduženja:", error);
    res.status(500).json({ error: "Greška na serveru pri ažuriranju zaduženja." });
  }
});

export default router;

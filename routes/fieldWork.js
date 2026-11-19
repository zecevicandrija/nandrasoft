import { completeMachineUsage } from "../lib/completeMachineUsage.js";
import { usageInclude } from "../lib/machineUsageService.js";
import { assertCorrectionAccess, statusError } from "../lib/workOrderStatusService.js";
import { materialsSchema, materialsInclude, prepareMaterials, materialText } from "../lib/workMaterials.js";
import { optionalContractorId, validateContractor } from "../lib/contractors.js";
import { reportingQuery, fieldWorkStats, unassignedWorkPage } from "../lib/fieldWorkReporting.js";
import { machineMutation, hasOpenMaintenance } from "../lib/machineAvailability.js";
import { fuelSnapshotError, measuredFuelData } from "../lib/machineFuel.js";
import { requireWorkerIdentity, getRequestWorker, isManager as isManagerUser, canAccessWorkerRecord } from "../lib/workerIdentity.js";
import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);
router.use(requireWorkerIdentity);

/**
 * Pomoćna funkcija za automatsko računanje radnih sati iz startTime i endTime (npr. "07:00" i "15:30")
 */
function calculateWorkHours(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return null;

  let startTotal = startH * 60 + startM;
  let endTotal = endH * 60 + endM;

  // Ukoliko je rad prešao ponoć (npr. noćna smena od 22:00 do 06:00)
  if (endTotal < startTotal) {
    endTotal += 24 * 60;
  }

  const diffMinutes = endTotal - startTotal;
  return Math.round((diffMinutes / 60) * 10) / 10;
}

// Pomoćna funkcija za izolaciju podataka operatera (radnika)
function getOperatorFilter(worker) {
  return { workerId: worker.id };
}

// ==========================================
// 1. STATISTIKA I AGREGACIJE RADOVA NA NJIVI
// ==========================================
router.get("/stats", async (req, res) => {
  const parsed = reportingQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Neispravni datumi ili filteri izveštaja." });
  try {
    return res.json(await fieldWorkStats(
      prisma,
      parsed.data,
      isManagerUser(req.user) ? null : req.worker.id,
      new Date(),
      {
        includeBreakdown: parsed.data.includeBreakdown !== "false",
        includeMissingWarnings: isManagerUser(req.user),
      }
    ));
  } catch (error) {
    console.error("Field-work statistics failed:", error);
    return res.status(500).json({ error: "Statistika nije učitana. Pokušajte ponovo." });
  }
});

router.get("/unassigned-warnings", async (req, res) => {
  if (!isManagerUser(req.user)) return res.status(403).json({ error: "Samo rukovodilac i direktor mogu pregledati neusklađenosti." });
  const parsed = reportingQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Neispravni datumi ili filteri izveštaja." });
  try {
    return res.json(await unassignedWorkPage(prisma, parsed.data));
  } catch (error) {
    console.error("Unassigned-work reporting failed:", error);
    return res.status(500).json({ error: "Neusklađenosti nisu učitane. Pokušajte ponovo." });
  }
});

function buildFieldWorkWhere(req, { includeShiftAndStatus = false } = {}) {
  const {
    parcelId,
    machineId,
    workerId,
    workTypeId,
    shift,
    status,
    dateFrom,
    dateTo,
    search,
  } = req.query;

  const where = {};

  if (parcelId) where.parcelId = String(parcelId);
  if (machineId) {
    where.AND = [
      {
        OR: [
          { machineAssignments: { some: { machineId: String(machineId), voidedAt: null } } },
          { machineId: String(machineId), machineAssignments: { none: { voidedAt: null } } },
        ],
      },
    ];
  }
  if (workerId) where.workerId = String(workerId);
  if (workTypeId) where.workTypeId = String(workTypeId);
  if (includeShiftAndStatus && shift) where.shift = String(shift);
  if (includeShiftAndStatus && status) {
    where.status = String(status);
  } else {
    // Podrazumevano prikazujemo sve koji nisu STORNO osim ako se eksplicitno traži
    where.status = { not: "STORNO" };
  }

  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = new Date(String(dateFrom));
    if (dateTo) {
      const end = new Date(String(dateTo));
      end.setHours(23, 59, 59, 999);
      where.date.lte = end;
    }
  }

  // Izolacija podataka: Radnici/operateri vide isključivo sopstvene unose
  if (!isManagerUser(req.user)) {
    const opFilter = getOperatorFilter(req.worker);
    where.AND = where.AND || [];
    where.AND.push(opFilter);
  }

  if (search) {
    const s = String(search).trim();
    if (s) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { parcel: { name: { contains: s, mode: "insensitive" } } },
          { parcel: { code: { contains: s, mode: "insensitive" } } },
          { machine: { name: { contains: s, mode: "insensitive" } } },
          { machineAssignments: { some: { voidedAt: null, machine: { name: { contains: s, mode: "insensitive" } } } } },
          { worker: { name: { contains: s, mode: "insensitive" } } },
          { workType: { name: { contains: s, mode: "insensitive" } } },
          { notes: { contains: s, mode: "insensitive" } },
        ],
      });
    }
  }

  return where;
}

const fieldWorkListSelect = {
  id: true,
  date: true,
  shift: true,
  parcelId: true,
  contractorId: true,
  machineId: true,
  attachmentId: true,
  workerId: true,
  workTypeId: true,
  areaDoneHa: true,
  startTime: true,
  endTime: true,
  workHours: true,
  status: true,
  notes: true,
  photoUrl: true,
  parcel: { select: { id: true, code: true, name: true, areaHa: true } },
  contractor: { select: { id: true, name: true } },
  machine: { select: { id: true, name: true } },
  attachment: { select: { id: true, name: true } },
  worker: { select: { id: true, name: true } },
  workType: { select: { id: true, name: true } },
  machineAssignments: {
    where: { voidedAt: null },
    select: {
      id: true,
      machineId: true,
      areaDoneHa: true,
      machine: { select: { id: true, name: true } },
    },
    orderBy: { assignedAt: "asc" },
  },
  workOrder: { select: { id: true, status: true } },
  materials: materialsInclude,
};

const fieldWorkExportSelect = {
  date: true,
  shift: true,
  areaDoneHa: true,
  startTime: true,
  endTime: true,
  workHours: true,
  notes: true,
  parcel: { select: { code: true, name: true, areaHa: true } },
  contractor: { select: { name: true } },
  machine: { select: { name: true } },
  worker: { select: { name: true } },
  workType: { select: { name: true } },
  machineAssignments: {
    where: { voidedAt: null },
    select: {
      areaDoneHa: true,
      startHours: true,
      endHours: true,
      machine: { select: { name: true } },
    },
    orderBy: { assignedAt: "asc" },
  },
  materials: materialsInclude,
};

// ==========================================
// 2. LISTA RADOVA SA FILTERIMA (DNEVNIK RADA)
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const where = buildFieldWorkWhere(req, { includeShiftAndStatus: true });

    const take = Math.min(Number(limit) || 50, 100);
    const skip = ((Number(page) || 1) - 1) * take;

    const [total, works] = await Promise.all([
      prisma.fieldWork.count({ where }),
      prisma.fieldWork.findMany({
        where,
        select: fieldWorkListSelect,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: Number(page) || 1,
      totalPages: Math.ceil(total / take),
      works,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju dnevnika radova:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 3. NOVI UNOS RADA NA NJIVI
// ==========================================
const fieldWorkSchema = z.object({
  date: z.string().optional(),
  shift: z.enum(["PRVA", "DRUGA", "TRECA"]).optional(),
  contractorId: optionalContractorId,
  materials: materialsSchema.optional(),
  parcelId: z.string().min(1, "Parcela je obavezna"),
  machineId: z.string().min(1, "Mašina je obavezna"),
  attachmentId: z.string().optional().nullable(),
  workerId: z.string().min(1, "Radnik je obavezan").optional().nullable(),
  workTypeId: z.string().min(1, "Radna operacija je obavezna"),
  areaDoneHa: z.number().positive("Urađena površina mora biti veća od 0"),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format početka mora biti HH:MM (npr. 07:00)")
    .optional()
    .nullable(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format završetka mora biti HH:MM (npr. 15:30)")
    .optional()
    .nullable(),
  workHours: z.number().nonnegative().optional().nullable(),
  status: z.enum(["U_TOKU", "ZAVRSENO", "STORNO"]).default("ZAVRSENO"),
  notes: z.string().max(1000).optional().nullable(),
  photoUrl: z.string().url("Neispravan URL slike").optional().nullable(),
  autoAssignMachine: z.boolean().optional().default(true),
  workOrderId: z.string().optional().nullable(),
  cancelRemainder: z.boolean().optional(),
  usageAreas: z.array(z.object({ assignmentId: z.string(), areaDoneHa: z.number().finite().nonnegative() })).optional(),
  machineReturns: z.array(z.object({ assignmentId: z.string(), endHours: z.number().finite().nonnegative(),
    endFuelLiters: z.number().finite().nonnegative(), expectedMachineUpdatedAt: z.string(),
    isOperational: z.boolean().default(true), returnNotes: z.string().max(500).optional() })).optional(),
  endFuelLiters: z.number().nonnegative().optional().nullable(),
  endHours: z.number().nonnegative().optional().nullable(),
  isOperational: z.boolean().optional().default(true),
  returnNotes: z.string().max(500).optional().nullable(),
});

router.post("/", machineMutation(async (req, res, prisma) => {
  try {
    const parsed = fieldWorkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const {
      date,
      shift,
      parcelId,
      machineId,
      attachmentId,
      workerId,
      workTypeId,
      areaDoneHa,
      startTime,
      endTime,
      workHours: manualHours,
      status,
      notes,
      photoUrl,
      autoAssignMachine,
    } = parsed.data;

    if (status !== "ZAVRSENO") return res.status(400).json({ error: "Za pocetak rada koristite zaduzivanje/prihvatanje naloga. Ovde se evidentira zavrseni rad." });
    if (parsed.data.cancelRemainder && (!isManagerUser(req.user) || !parsed.data.workOrderId)) {
      return res.status(403).json({ error: "Samo rukovodilac ili direktor može otkazati preostali deo naloga." });
    }
    // Resolve identity only through the unique User -> Worker relation.
    let finalWorkerId = workerId;
    if (!isManagerUser(req.user) || !finalWorkerId) {
      const worker = await getRequestWorker(req, prisma);
      if (!worker) return res.status(403).json({ error: "Nalog nije povezan sa aktivnim profilom radnika." });
      if (!isManagerUser(req.user) && workerId && workerId !== worker.id) {
        return res.status(403).json({ error: "Možete unositi podatke samo za svoj profil radnika." });
      }
      finalWorkerId = worker.id;
    }
    const targetWorker = await prisma.worker.findUnique({ where: { id: finalWorkerId } });
    if (!targetWorker?.isActive) return res.status(400).json({ error: "Izabrani radnik nije aktivan ili ne postoji." });

    // 1. Provera parcele i Plausibility provera hektara (max parcel.areaHa * 1.2)
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcelId },
    });

    if (!parcel) {
      return res.status(404).json({ error: "Izabrana parcela ne postoji." });
    }

    const maxAllowedHa = Math.round(parcel.areaHa * 1.2 * 100) / 100;
    if (areaDoneHa > maxAllowedHa) {
      return res.status(400).json({
        error: `Uneti hektari (${areaDoneHa} ha) prelaze maksimalnu dozvoljenu površinu za parcelu "${parcel.name}" od ${maxAllowedHa} ha (ukupna površina ${parcel.areaHa} ha + 20% tolerancije). Molimo proverite unos.`,
      });
    }

    // 2. Provera mašine i validacija radnih sati (endHours ne sme biti manji od početnih)
    const machineObj = await prisma.machine.findUnique({ where: { id: machineId } });
    if (!machineObj) {
      return res.status(404).json({ error: "Izabrana mašina ne postoji." });
    }
    if (machineObj.isActive === false) return res.status(409).json({ error: "Mašina je arhivirana i nije dostupna za novi rad." });
    if (attachmentId && (await prisma.machine.findUnique({ where: { id: attachmentId } }))?.isActive === false) {
      return res.status(409).json({ error: "Priključak je arhiviran i nije dostupan za novi rad." });
    }

    // machineMutation holds the machine lock before this read and all writes.
    const tankCapacity = machineObj.tankCapacityLiters ?? 200;
    if (parsed.data.endFuelLiters != null && parsed.data.endFuelLiters > tankCapacity) {
      return res.status(400).json({
        error: `Količina goriva na povratku (${parsed.data.endFuelLiters} L) ne može biti veća od kapaciteta rezervoara mašine "${machineObj.name}" (${tankCapacity} L).`,
      });
    }
    if (parsed.data.endFuelLiters != null) {
      const conflict = fuelSnapshotError(machineObj, req.body.expectedMachineUpdatedAt);
      if (conflict) return res.status(409).json(conflict);
    }

    let linkedOrder = null;
    if (parsed.data.workOrderId) {
      linkedOrder = await prisma.workOrder.findUnique({ where: { id: parsed.data.workOrderId }, include: { materials: materialsInclude } });
      if (!linkedOrder) return res.status(404).json({ error: "Radni nalog nije pronađen." });
      if (!canAccessWorkerRecord(req, linkedOrder)) {
        return res.status(403).json({ error: "Radni nalog ne pripada vašem profilu." });
      }
      if (linkedOrder.workerId !== finalWorkerId || linkedOrder.machineId !== machineId || linkedOrder.parcelId !== parcelId ||
          (linkedOrder.workTypeId && linkedOrder.workTypeId !== workTypeId) ||
          (linkedOrder.attachmentId || null) !== (attachmentId || null)) {
        return res.status(400).json({ error: "Radnik, mašina, parcela i posao moraju odgovarati radnom nalogu." });
      }
      if (["ZAVRSEN", "OTKAZAN"].includes(linkedOrder.status)) {
        return res.status(409).json({ error: "Radni nalog je već završen ili otkazan." });
      }
    }

    let activeAssignment = null;
    if (parsed.data.workOrderId) {
      activeAssignment = await prisma.machineAssignment.findFirst({
        where: {
          workOrderId: parsed.data.workOrderId,
          machineId,
          status: "ZADUZENA",
        },
      });
    }

    if (!activeAssignment) {
      activeAssignment = await prisma.machineAssignment.findFirst({
        where: {
          machineId,
          status: "ZADUZENA",
        },
        orderBy: { assignedAt: "desc" },
      });
    }

    if (!linkedOrder && activeAssignment?.workOrderId) {
      linkedOrder = await prisma.workOrder.findUnique({ where: { id: activeAssignment.workOrderId }, include: { materials: materialsInclude } });
      if (!linkedOrder || !canAccessWorkerRecord(req, linkedOrder) || linkedOrder.workerId !== finalWorkerId ||
          linkedOrder.machineId !== machineId || linkedOrder.parcelId !== parcelId ||
          (linkedOrder.workTypeId && linkedOrder.workTypeId !== workTypeId) || (linkedOrder.attachmentId || null) !== (attachmentId || null)) {
        return res.status(409).json({ error: "Zaduženje pripada radnom nalogu. Otvorite taj nalog i evidentirajte njegov rad." });
      }
    }
    if (activeAssignment && (activeAssignment.workerId !== finalWorkerId || activeAssignment.machineId !== machineId ||
        (linkedOrder && (activeAssignment.workOrderId !== linkedOrder.id || activeAssignment.parcelId !== parcelId)))) {
      return res.status(403).json({ error: "Zaduženje mašine ne odgovara radniku i radnom nalogu." });
    }

    if ((!activeAssignment && machineObj.status === "ZADUZENA") ||
        ["SERVIS", "U_KVARU"].includes(machineObj.status) || await hasOpenMaintenance(prisma, machineId)) {
      return res.status(409).json({ error: "Mašina je u kvaru ili na servisu i nije dostupna za rad na njivi." });
    }

    if (!activeAssignment && !parsed.data.workOrderId) {
      if (machineObj.status === "SERVIS") {
        return res.status(400).json({
          error: `Mašina "${machineObj.name}" je na servisu/remontu i ne može se koristiti za rad na njivi.`,
        });
      }
      if (machineObj.status === "U_KVARU") {
        return res.status(400).json({
          error: `Mašina "${machineObj.name}" je u kvaru i ne može se koristiti za rad na njivi.`,
        });
      }
      if (machineObj.status === "ZADUZENA") {
        return res.status(400).json({
          error: `Mašina "${machineObj.name}" je već zadužena i ne može se uneti bez prethodnog razduženja.`,
        });
      }
    }

    const baselineHours = activeAssignment?.startHours ?? machineObj.currentHours ?? 0;
    if (parsed.data.endHours !== undefined && parsed.data.endHours !== null) {
      if (parsed.data.endHours < baselineHours) {
        return res.status(400).json({
          error: `Krajnji radni sati (${parsed.data.endHours} rh) ne mogu biti manji od početnih (${baselineHours} rh).`,
        });
      }
    }

    // 3. Automatski obračun radnih sati
    let finalWorkHours = manualHours;
    if (startTime && endTime) {
      const calculated = calculateWorkHours(startTime, endTime);
      if (calculated !== null) {
        finalWorkHours = calculated;
      }
    }

    // Save the work, machine state and order completion atomically.
    const work = await prisma.$transaction(async (tx) => {
      const currentMachine = await tx.machine.findUnique({ where: { id: machineId } });
      if (!currentMachine || ["status", "currentHours", "currentFuelLiters"]
        .some((key) => currentMachine[key] !== machineObj[key])) {
        throw Object.assign(new Error("Stanje mašine je promenjeno."), { status: 409 });
      }
      if (activeAssignment) {
        const currentAssignment = await tx.machineAssignment.findUnique({ where: { id: activeAssignment.id } });
        if (!currentAssignment || ["workerId", "machineId", "parcelId", "workOrderId", "status"]
          .some((key) => currentAssignment[key] !== activeAssignment[key])) {
          throw Object.assign(new Error("Zaduženje je promenjeno."), { status: 409 });
        }
      }
      if (linkedOrder) {
        const currentOrder = await tx.workOrder.findUnique({ where: { id: linkedOrder.id }, include: { materials: materialsInclude } });
        if (!currentOrder || ["workerId", "machineId", "parcelId", "contractorId", "workTypeId", "attachmentId", "status"]
          .some((key) => currentOrder[key] !== linkedOrder[key])) {
          throw Object.assign(new Error("Radni nalog je promenjen. Osvežite podatke i pokušajte ponovo."), { status: 409 });
        }
      }
      await validateContractor(tx, parsed.data.contractorId === undefined ? linkedOrder?.contractorId : parsed.data.contractorId);
      const materialRows = await prepareMaterials(tx, workTypeId, parsed.data.materials ?? linkedOrder?.materials,
        linkedOrder?.materials ?? []);
      const finalShift = shift ?? linkedOrder?.shift ?? "PRVA";
      const work = await tx.fieldWork.create({
        data: {
          date: date ? new Date(date) : new Date(),
          shift: finalShift,
          parcelId,
          contractorId: parsed.data.contractorId === undefined ? linkedOrder?.contractorId ?? null : parsed.data.contractorId,
          machineId,
          attachmentId: attachmentId || null,
          workerId: finalWorkerId,
          workTypeId,
          areaDoneHa,
          startTime: startTime || null,
          endTime: endTime || null,
          workHours: finalWorkHours ?? null,
          status,
          notes: notes || null,
          photoUrl: photoUrl || null,
          createdById: req.user.id,
          ...(materialRows.length && { materials: { createMany: { data: materialRows } } }),
        },
        include: {
          parcel: true, contractor: true,
          machine: true, machineAssignments: usageInclude, workOrder: { select: { id: true, status: true } },
          attachment: true,
          worker: true,
          workType: true, materials: materialsInclude,
        },
      });

      await completeMachineUsage(tx, req, { work, order: linkedOrder, machine: currentMachine,
        activeAssignment, input: parsed.data, workHours: finalWorkHours });
      await tx.auditLog.create({ data: { entityType: "FieldWork", entityId: work.id, action: "KREIRANJE",
        userId: req.user.id, userName: req.user.name, userRole: req.user.role,
        description: "Evidentiran rad i završeno razduženje korišćenih mašina.",
        newValues: { workerId: finalWorkerId, workOrderId: linkedOrder?.id || null, areaDoneHa, workHours: finalWorkHours ?? null } } });
      return work;
    }, { isolationLevel: "Serializable" });

    res.status(201).json({
      message: `Uspešno evidentiran rad na parceli "${parcel.name}".`,
      work: {
        ...work,
        workOrderId: linkedOrder?.id || parsed.data.workOrderId || null,
        isMachineUnassigned: true,
      },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("Greška pri unosu rada na njivi:", error);
    if (error.status === 409 || ["P2025", "P2034"].includes(error.code)) {
      return res.status(409).json({ error: "Podaci su promenjeni. Osvežite podatke i pokušajte ponovo." });
    }
    res.status(500).json({ error: "Greška na serveru pri čuvanju rada." });
  }
}));

// ==========================================
// 4. IZMENA RADA NA NJIVI (UZ PROVERU PRAVA I AUDIT LOG)
// ==========================================
router.put("/:id", machineMutation(async (req, res, prisma) => {
  try {
    const { id } = req.params;
    const existing = await prisma.fieldWork.findUnique({
      where: { id },
      include: { parcel: true, contractor: true, worker: true, machine: true, attachment: true, workType: true, materials: materialsInclude },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o radu nije pronađen." });
    }

    assertCorrectionAccess(req, existing, existing.date);
    const linked = await prisma.workOrder.findFirst({ where: { fieldWorkId: id } });
    if ((req.body.status !== undefined && req.body.status !== existing.status) ||
        (req.body.machineId && req.body.machineId !== existing.machineId)) {
      throw statusError("Koristite korekciju/zamenu masine ili postupak storniranja rada.");
    }
    if (req.body.date && new Date(req.body.date).toISOString().slice(0, 10) !== new Date(existing.date).toISOString().slice(0, 10)) {
      throw statusError("Datum evidentiranog rada ne moze se direktno menjati.");
    }
    const usage = await prisma.machineAssignment.findFirst({ where: { fieldWorkId: id } });
    if (linked || usage) for (const key of ["workerId", "parcelId", "workTypeId", "attachmentId"]) {
      if (req.body[key] !== undefined && (req.body[key] || null) !== (existing[key] || null)) throw statusError("Rad ima povezanu realizaciju. Radnika, parcelu, operaciju i prikljucak ne mozete direktno promeniti.");
    }
    if (req.body.areaDoneHa !== undefined && req.body.areaDoneHa !== existing.areaDoneHa && usage) {
      throw statusError("Ukupnu povrsinu menjajte zajedno sa raspodelom kroz pregled koriscenih masina.");
    }
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    const isOperator = req.user.role === "OPERATER";

    if (!isManager && !isOperator) {
      return res.status(403).json({ error: "Nemate ovlašćenje za izmenu rada." });
    }

    // Specifična pravila za operatera (radnika):
    if (isOperator) {
      // 1. Sme da menja samo svoj unos
      const isOwnWork = existing.workerId === req.worker.id;

      if (!isOwnWork) {
        return res.status(403).json({ error: "Možete menjati isključivo sopstvene unose rada." });
      }

      if (req.body.workerId && req.body.workerId !== existing.workerId) {
        return res.status(403).json({ error: "Ne možete menjati dodeljenog radnika." });
      }
    }

    const parsed = fieldWorkSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const updateData = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => Object.hasOwn(req.body, key)));
    delete updateData.autoAssignMachine;

    // Plausibility provera ako se menja parcela ili površina
    const targetParcelId = updateData.parcelId || existing.parcelId;
    const targetArea = updateData.areaDoneHa !== undefined ? updateData.areaDoneHa : existing.areaDoneHa;

    if (updateData.parcelId || updateData.areaDoneHa !== undefined) {
      const parcel = await prisma.parcel.findUnique({ where: { id: targetParcelId } });
      if (parcel) {
        const maxAllowed = Math.round(parcel.areaHa * 1.2 * 100) / 100;
        if (targetArea > maxAllowed) {
          return res.status(400).json({
            error: `Uneti hektari (${targetArea} ha) prelaze maksimalnu dozvoljenu površinu za parcelu "${parcel.name}" od ${maxAllowed} ha (+20% tolerancije).`,
          });
        }
      }
    }

    // Rekalkulacija sati
    const startT = updateData.startTime !== undefined ? updateData.startTime : existing.startTime;
    const endT = updateData.endTime !== undefined ? updateData.endTime : existing.endTime;
    if (startT && endT) {
      const autoHours = calculateWorkHours(startT, endT);
      if (autoHours !== null) {
        updateData.workHours = autoHours;
      }
    }

    if (updateData.date) {
      updateData.date = new Date(updateData.date);
    }

    // Izračunavanje razlika (Diff) za Audit Log
    const changes = [];
    const oldValues = {};
    const newValues = {};

    if (updateData.areaDoneHa !== undefined && updateData.areaDoneHa !== existing.areaDoneHa) {
      changes.push(`Urađeno: ${existing.areaDoneHa} ha → ${updateData.areaDoneHa} ha`);
      oldValues.areaDoneHa = existing.areaDoneHa;
      newValues.areaDoneHa = updateData.areaDoneHa;
    }
    if (updateData.shift && updateData.shift !== existing.shift) {
      changes.push(`Smena: ${existing.shift} → ${updateData.shift}`);
      oldValues.shift = existing.shift;
      newValues.shift = updateData.shift;
    }
    if (updateData.parcelId && updateData.parcelId !== existing.parcelId) {
      const newP = await prisma.parcel.findUnique({ where: { id: updateData.parcelId } });
      changes.push(`Parcela: ${existing.parcel?.name || existing.parcelId} → ${newP ? newP.name : updateData.parcelId}`);
      oldValues.parcel = existing.parcel?.name || existing.parcelId;
      newValues.parcel = newP ? newP.name : updateData.parcelId;
    }
    if (updateData.machineId && updateData.machineId !== existing.machineId) {
      const newM = await prisma.machine.findUnique({ where: { id: updateData.machineId } });
      if (newM?.isActive === false) return res.status(409).json({ error: "Ne možete izabrati arhiviranu mašinu." });
      changes.push(`Mašina: ${existing.machine?.name || existing.machineId} → ${newM ? newM.name : updateData.machineId}`);
      oldValues.machine = existing.machine?.name || existing.machineId;
      newValues.machine = newM ? newM.name : updateData.machineId;
    }
    if (updateData.workTypeId && updateData.workTypeId !== existing.workTypeId) {
      const newWT = await prisma.workType.findUnique({ where: { id: updateData.workTypeId } });
      changes.push(`Operacija: ${existing.workType?.name || existing.workTypeId} → ${newWT ? newWT.name : updateData.workTypeId}`);
      oldValues.workType = existing.workType?.name || existing.workTypeId;
      newValues.workType = newWT ? newWT.name : updateData.workTypeId;
    }
    if (updateData.workHours !== undefined && updateData.workHours !== existing.workHours) {
      changes.push(`Radni sati: ${existing.workHours || 0} rh → ${updateData.workHours} rh`);
      oldValues.workHours = existing.workHours;
      newValues.workHours = updateData.workHours;
    }
    if (updateData.startTime !== undefined && updateData.startTime !== existing.startTime) {
      changes.push(`Početak: ${existing.startTime || '-'} → ${updateData.startTime}`);
      oldValues.startTime = existing.startTime;
      newValues.startTime = updateData.startTime;
    }
    if (updateData.endTime !== undefined && updateData.endTime !== existing.endTime) {
      changes.push(`Kraj: ${existing.endTime || '-'} → ${updateData.endTime}`);
      oldValues.endTime = existing.endTime;
      newValues.endTime = updateData.endTime;
    }
    if (updateData.notes !== undefined && updateData.notes !== existing.notes) {
      changes.push(`Napomena izmenjena`);
      oldValues.notes = existing.notes;
      newValues.notes = updateData.notes;
    }
    if (updateData.status && updateData.status !== existing.status) {
      changes.push(`Status: ${existing.status} → ${updateData.status}`);
      oldValues.status = existing.status;
      newValues.status = updateData.status;
    }

    if (updateData.attachmentId !== undefined && updateData.attachmentId !== existing.attachmentId) {
      const newAtt = updateData.attachmentId ? await prisma.machine.findUnique({ where: { id: updateData.attachmentId } }) : null;
      if (newAtt?.isActive === false) return res.status(409).json({ error: "Ne možete izabrati arhivirani priključak." });
      changes.push(`Priključak: ${existing.attachment?.name || 'Bez priključka'} → ${newAtt ? newAtt.name : 'Bez priključka'}`);
      oldValues.attachment = existing.attachment?.name || null;
      newValues.attachment = newAtt ? newAtt.name : null;
    }

    if (updateData.contractorId !== undefined) {
      await validateContractor(prisma, updateData.contractorId);
      if (updateData.contractorId !== existing.contractorId) {
        const selected = updateData.contractorId ? await prisma.contractor.findUnique({ where: { id: updateData.contractorId } }) : null;
        changes.push(`Kooperant: ${existing.contractor?.name || '—'} → ${selected?.name || '—'}`);
        oldValues.contractor = existing.contractor?.name || null;
        newValues.contractor = selected?.name || null;
      }
    }
    const prismaUpdateData = {};
    if (updateData.contractorId !== undefined) prismaUpdateData.contractor = updateData.contractorId
      ? { connect: { id: updateData.contractorId } } : { disconnect: true };

    if (updateData.materials !== undefined || (updateData.workTypeId && updateData.workTypeId !== existing.workTypeId)) {
      const rows = await prepareMaterials(prisma, updateData.workTypeId ?? existing.workTypeId,
        updateData.materials ?? [], existing.materials ?? []);
      prismaUpdateData.materials = { deleteMany: {}, ...(rows.length && { createMany: { data: rows } }) };
      const snapshots = rows.map(({ fertilizerId, chemicalId, seedId, ...item }) => item);
      if (JSON.stringify(snapshots) !== JSON.stringify(existing.materials ?? [])) {
        changes.push("Materijali izmenjeni");
        oldValues.materials = existing.materials ?? [];
        newValues.materials = snapshots;
      }
    }
    if (updateData.date !== undefined) prismaUpdateData.date = updateData.date;
    if (updateData.shift !== undefined) prismaUpdateData.shift = updateData.shift;
    if (updateData.areaDoneHa !== undefined) prismaUpdateData.areaDoneHa = updateData.areaDoneHa;
    if (updateData.startTime !== undefined) prismaUpdateData.startTime = updateData.startTime;
    if (updateData.endTime !== undefined) prismaUpdateData.endTime = updateData.endTime;
    if (updateData.workHours !== undefined) prismaUpdateData.workHours = updateData.workHours;
    if (updateData.status !== undefined) prismaUpdateData.status = updateData.status;
    if (updateData.notes !== undefined) prismaUpdateData.notes = updateData.notes;
    if (updateData.photoUrl !== undefined) prismaUpdateData.photoUrl = updateData.photoUrl;

    if (updateData.parcelId) {
      prismaUpdateData.parcel = { connect: { id: updateData.parcelId } };
    }
    if (updateData.machineId) {
      prismaUpdateData.machine = { connect: { id: updateData.machineId } };
    }
    if (updateData.workerId) {
      prismaUpdateData.worker = { connect: { id: updateData.workerId } };
    }
    if (updateData.workTypeId) {
      prismaUpdateData.workType = { connect: { id: updateData.workTypeId } };
    }
    if (updateData.attachmentId !== undefined) {
      prismaUpdateData.attachment = updateData.attachmentId
        ? { connect: { id: updateData.attachmentId } }
        : { disconnect: true };
    }

    const updated = await prisma.fieldWork.update({
      where: { id },
      data: prismaUpdateData,
      include: {
        parcel: true, contractor: true,
        machine: true, machineAssignments: usageInclude, workOrder: { select: { id: true, status: true } },
        attachment: true,
        worker: true,
        workType: true, materials: materialsInclude,
      },
    });

    // Zapis u Audit Log ako je bilo promena
    if (changes.length > 0) {
      await prisma.auditLog.create({
        data: {
          entityType: "FieldWork",
          entityId: existing.id,
          action: "IZMENA",
          userId: req.user.id,
          userName: req.user.name || "Korisnik",
          userRole: req.user.role,
          description: changes.join("; "),
          oldValues,
          newValues,
        },
      });
    }

    res.json({
      message: "Zapis o radu je uspešno ažuriran.",
      work: updated,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("Greška pri ažuriranju rada:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
// 5. STORNIRANJE / BRISANJE RADA (UZ AUDIT LOG)
// ==========================================
router.delete("/:id", machineMutation(async (req, res, prisma) => {
  try {
    const { id } = req.params;
    const existing = await prisma.fieldWork.findUnique({
      where: { id },
      include: { parcel: true, contractor: true, worker: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o radu nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      return res.status(403).json({ error: "Samo rukovodilac i direktor mogu stornirati ili brisati radove." });
    }

    const hardDelete = req.query.permanent === "true" && req.user.role === "DIREKTOR";

    if (hardDelete && (await prisma.machineAssignment.findFirst({ where: { fieldWorkId: id } }) || await prisma.workOrder.findFirst({ where: { fieldWorkId: id } }))) {
      return res.status(409).json({ error: "Rad sa povezanom istorijom moze se stornirati, ali ne trajno obrisati." });
    }
    if (hardDelete) {
      await prisma.fieldWork.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          entityType: "FieldWork",
          entityId: id,
          action: "BRISANJE",
          userId: req.user.id,
          userName: req.user.name || "Direktor",
          userRole: req.user.role,
          description: `Trajno obrisan rad na parceli "${existing.parcel?.name || existing.parcelId}" (${existing.areaDoneHa} ha)`,
          oldValues: {
            parcel: existing.parcel?.name,
            areaDoneHa: existing.areaDoneHa,
            worker: existing.worker?.name,
          },
        },
      });

      res.json({ message: "Zapis o radu je trajno obrisan." });
    } else {
      await prisma.fieldWork.update({
        where: { id },
        data: { status: "STORNO" },
      });

      await prisma.auditLog.create({
        data: {
          entityType: "FieldWork",
          entityId: id,
          action: "STORNO",
          userId: req.user.id,
          userName: req.user.name || "Korisnik",
          userRole: req.user.role,
          description: `Storniran rad na parceli "${existing.parcel?.name || existing.parcelId}" (${existing.areaDoneHa} ha)`,
          oldValues: {
            parcel: existing.parcel?.name,
            areaDoneHa: existing.areaDoneHa,
            worker: existing.worker?.name,
            status: existing.status,
          },
          newValues: { status: "STORNO" },
        },
      });

      res.json({ message: "Rad je storniran i isključen iz učinka. Stvarno korišćenje, gorivo i kvarovi ostaju u istoriji." });
    }
  } catch (error) {
    console.error("Greška pri brisanju rada:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

// ==========================================
// 6. IZVOZ U EXCEL (EXCEL EXPORT)
// ==========================================
router.get("/export/excel", async (req, res) => {
  try {
    const where = buildFieldWorkWhere(req);

    const works = await prisma.fieldWork.findMany({
      where,
      select: fieldWorkExportSelect,
      orderBy: { date: "desc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NANDRA Software";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Dnevnik Radova", {
      views: [{ showGridLines: true }],
    });

    // Naslov izveštaja
    worksheet.mergeCells("A1:O1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "NANDRA — ZVANIČNI DNEVNIK RADOVA NA NJIVI";
    titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF166534" }, // Tamno zelena
    };
    worksheet.getRow(1).height = 35;

    // Podnaslov
    worksheet.mergeCells("A2:O2");
    const subtitleCell = worksheet.getCell("A2");
    subtitleCell.value = `Izveštaj generisan: ${new Date().toLocaleDateString("sr-RS")} | Ukupno zapisa: ${works.length}`;
    subtitleCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF374151" } };
    subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(2).height = 20;

    worksheet.addRow([]); // Prazan red

    // Zaglavlja kolona
    const headerRow = worksheet.addRow([
      "RB",
      "Datum",
      "Smena",
      "Šifra",
      "Parcela",
      "Površina",
      "Urađeno (ha)",
      "Radnik",
      "Mašina / Traktor",
      "Operacija",
      "Vreme",
      "Sati (rh)",
      "Napomena",
      "Kooperant",
      "Materijali",
    ]);
    headerRow.height = 24;

    headerRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" }, // Tamno plava / siva
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "medium" },
        right: { style: "thin" },
      };
    });

    // Popunjavanje redova
    let totalHa = 0;
    let totalHours = 0;

    works.forEach((w, idx) => {
      totalHa += w.areaDoneHa || 0;
      totalHours += w.workHours || 0;

      const dateFormatted = new Date(w.date).toLocaleDateString("sr-RS");
      const timeRange = w.startTime && w.endTime ? `${w.startTime} - ${w.endTime}` : "-";

      const row = worksheet.addRow([
        idx + 1,
        dateFormatted,
        w.shift,
        w.parcel.code,
        w.parcel.name,
        w.parcel.areaHa,
        w.areaDoneHa,
        w.worker.name,
        w.machineAssignments?.length ? w.machineAssignments.map(a => `${a.machine.name}: ${a.areaDoneHa ?? 0} ha, ${Math.max(0, (a.endHours ?? a.startHours) - a.startHours)} rh`).join("; ") : w.machine.name,
        w.workType.name,
        timeRange,
        w.workHours || 0,
        w.notes || "-",
        w.contractor?.name || "-",
        materialText(w.materials) || "-",
      ]);

      row.height = 20;
      if (w.materials?.length) {
        row.height = Math.min(409, Math.max(32, materialText(w.materials).split("\n").reduce((lines, text) => lines + Math.ceil(text.length / 40), 0) * 15));
        row.getCell(15).alignment = { vertical: "middle", wrapText: true };
      }
      row.alignment = { vertical: "middle" };

      // Bojenje parnih redova za čitljivost
      if (idx % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFC" },
          };
        });
      }

      // Poravnanja: centralno za brojeve, šifre, smene i datume
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "center" }; // Površina (ha) na sredinu
      row.getCell(7).alignment = { horizontal: "center" }; // Urađeno (ha) na sredinu
      row.getCell(11).alignment = { horizontal: "center" };
      row.getCell(12).alignment = { horizontal: "center" }; // Sati (rh) na sredinu
    });

    // Zbirni red
    worksheet.addRow([]);
    const summaryRow = worksheet.addRow([
      "UKUPNO",
      "",
      "",
      "",
      "",
      "",
      Math.round(totalHa * 100) / 100,
      "",
      "",
      "",
      "",
      Math.round(totalHours * 10) / 10,
      "",
    ]);
    summaryRow.height = 24;
    summaryRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10, bold: true };
      cell.border = { top: { style: "double" }, bottom: { style: "double" } };
    });
    summaryRow.getCell(1).alignment = { horizontal: "center" };
    summaryRow.getCell(7).alignment = { horizontal: "center" };
    summaryRow.getCell(12).alignment = { horizontal: "center" };

    // Fiksne, optimizovane širine kolona
    const columnWidths = [
      6,   // 1. RB (veoma usko)
      12,  // 2. Datum
      9,   // 3. Smena (PRVA/DRUGA/TRECA)
      8,   // 4. Šifra (P-01, P-02...)
      28,  // 5. Parcela (naziv - prošireno)
      11,  // 6. Površina
      13,  // 7. Urađeno (ha)
      23,  // 8. Radnik (prošireno sa 18 na 23)
      24,  // 9. Mašina / Traktor (prošireno)
      36,  // 10. Operacija (prošireno sa 30 na 36)
      13,  // 11. Vreme (07:00 - 15:00)
      9,   // 12. Sati (rh) (kompaktno za 2-3 cifre)
      40,  // 13. Napomena (znatno prošireno)
      28,  // 14. Kooperant
      48,  // 15. Materijali i doze
    ];

    worksheet.columns.forEach((column, index) => {
      column.width = columnWidths[index] || 12;
    });

    const fileName = `nandra_radovi_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Greška pri izvozu u Excel:", error);
    res.status(500).json({ error: "Greška pri generisanju Excel izveštaja." });
  }
});

export default router;

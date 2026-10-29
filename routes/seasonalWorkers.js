import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

// Pristup dozvoljen samo ulogovanim korisnicima sa ulogom DIREKTOR ili RUKOVODILAC
router.use(requireAuth);
router.use(requireRole(["DIREKTOR", "RUKOVODILAC"]));

/**
 * Pomoćna funkcija za računanje radnih sati iz vremena početka i kraja
 */
function calculateHoursWorked(startTime, endTime, breakMinutes = 0) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;

  const startTotal = sh * 60 + sm;
  let endTotal = eh * 60 + em;
  if (endTotal < startTotal) {
    endTotal += 24 * 60; // prelazak preko ponoći
  }

  const netMinutes = Math.max(0, endTotal - startTotal - (Number(breakMinutes) || 0));
  return Number((netMinutes / 60).toFixed(2));
}

// =========================================================================
// 1. ŠIFARNIK SEZONACA (CRUD)
// =========================================================================

// Šema validacije za unos/izmenu sezonca
const seasonalWorkerSchema = z.object({
  name: z.string().trim().min(2, "Ime i prezime je obavezno."),
  phone: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  groupName: z.string().trim().optional().nullable(),
  dailyWage: z.number().nonnegative().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/seasonal/workers
 * Lista sezonaca sa pretragom, filterima i listom unikatnih grupa
 */
router.get("/workers", async (req, res) => {
  try {
    const { search, groupName, isActive, limit, page } = req.query;

    const where = {};

    if (isActive !== undefined && isActive !== "ALL") {
      where.isActive = isActive === "true" || isActive === true;
    }

    if (groupName && groupName !== "ALL") {
      where.groupName = String(groupName);
    }

    if (search) {
      const s = String(search).trim();
      where.OR = [
        { name: { contains: s, mode: "insensitive" } },
        { city: { contains: s, mode: "insensitive" } },
        { phone: { contains: s, mode: "insensitive" } },
        { groupName: { contains: s, mode: "insensitive" } },
      ];
    }

    // Izvlačenje svih dostupnih grupa za filtere
    const allGroups = await prisma.seasonalWorker.findMany({
      where: { groupName: { not: null } },
      select: { groupName: true },
      distinct: ["groupName"],
    });
    const groupNames = allGroups
      .map((g) => g.groupName)
      .filter(Boolean)
      .sort();

    // Ako je traženo limit=all (za dropdown menije na frontendu)
    if (limit === "all") {
      const workers = await prisma.seasonalWorker.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });
      return res.json({ workers, groupNames, total: workers.length });
    }

    const pageSize = Math.max(1, Math.min(Number(limit) || 25, 100));
    const currentPage = Math.max(1, Number(page) || 1);
    const skip = (currentPage - 1) * pageSize;

    const [total, workers] = await Promise.all([
      prisma.seasonalWorker.count({ where }),
      prisma.seasonalWorker.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        skip,
        take: pageSize,
      }),
    ]);

    res.json({
      workers,
      groupNames,
      total,
      page: currentPage,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju sezonaca:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju sezonaca." });
  }
});

/**
 * POST /api/seasonal/workers
 * Kreiranje novog sezonca
 */
router.post("/workers", async (req, res) => {
  try {
    const data = seasonalWorkerSchema.parse(req.body);

    const worker = await prisma.seasonalWorker.create({
      data: {
        name: data.name,
        phone: data.phone || null,
        city: data.city || null,
        groupName: data.groupName || null,
        dailyWage: data.dailyWage !== undefined && data.dailyWage !== null ? Number(data.dailyWage) : null,
        notes: data.notes || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });

    // Sinhronizacija sa opštom Worker tabelom
    await prisma.worker
      .create({
        data: {
          name: worker.name,
          type: "SEZONAC",
          phone: worker.phone,
          city: worker.city,
          dailyWage: worker.dailyWage,
          isActive: worker.isActive,
        },
      })
      .catch((err) => console.error("Greška pri sinhronizaciji Worker tabele iz Sezonaca:", err));

    res.status(201).json({ worker, message: `Sezonac ${worker.name} uspešno kreiran.` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error("Greška pri kreiranju sezonca:", error);
    res.status(500).json({ error: "Greška pri kreiranju sezonca." });
  }
});

/**
 * PUT /api/seasonal/workers/:id
 * Izmena podataka o sezoncu
 */
router.put("/workers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = seasonalWorkerSchema.partial().parse(req.body);

    const existing = await prisma.seasonalWorker.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Sezonac nije pronađen." });
    }

    const worker = await prisma.seasonalWorker.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.city !== undefined && { city: data.city || null }),
        ...(data.groupName !== undefined && { groupName: data.groupName || null }),
        ...(data.dailyWage !== undefined && {
          dailyWage: data.dailyWage !== null ? Number(data.dailyWage) : null,
        }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    // Sinhronizacija sa opštom Worker tabelom
    const existingWorker = await prisma.worker.findFirst({
      where: { name: { equals: existing.name.trim(), mode: "insensitive" }, type: "SEZONAC" },
    });
    if (existingWorker) {
      await prisma.worker
        .update({
          where: { id: existingWorker.id },
          data: {
            name: worker.name,
            phone: worker.phone,
            city: worker.city,
            dailyWage: worker.dailyWage,
            isActive: worker.isActive,
          },
        })
        .catch((err) => console.error("Greška pri sinhronizaciji Worker tabele iz Sezonaca:", err));
    }

    res.json({ worker, message: `Podaci za ${worker.name} uspešno ažurirani.` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error("Greška pri izmeni sezonca:", error);
    res.status(500).json({ error: "Greška pri ažuriranju podataka sezonca." });
  }
});

/**
 * DELETE /api/seasonal/workers/:id
 * Brisanje ili deaktivacija sezonca
 */
router.delete("/workers/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.seasonalWorker.findUnique({
      where: { id },
      include: { _count: { select: { workLogs: true } } },
    });

    if (!existing) {
      return res.status(404).json({ error: "Sezonac nije pronađen." });
    }

    // Ako ima zabeležene radne sate, ne brišemo trajno već ga deaktiviramo
    if (existing._count.workLogs > 0) {
      await prisma.seasonalWorker.update({
        where: { id },
        data: { isActive: false },
      });
      return res.json({
        message: `Sezonac ${existing.name} ima evidentirane dane rada, pa je prebačen u status Neaktivan.`,
        deactivated: true,
      });
    }

    await prisma.seasonalWorker.delete({ where: { id } });

    // Ukloni i iz Worker tabele
    await prisma.worker
      .deleteMany({
        where: { name: { equals: existing.name.trim(), mode: "insensitive" }, type: "SEZONAC" },
      })
      .catch((err) => console.error("Greška pri brisanju iz Worker tabele:", err));

    res.json({ message: `Sezonac ${existing.name} uspešno obrisan.` });
  } catch (error) {
    console.error("Greška pri brisanju sezonca:", error);
    res.status(500).json({ error: "Greška pri brisanju sezonca." });
  }
});

// =========================================================================
// 1.1 GRUPE SEZONACA (GROUPS CRUD & MANAGEMENT)
// =========================================================================

/**
 * GET /api/seasonal/groups
 * Dohvatanje svih formiranih grupa sa članovima i liste radnika bez grupe
 */
router.get("/groups", async (req, res) => {
  try {
    const workers = await prisma.seasonalWorker.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        dailyWage: true,
        groupName: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    const dbGroups = await prisma.seasonalGroup.findMany({
      orderBy: { name: "asc" },
    });

    const groupMap = new Map();
    // Sve definisane grupe iz tabele (čak i ako trenutno imaju 0 radnika)
    for (const dg of dbGroups) {
      const gName = dg.name.trim();
      groupMap.set(gName, {
        id: dg.id,
        name: gName,
        count: 0,
        workers: [],
      });
    }

    const unassigned = [];

    for (const w of workers) {
      if (w.groupName && w.groupName.trim()) {
        const gName = w.groupName.trim();
        if (!groupMap.has(gName)) {
          groupMap.set(gName, {
            name: gName,
            count: 0,
            workers: [],
          });
          // Automatski sačuvaj ako do sada nije bila u bazi
          prisma.seasonalGroup.upsert({
            where: { name: gName },
            update: {},
            create: { name: gName },
          }).catch(() => {});
        }
        const g = groupMap.get(gName);
        g.count += 1;
        g.workers.push(w);
      } else {
        unassigned.push(w);
      }
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      groups,
      unassigned,
      allActiveWorkers: workers,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju grupa:", error);
    res.status(500).json({ error: "Greška pri dohvatanju grupa." });
  }
});

/**
 * POST /api/seasonal/groups
 * Kreiranje nove grupe i opciona dodela označenih radnika
 */
router.post("/groups", async (req, res) => {
  try {
    const { name, workerIds } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Naziv grupe je obavezan." });
    }
    const cleanName = name.trim();

    // 1. Sačuvaj grupu u seasonalGroup tabeli (trajno perzistirana i sa 0 radnika)
    await prisma.seasonalGroup.upsert({
      where: { name: cleanName },
      update: {},
      create: { name: cleanName },
    });

    // 2. Ako su prosleđeni radnici, dodeli ih grupi
    if (Array.isArray(workerIds) && workerIds.length > 0) {
      await prisma.seasonalWorker.updateMany({
        where: { id: { in: workerIds } },
        data: { groupName: cleanName },
      });
    }

    res.status(201).json({ message: `Grupa "${cleanName}" je uspešno sačuvana.` });
  } catch (error) {
    console.error("Greška pri kreiranju grupe:", error);
    res.status(500).json({ error: "Greška pri kreiranju grupe." });
  }
});

/**
 * PUT /api/seasonal/groups/:groupName
 * Izmena naziva grupe i/ili ažuriranje članova grupe
 */
router.put("/groups/:groupName", async (req, res) => {
  try {
    const currentGroupName = decodeURIComponent(req.params.groupName).trim();
    const { newName, workerIds } = req.body;

    const finalName = newName && newName.trim() ? newName.trim() : currentGroupName;

    // Ažuriraj ili kreiraj u seasonalGroup
    await prisma.seasonalGroup.upsert({
      where: { name: currentGroupName },
      update: { name: finalName },
      create: { name: finalName },
    });

    // Ako je promenjen naziv grupe, ažuriraj radnike i stare logove
    if (finalName !== currentGroupName) {
      await prisma.seasonalWorker.updateMany({
        where: { groupName: currentGroupName },
        data: { groupName: finalName },
      });
      await prisma.seasonalWorkLog.updateMany({
        where: { groupName: currentGroupName },
        data: { groupName: finalName },
      });
    }

    // Ažuriranje članova grupe
    if (Array.isArray(workerIds)) {
      // Radnici koji su bili u grupi a nisu u listi se izbacuju iz grupe
      await prisma.seasonalWorker.updateMany({
        where: { groupName: finalName, id: { notIn: workerIds } },
        data: { groupName: null },
      });
      // Radnici u listi dobijaju novu grupu
      if (workerIds.length > 0) {
        await prisma.seasonalWorker.updateMany({
          where: { id: { in: workerIds } },
          data: { groupName: finalName },
        });
      }
    }

    res.json({ message: `Grupa "${finalName}" uspešno ažurirana.` });
  } catch (error) {
    console.error("Greška pri izmeni grupe:", error);
    res.status(500).json({ error: "Greška pri izmeni grupe." });
  }
});

/**
 * DELETE /api/seasonal/groups/:groupName
 * Brisanje / raspuštanje grupe (radnici postaju bez grupe, ne brišu se)
 */
router.delete("/groups/:groupName", async (req, res) => {
  try {
    const groupName = decodeURIComponent(req.params.groupName).trim();

    // Obriši iz seasonalGroup tabele
    await prisma.seasonalGroup.deleteMany({
      where: { name: groupName },
    });

    // Ukloni pripadnost radnika ovoj grupi
    await prisma.seasonalWorker.updateMany({
      where: { groupName },
      data: { groupName: null },
    });

    res.json({ message: `Grupa "${groupName}" je uspešno obrisana.` });
  } catch (error) {
    console.error("Greška pri brisanju grupe:", error);
    res.status(500).json({ error: "Greška pri brisanju grupe." });
  }
});

// =========================================================================
// 2. DNEVNA EVIDENCIJA RADA (LOGS)
// =========================================================================

/**
 * GET /api/seasonal/logs
 * Hronološki prikaz evidencije rada sa paginacijom i filterima
 */
router.get("/logs", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      workerId,
      parcelId,
      dateFrom,
      dateTo,
      search,
      groupName,
    } = req.query;

    const where = {};

    if (workerId && workerId !== "ALL") {
      where.seasonalWorkerId = String(workerId);
    }

    if (parcelId && parcelId !== "ALL") {
      where.parcelId = String(parcelId);
    }

    if (groupName && groupName !== "ALL") {
      where.groupName = String(groupName);
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) {
        where.date.gte = new Date(String(dateFrom));
      }
      if (dateTo) {
        const end = new Date(String(dateTo));
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    if (search) {
      const s = String(search).trim();
      where.OR = [
        { jobDescription: { contains: s, mode: "insensitive" } },
        { seasonalWorker: { name: { contains: s, mode: "insensitive" } } },
        { parcel: { name: { contains: s, mode: "insensitive" } } },
      ];
    }

    const isAll = String(limit).toLowerCase() === "all";
    const pageSize = isAll ? undefined : Math.max(1, Math.min(Number(limit) || 25, 100));
    const currentPage = isAll ? 1 : Math.max(1, Number(page) || 1);
    const skip = isAll ? undefined : (currentPage - 1) * pageSize;

    const [total, logs] = await Promise.all([
      prisma.seasonalWorkLog.count({ where }),
      prisma.seasonalWorkLog.findMany({
        where,
        include: {
          seasonalWorker: true,
          parcel: {
            select: { id: true, code: true, name: true, currentCrop: true, areaHa: true },
          },
          supervisor: {
            select: { id: true, name: true, role: true },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
      }),
    ]);

    res.json({
      logs,
      total,
      page: currentPage,
      totalPages: isAll ? 1 : (Math.ceil(total / (pageSize || 1)) || 1),
    });
  } catch (error) {
    console.error("Greška pri dohvatanju evidencije rada:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju evidencije rada." });
  }
});

/**
 * POST /api/seasonal/logs
 * Pojedinačni unos rada za jednog sezonca
 */
router.post("/logs", async (req, res) => {
  try {
    const {
      seasonalWorkerId,
      parcelId,
      jobDescription,
      date,
      startTime,
      endTime,
      breakMinutes = 0,
      hoursWorked,
      dailyWageApplied,
      groupName,
      groupCount,
      notes,
    } = req.body;

    if (!seasonalWorkerId) {
      return res.status(400).json({ error: "Izbor sezonskog radnika je obavezan." });
    }
    if (!jobDescription || !jobDescription.trim()) {
      return res.status(400).json({ error: "Opis posla je obavezan." });
    }

    const worker = await prisma.seasonalWorker.findUnique({
      where: { id: seasonalWorkerId },
    });
    if (!worker) {
      return res.status(404).json({ error: "Izabrani sezonac ne postoji." });
    }

    // Proračun radnih sati
    const computedHours =
      hoursWorked !== undefined && hoursWorked !== null && hoursWorked !== ""
        ? Number(hoursWorked)
        : calculateHoursWorked(startTime, endTime, breakMinutes);

    // Dnevnica: ako je prosleđena u zahtevu koristi se ona, inače radnikova default dnevnica
    const finalWage =
      dailyWageApplied !== undefined && dailyWageApplied !== null && dailyWageApplied !== ""
        ? Number(dailyWageApplied)
        : worker.dailyWage || null;

    const log = await prisma.seasonalWorkLog.create({
      data: {
        date: date ? new Date(date) : new Date(),
        seasonalWorkerId,
        parcelId: parcelId || null,
        jobDescription: jobDescription.trim(),
        startTime: startTime || null,
        endTime: endTime || null,
        breakMinutes: Number(breakMinutes) || 0,
        hoursWorked: computedHours,
        dailyWageApplied: finalWage,
        supervisorId: req.user.id,
        groupName: groupName || worker.groupName || null,
        groupCount: groupCount ? Number(groupCount) : null,
        notes: notes || null,
      },
      include: {
        seasonalWorker: true,
        parcel: true,
        supervisor: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ log, message: "Radni dan uspešno evidentiran." });
  } catch (error) {
    console.error("Greška pri unosu rada sezonca:", error);
    res.status(500).json({ error: "Greška na serveru pri evidentiranju rada." });
  }
});

/**
 * POST /api/seasonal/logs/group
 * Grupni unos rada — u jednoj transakciji kreira zapise za celu grupu radnika
 */
router.post("/logs/group", async (req, res) => {
  try {
    const {
      workerIds,
      parcelId,
      jobDescription,
      date,
      startTime,
      endTime,
      breakMinutes = 0,
      hoursWorked,
      dailyWage,
      groupName,
      notes,
    } = req.body;

    if (!Array.isArray(workerIds) || workerIds.length === 0) {
      return res.status(400).json({ error: "Morate označiti barem jednog radnika." });
    }
    if (!jobDescription || !jobDescription.trim()) {
      return res.status(400).json({ error: "Opis posla je obavezan." });
    }

    const workers = await prisma.seasonalWorker.findMany({
      where: { id: { in: workerIds } },
    });

    if (workers.length === 0) {
      return res.status(400).json({ error: "Nijedan izabrani radnik nije pronađen." });
    }

    const computedHours =
      hoursWorked !== undefined && hoursWorked !== null && hoursWorked !== ""
        ? Number(hoursWorked)
        : calculateHoursWorked(startTime, endTime, breakMinutes);

    const logDate = date ? new Date(date) : new Date();
    const groupCount = workers.length;

    // Kreiramo zapise za svakog označenog radnika kroz prisma transakciju
    const createdLogs = await prisma.$transaction(
      workers.map((w) => {
        const finalWage =
          dailyWage !== undefined && dailyWage !== null && dailyWage !== ""
            ? Number(dailyWage)
            : w.dailyWage || null;

        return prisma.seasonalWorkLog.create({
          data: {
            date: logDate,
            seasonalWorkerId: w.id,
            parcelId: parcelId || null,
            jobDescription: jobDescription.trim(),
            startTime: startTime || null,
            endTime: endTime || null,
            breakMinutes: Number(breakMinutes) || 0,
            hoursWorked: computedHours,
            dailyWageApplied: finalWage,
            supervisorId: req.user.id,
            groupName: groupName || w.groupName || null,
            groupCount,
            notes: notes || null,
          },
        });
      })
    );

    res.status(201).json({
      success: true,
      count: createdLogs.length,
      message: `Uspešno evidentiran rad za ${createdLogs.length} radnika (${computedHours}h po radniku).`,
    });
  } catch (error) {
    console.error("Greška pri grupnom unosu rada:", error);
    res.status(500).json({ error: "Greška na serveru pri grupnom unosu rada." });
  }
});

/**
 * PUT /api/seasonal/logs/:id
 * Izmena postojećeg zapisa iz dnevnika rada
 */
router.put("/logs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      seasonalWorkerId,
      parcelId,
      jobDescription,
      date,
      startTime,
      endTime,
      breakMinutes = 0,
      hoursWorked,
      dailyWageApplied,
      groupName,
      groupCount,
      notes,
    } = req.body;

    const existing = await prisma.seasonalWorkLog.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Zapis o radu nije pronađen." });
    }

    let workerGroupName = existing.groupName;
    if (seasonalWorkerId && seasonalWorkerId !== existing.seasonalWorkerId) {
      const worker = await prisma.seasonalWorker.findUnique({ where: { id: seasonalWorkerId } });
      if (!worker) {
        return res.status(404).json({ error: "Izabrani sezonac ne postoji." });
      }
      workerGroupName = worker.groupName;
    }

    if (jobDescription !== undefined && !jobDescription.trim()) {
      return res.status(400).json({ error: "Opis posla je obavezan." });
    }

    const newStartTime = startTime !== undefined ? startTime : existing.startTime;
    const newEndTime = endTime !== undefined ? endTime : existing.endTime;
    const newBreak = breakMinutes !== undefined ? Number(breakMinutes) || 0 : existing.breakMinutes;

    const computedHours =
      hoursWorked !== undefined && hoursWorked !== null && hoursWorked !== ""
        ? Number(hoursWorked)
        : calculateHoursWorked(newStartTime, newEndTime, newBreak);

    const updatedLog = await prisma.seasonalWorkLog.update({
      where: { id },
      data: {
        ...(seasonalWorkerId && { seasonalWorkerId }),
        ...(parcelId !== undefined && { parcelId: parcelId || null }),
        ...(jobDescription && { jobDescription: jobDescription.trim() }),
        ...(date && { date: new Date(date) }),
        ...(startTime !== undefined && { startTime: startTime || null }),
        ...(endTime !== undefined && { endTime: endTime || null }),
        breakMinutes: newBreak,
        hoursWorked: computedHours,
        ...(dailyWageApplied !== undefined && {
          dailyWageApplied: dailyWageApplied !== null && dailyWageApplied !== "" ? Number(dailyWageApplied) : null,
        }),
        ...(groupName !== undefined ? { groupName: groupName || null } : (workerGroupName ? { groupName: workerGroupName } : {})),
        ...(groupCount !== undefined && { groupCount: groupCount ? Number(groupCount) : null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: {
        seasonalWorker: true,
        parcel: true,
        supervisor: { select: { id: true, name: true, role: true } },
      },
    });

    res.json({ log: updatedLog, message: "Zapis o radu uspešno ažuriran." });
  } catch (error) {
    console.error("Greška pri izmeni zapisa rada:", error);
    res.status(500).json({ error: "Greška na serveru pri izmeni zapisa rada." });
  }
});

/**
 * DELETE /api/seasonal/logs/:id
 * Brisanje zapisa iz dnevnika rada
 */
router.delete("/logs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.seasonalWorkLog.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Zapis nije pronađen." });
    }

    await prisma.seasonalWorkLog.delete({ where: { id } });
    res.json({ message: "Zapis o radu uspešno obrisan." });
  } catch (error) {
    console.error("Greška pri brisanju zapisa rada:", error);
    res.status(500).json({ error: "Greška pri brisanju zapisa rada." });
  }
});

// =========================================================================
// 3. AGREGACIJE & ZBIROVI SATI
// =========================================================================

/**
 * GET /api/seasonal/summary
 * Automatski zbir sati po radniku, parceli, danu i vrsti posla
 */
router.get("/summary", async (req, res) => {
  try {
    const { dateFrom, dateTo, parcelId, workerId, groupName } = req.query;

    const where = {};

    if (workerId && workerId !== "ALL") {
      where.seasonalWorkerId = String(workerId);
    }
    if (parcelId && parcelId !== "ALL") {
      where.parcelId = String(parcelId);
    }
    if (groupName && groupName !== "ALL") {
      const gStr = String(groupName);
      where.OR = [
        { groupName: gStr },
        { seasonalWorker: { groupName: gStr } },
      ];
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

    const logs = await prisma.seasonalWorkLog.findMany({
      where,
      include: {
        seasonalWorker: { select: { id: true, name: true, phone: true, groupName: true } },
        parcel: { select: { id: true, code: true, name: true, currentCrop: true } },
      },
      orderBy: { date: "asc" },
    });

    // 1. Zbir po radniku
    const workerMap = new Map();
    // 2. Zbir po parceli
    const parcelMap = new Map();
    // 3. Zbir po danu
    const dayMap = new Map();
    // 4. Zbir po vrsti posla
    const jobMap = new Map();
    // 5. Zbir po grupama
    const groupMap = new Map();

    let totalHours = 0;
    let totalDailyWage = 0;

    for (const log of logs) {
      const hours = Number(log.hoursWorked) || 0;
      const wage = Number(log.dailyWageApplied) || 0;
      totalHours += hours;
      totalDailyWage += wage;

      // Radnik
      const wId = log.seasonalWorkerId;
      if (!workerMap.has(wId)) {
        workerMap.set(wId, {
          workerId: wId,
          name: log.seasonalWorker.name,
          phone: log.seasonalWorker.phone || "—",
          groupName: log.seasonalWorker.groupName || "—",
          daysCount: new Set(),
          totalHours: 0,
          totalWage: 0,
        });
      }
      const wObj = workerMap.get(wId);
      wObj.daysCount.add(log.date.toISOString().split("T")[0]);
      wObj.totalHours += hours;
      wObj.totalWage += wage;

      // Parcela
      const pKey = log.parcelId || "NO_PARCEL";
      const pName = log.parcel ? `${log.parcel.name} (${log.parcel.code})` : "Bez parcele / Magacin";
      const pCrop = log.parcel?.currentCrop || "—";
      if (!parcelMap.has(pKey)) {
        parcelMap.set(pKey, {
          parcelId: log.parcelId,
          name: pName,
          crop: pCrop,
          logsCount: 0,
          totalHours: 0,
          totalWage: 0,
        });
      }
      const pObj = parcelMap.get(pKey);
      pObj.logsCount += 1;
      pObj.totalHours += hours;
      pObj.totalWage += wage;

      // Dan
      const dKey = log.date.toISOString().split("T")[0];
      if (!dayMap.has(dKey)) {
        dayMap.set(dKey, {
          date: dKey,
          workersSet: new Set(),
          logsCount: 0,
          totalHours: 0,
          totalWage: 0,
        });
      }
      const dObj = dayMap.get(dKey);
      dObj.workersSet.add(wId);
      dObj.logsCount += 1;
      dObj.totalHours += hours;
      dObj.totalWage += wage;

      // Posao
      const jKey = log.jobDescription.trim();
      if (!jobMap.has(jKey)) {
        jobMap.set(jKey, {
          jobDescription: jKey,
          logsCount: 0,
          totalHours: 0,
          totalWage: 0,
        });
      }
      const jObj = jobMap.get(jKey);
      jObj.logsCount += 1;
      jObj.totalHours += hours;
      jObj.totalWage += wage;

      // Grupa
      const gKey = (log.groupName || log.seasonalWorker.groupName || "Bez grupe (Pojedinačni)").trim();
      if (!groupMap.has(gKey)) {
        groupMap.set(gKey, {
          groupName: gKey,
          workersSet: new Set(),
          logsCount: 0,
          totalHours: 0,
          totalWage: 0,
        });
      }
      const gObj = groupMap.get(gKey);
      gObj.workersSet.add(wId);
      gObj.logsCount += 1;
      gObj.totalHours += hours;
      gObj.totalWage += wage;
    }

    const byWorker = Array.from(workerMap.values())
      .map((w) => ({
        ...w,
        totalDays: w.daysCount.size,
        totalHours: Number(w.totalHours.toFixed(2)),
        totalWage: Number(w.totalWage.toFixed(2)),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    const byParcel = Array.from(parcelMap.values())
      .map((p) => ({
        ...p,
        totalHours: Number(p.totalHours.toFixed(2)),
        totalWage: Number(p.totalWage.toFixed(2)),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    const byDay = Array.from(dayMap.values())
      .map((d) => ({
        date: d.date,
        workerCount: d.workersSet.size,
        logsCount: d.logsCount,
        totalHours: Number(d.totalHours.toFixed(2)),
        totalWage: Number(d.totalWage.toFixed(2)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const byJob = Array.from(jobMap.values())
      .map((j) => ({
        ...j,
        totalHours: Number(j.totalHours.toFixed(2)),
        totalWage: Number(j.totalWage.toFixed(2)),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    const byGroup = Array.from(groupMap.values())
      .map((g) => ({
        groupName: g.groupName,
        workerCount: g.workersSet.size,
        logsCount: g.logsCount,
        totalHours: Number(g.totalHours.toFixed(2)),
        totalWage: Number(g.totalWage.toFixed(2)),
        avgHoursPerWorker: g.workersSet.size > 0 ? Number((g.totalHours / g.workersSet.size).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    res.json({
      totals: {
        totalHours: Number(totalHours.toFixed(2)),
        totalDailyWage: Number(totalDailyWage.toFixed(2)),
        totalLogs: logs.length,
        totalWorkers: workerMap.size,
        totalGroups: groupMap.size,
      },
      byWorker,
      byParcel,
      byDay,
      byJob,
      byGroup,
    });
  } catch (error) {
    console.error("Greška pri proračunu zbira radnih sati:", error);
    res.status(500).json({ error: "Greška pri proračunu zbira radnih sati." });
  }
});

// =========================================================================
// 4. IZVOZ U EXCEL ZA OBRAČUN & BLAGAJNU
// =========================================================================

/**
 * GET /api/seasonal/export-excel
 * Generisanje formatiranog Excel fajla sa potpisnom listom
 */
router.get("/export-excel", async (req, res) => {
  try {
    const { dateFrom, dateTo, parcelId, workerId, groupName } = req.query;

    const where = {};
    if (workerId && workerId !== "ALL") where.seasonalWorkerId = String(workerId);
    if (parcelId && parcelId !== "ALL") where.parcelId = String(parcelId);
    if (groupName && groupName !== "ALL") {
      const gStr = String(groupName);
      where.OR = [
        { groupName: gStr },
        { seasonalWorker: { groupName: gStr } },
      ];
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

    const logs = await prisma.seasonalWorkLog.findMany({
      where,
      include: {
        seasonalWorker: true,
        parcel: true,
        supervisor: { select: { name: true } },
      },
      orderBy: [{ date: "asc" }, { seasonalWorker: { name: "asc" } }],
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NANDRA Software";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Evidencija Sezonaca", {
      views: [{ showGridLines: true }],
    });

    // 1. Glavno zaglavlje
    worksheet.mergeCells("A1:N1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "NANDRA — EVIDENCIJA RADA SEZONSKIH RADNIKA I BLAGAJNIČKI LIST";
    titleCell.font = { name: "Arial", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF166534" }, // Tamno zelena
    };
    worksheet.getRow(1).height = 32;

    // 2. Podnaslov sa periodom
    worksheet.mergeCells("A2:N2");
    const subCell = worksheet.getCell("A2");
    const periodStr =
      dateFrom && dateTo
        ? `Period: ${dateFrom} do ${dateTo}`
        : dateFrom
        ? `Od datuma: ${dateFrom}`
        : dateTo
        ? `Do datuma: ${dateTo}`
        : "Svi evidentirani zapisi";

    subCell.value = `${periodStr} | Izveštaj generisan: ${new Date().toLocaleDateString("sr-RS")} | Ukupno stavki: ${logs.length}`;
    subCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF374151" } };
    subCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(2).height = 18;

    worksheet.addRow([]); // Prazan red

    // 3. Zaglavlja kolona
    const headers = [
      "RB",
      "Datum",
      "Ime i Prezime Radnika",
      "Grupa",
      "Grad / Mesto",
      "Telefon",
      "Parcela",
      "Vrsta Posla",
      "Početak",
      "Kraj",
      "Pauza (min)",
      "Radni Sati",
      "Dnevnica (RSD)",
      "Nadzor (Poslovođa)",
      "Potpis Radnika",
    ];

    const headerRow = worksheet.addRow(headers);
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" }, // Slate tamno siva
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "medium", color: { argb: "FF0F172A" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });

    let totalHoursSum = 0;
    let totalWageSum = 0;

    // 4. Podaci
    logs.forEach((log, index) => {
      const hours = Number(log.hoursWorked) || 0;
      const wage = Number(log.dailyWageApplied) || 0;
      totalHoursSum += hours;
      totalWageSum += wage;

      const dateStr = log.date.toLocaleDateString("sr-RS");
      const parcelStr = log.parcel
        ? `${log.parcel.name} (${log.parcel.code})`
        : "—";

      const row = worksheet.addRow([
        index + 1,
        dateStr,
        log.seasonalWorker.name,
        log.groupName || log.seasonalWorker.groupName || "—",
        log.seasonalWorker.city || "—",
        log.seasonalWorker.phone || "—",
        parcelStr,
        log.jobDescription,
        log.startTime || "—",
        log.endTime || "—",
        log.breakMinutes || 0,
        hours,
        wage > 0 ? wage : "—",
        log.supervisor?.name || "—",
        "", // Prazno polje za svojeručni potpis radnika
      ]);

      row.height = 20;

      // Zebra striping
      const isEven = index % 2 === 0;
      row.eachCell((cell, colNum) => {
        cell.font = { name: "Arial", size: 9 };
        cell.alignment = {
          vertical: "middle",
          horizontal: [1, 2, 9, 10, 11].includes(colNum)
            ? "center"
            : [12, 13].includes(colNum)
            ? "right"
            : "left",
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isEven ? "FFFFFFFF" : "FFF8FAFC" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };

        if (colNum === 12 && hours > 0) {
          cell.numFmt = "#,##0.00";
        }
        if (colNum === 13 && wage > 0) {
          cell.numFmt = "#,##0.00";
        }
      });
    });

    // 5. Zbirni red na dnu
    const summaryRow = worksheet.addRow([
      "UKUPNO",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      totalHoursSum,
      totalWageSum > 0 ? totalWageSum : "—",
      "",
      "",
    ]);

    summaryRow.height = 24;
    summaryRow.eachCell((cell, colNum) => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF0F172A" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };
      cell.border = {
        top: { style: "medium", color: { argb: "FF0F172A" } },
        bottom: { style: "double", color: { argb: "FF0F172A" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
      if (colNum === 12) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.numFmt = "#,##0.00";
      }
      if (colNum === 13) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.numFmt = "#,##0.00";
      }
    });

    // Širine kolona
    worksheet.columns = [
      { width: 6 },  // RB
      { width: 12 }, // Datum
      { width: 24 }, // Ime i prezime
      { width: 16 }, // Grupa
      { width: 14 }, // Grad
      { width: 14 }, // Telefon
      { width: 20 }, // Parcela
      { width: 22 }, // Posao
      { width: 10 }, // Početak
      { width: 10 }, // Kraj
      { width: 12 }, // Pauza
      { width: 13 }, // Radni sati
      { width: 16 }, // Dnevnica
      { width: 18 }, // Nadzor
      { width: 20 }, // Potpis radnika
    ];

    const fileNameDate = new Date().toISOString().split("T")[0];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Evidencija_sezonaca_${fileNameDate}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Greška pri generisanju Excel izveštaja za sezonce:", error);
    res.status(500).json({ error: "Greška pri kreiranju Excel izvoza." });
  }
});

export default router;


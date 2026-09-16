import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

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

// ==========================================
// 1. STATISTIKA I AGREGACIJE RADOVA NA NJIVI
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    // Početak tekuće nedelje (ponedeljak)
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - dayOfWeek);

    // Početak tekućeg meseca
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const [allWorksToday, allWorksWeek, allWorksMonth, workTypesBreakdown] = await Promise.all([
      prisma.fieldWork.findMany({
        where: {
          date: { gte: todayStart },
          status: { not: "STORNO" },
        },
        include: {
          parcel: true,
          machine: true,
          worker: true,
          workType: true,
        },
      }),
      prisma.fieldWork.findMany({
        where: {
          date: { gte: weekStart },
          status: { not: "STORNO" },
        },
      }),
      prisma.fieldWork.findMany({
        where: {
          date: { gte: monthStart },
          status: { not: "STORNO" },
        },
      }),
      prisma.fieldWork.groupBy({
        by: ["workTypeId"],
        where: { status: { not: "STORNO" } },
        _sum: { areaDoneHa: true, workHours: true },
        _count: { id: true },
      }),
    ]);

    const totalAreaToday = allWorksToday.reduce((sum, w) => sum + (w.areaDoneHa || 0), 0);
    const totalHoursToday = allWorksToday.reduce((sum, w) => sum + (w.workHours || 0), 0);

    const totalAreaWeek = allWorksWeek.reduce((sum, w) => sum + (w.areaDoneHa || 0), 0);
    const totalHoursWeek = allWorksWeek.reduce((sum, w) => sum + (w.workHours || 0), 0);

    const totalAreaMonth = allWorksMonth.reduce((sum, w) => sum + (w.areaDoneHa || 0), 0);

    // Detekcija radova gde traktor danas nije imao zaduženje (upozorenje rukovodiocu)
    const activeMachineIdsToday = new Set(
      (
        await prisma.machineAssignment.findMany({
          where: {
            assignedAt: { gte: todayStart },
          },
          select: { machineId: true },
        })
      ).map((a) => a.machineId)
    );

    const unassignedWorksToday = allWorksToday.filter(
      (w) => !activeMachineIdsToday.has(w.machineId)
    ).length;

    res.json({
      today: {
        count: allWorksToday.length,
        areaDoneHa: Math.round(totalAreaToday * 100) / 100,
        workHours: Math.round(totalHoursToday * 10) / 10,
        unassignedWarnings: unassignedWorksToday,
      },
      week: {
        count: allWorksWeek.length,
        areaDoneHa: Math.round(totalAreaWeek * 100) / 100,
        workHours: Math.round(totalHoursWeek * 10) / 10,
      },
      month: {
        count: allWorksMonth.length,
        areaDoneHa: Math.round(totalAreaMonth * 100) / 100,
      },
      workTypesBreakdown,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju statistike radova:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2. LISTA RADOVA SA FILTERIMA (DNEVNIK RADA)
// ==========================================
router.get("/", async (req, res) => {
  try {
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
      limit = 50,
      page = 1,
    } = req.query;

    const where = {};

    if (parcelId) where.parcelId = String(parcelId);
    if (machineId) where.machineId = String(machineId);
    if (workerId) where.workerId = String(workerId);
    if (workTypeId) where.workTypeId = String(workTypeId);
    if (shift) where.shift = String(shift);
    if (status) {
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

    if (search) {
      const s = String(search).trim();
      where.OR = [
        { parcel: { name: { contains: s, mode: "insensitive" } } },
        { parcel: { code: { contains: s, mode: "insensitive" } } },
        { machine: { name: { contains: s, mode: "insensitive" } } },
        { worker: { name: { contains: s, mode: "insensitive" } } },
        { workType: { name: { contains: s, mode: "insensitive" } } },
        { notes: { contains: s, mode: "insensitive" } },
      ];
    }

    const take = Math.min(Number(limit) || 50, 100);
    const skip = ((Number(page) || 1) - 1) * take;

    const [total, works] = await Promise.all([
      prisma.fieldWork.count({ where }),
      prisma.fieldWork.findMany({
        where,
        include: {
          parcel: true,
          machine: true,
          worker: true,
          workType: true,
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
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
  shift: z.enum(["PRVA", "DRUGA", "TRECA"]).default("PRVA"),
  parcelId: z.string().min(1, "Parcela je obavezna"),
  machineId: z.string().min(1, "Mašina je obavezna"),
  workerId: z.string().min(1, "Radnik je obavezan"),
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
});

router.post("/", async (req, res) => {
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
      workerId,
      workTypeId,
      areaDoneHa,
      startTime,
      endTime,
      workHours: manualHours,
      status,
      notes,
      photoUrl,
    } = parsed.data;

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
        error: `Uneti hektari (${areaDoneHa} ha) prelaze maksimalno dozvoljenu površinu za parcelu "${parcel.name}" od ${maxAllowedHa} ha (ukupna površina ${parcel.areaHa} ha + 20% tolerancije). Molimo proverite unos.`,
      });
    }

    // 2. Automatski obračun radnih sati
    let finalWorkHours = manualHours;
    if (startTime && endTime) {
      const calculated = calculateWorkHours(startTime, endTime);
      if (calculated !== null) {
        finalWorkHours = calculated;
      }
    }

    // 3. Kreiranje zapisa (labava veza - nikada ne blokira radnika na njivi)
    const work = await prisma.fieldWork.create({
      data: {
        date: date ? new Date(date) : new Date(),
        shift,
        parcelId,
        machineId,
        workerId,
        workTypeId,
        areaDoneHa,
        startTime: startTime || null,
        endTime: endTime || null,
        workHours: finalWorkHours ?? null,
        status,
        notes: notes || null,
        photoUrl: photoUrl || null,
        createdById: req.user.id,
      },
      include: {
        parcel: true,
        machine: true,
        worker: true,
        workType: true,
      },
    });

    res.status(201).json({
      message: `Uspešno evidentiran rad na parceli "${parcel.name}".`,
      work,
    });
  } catch (error) {
    console.error("Greška pri unosu rada na njivi:", error);
    res.status(500).json({ error: "Greška na serveru pri čuvanju rada." });
  }
});

// ==========================================
// 4. IZMENA RADA NA NJIVI
// ==========================================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.fieldWork.findUnique({
      where: { id },
      include: { parcel: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o radu nije pronađen." });
    }

    // Pravo izmene: DIREKTOR, RUKOVODILAC ili autor zapisa
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager && existing.createdById !== req.user.id) {
      return res.status(403).json({ error: "Nemate dozvolu da menjate tuđi unos rada." });
    }

    const parsed = fieldWorkSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const updateData = { ...parsed.data };

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

    const updated = await prisma.fieldWork.update({
      where: { id },
      data: updateData,
      include: {
        parcel: true,
        machine: true,
        worker: true,
        workType: true,
      },
    });

    res.json({
      message: "Zapis o radu je uspešno ažuriran.",
      work: updated,
    });
  } catch (error) {
    console.error("Greška pri ažuriranju rada:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 5. STORNIRANJE / BRISANJE RADA
// ==========================================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.fieldWork.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o radu nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager && existing.createdById !== req.user.id) {
      return res.status(403).json({ error: "Nemate dozvolu za brisanje ovog zapisa." });
    }

    // Ako je direktor ili rukovodilac, brišemo ili storniramo
    const hardDelete = req.query.permanent === "true" && req.user.role === "DIREKTOR";

    if (hardDelete) {
      await prisma.fieldWork.delete({ where: { id } });
      res.json({ message: "Zapis o radu je trajno obrisan." });
    } else {
      await prisma.fieldWork.update({
        where: { id },
        data: { status: "STORNO" },
      });
      res.json({ message: "Zapis o radu je storniran." });
    }
  } catch (error) {
    console.error("Greška pri brisanju rada:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 6. IZVOZ U EXCEL (EXCEL EXPORT)
// ==========================================
router.get("/export/excel", async (req, res) => {
  try {
    const { parcelId, machineId, workerId, workTypeId, dateFrom, dateTo } = req.query;

    const where = { status: { not: "STORNO" } };
    if (parcelId) where.parcelId = String(parcelId);
    if (machineId) where.machineId = String(machineId);
    if (workerId) where.workerId = String(workerId);
    if (workTypeId) where.workTypeId = String(workTypeId);

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(String(dateFrom));
      if (dateTo) {
        const end = new Date(String(dateTo));
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const works = await prisma.fieldWork.findMany({
      where,
      include: {
        parcel: true,
        machine: true,
        worker: true,
        workType: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { date: "desc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NANDRA Software";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Dnevnik Radova", {
      views: [{ showGridLines: true }],
    });

    // Naslov izveštaja
    worksheet.mergeCells("A1:M1");
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
    worksheet.mergeCells("A2:M2");
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
      "Kat. Površina (ha)",
      "Urađeno (ha)",
      "Radnik",
      "Mašina / Traktor",
      "Operacija",
      "Vreme rada",
      "Sati (rh)",
      "Napomena",
    ]);
    headerRow.height = 26;

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
        w.machine.name,
        w.workType.name,
        timeRange,
        w.workHours || 0,
        w.notes || "-",
      ]);

      row.height = 20;
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

      // Numerička poravnanja
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "right" };
      row.getCell(7).alignment = { horizontal: "right" };
      row.getCell(11).alignment = { horizontal: "center" };
      row.getCell(12).alignment = { horizontal: "right" };
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
    summaryRow.getCell(7).alignment = { horizontal: "right" };
    summaryRow.getCell(12).alignment = { horizontal: "right" };

    // Auto-width kolona
    worksheet.columns.forEach((column) => {
      let maxLen = 12;
      column.eachCell({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : "";
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 40);
      });
      column.width = maxLen;
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

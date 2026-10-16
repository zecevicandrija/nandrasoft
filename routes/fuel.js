import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

// Kapacitet glavne cisterne gazdinstva u litrima (npr. 10.000 L)
const CISTERNA_KAPACITET_LITARA = 10000;

// ==========================================
// 1. STATISTIKA GORIVA I STANJE CISTERNE
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      return res.status(403).json({ error: "Nemate pristup statistici cisterne." });
    }

    // 1. Ukupno primljeno u cisternu
    const totalSupplies = await prisma.fuelSupply.aggregate({
      _sum: {
        liters: true,
        totalCost: true,
      },
      _count: { id: true },
    });

    const totalSuppliedLiters = totalSupplies._sum.liters || 0;
    const totalSuppliedCost = totalSupplies._sum.totalCost || 0;

    // 2. Ukupno istočeno iz cisterne
    const totalDispensedFromCisterna = await prisma.fuelEntry.aggregate({
      where: { fuelSource: "CISTERNA" },
      _sum: { liters: true },
    });
    const dispensedCisternaLiters = totalDispensedFromCisterna._sum.liters || 0;

    // Trenutno stanje cisterne
    const currentTankLiters = Math.max(0, totalSuppliedLiters - dispensedCisternaLiters);
    const tankFillPercentage = Math.min(100, Math.round((currentTankLiters / CISTERNA_KAPACITET_LITARA) * 100));

    // Ponderisana prosečna nabavna cena po litru u cisterni
    const avgCostPerLiter = totalSuppliedLiters > 0 
      ? Number((totalSuppliedCost / totalSuppliedLiters).toFixed(2)) 
      : 171.66; // Fallback referentna cena iz cenovnika

    // 3. Ukupno točeno ovog meseca (svi izvori)
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthDispensed, monthBySource, activeAnomaliesCount] = await Promise.all([
      prisma.fuelEntry.aggregate({
        where: { date: { gte: firstDayOfMonth } },
        _sum: { liters: true, totalCost: true },
      }),
      prisma.fuelEntry.groupBy({
        by: ["fuelSource"],
        where: { date: { gte: firstDayOfMonth } },
        _sum: { liters: true },
      }),
      prisma.fuelEntry.count({
        where: { hasAnomaly: true },
      }),
    ]);

    const sourceBreakdown = {
      CISTERNA: 0,
      PUMPA: 0,
      KANISTER: 0,
    };
    monthBySource.forEach((item) => {
      sourceBreakdown[item.fuelSource] = item._sum.liters || 0;
    });

    const responseData = {
      tank: {
        capacity: CISTERNA_KAPACITET_LITARA,
        currentLiters: Number(currentTankLiters.toFixed(1)),
        fillPercentage: tankFillPercentage,
        totalSuppliedLiters: Number(totalSuppliedLiters.toFixed(1)),
        dispensedCisternaLiters: Number(dispensedCisternaLiters.toFixed(1)),
        isLow: currentTankLiters < CISTERNA_KAPACITET_LITARA * 0.2, // Ispod 20%
        // Finansijski podaci vidljivi SAMO direktoru i rukovodiocu
        ...(isManager && {
          avgCostPerLiter,
          currentTankValueRSD: Math.round(currentTankLiters * avgCostPerLiter),
          totalSuppliedCost: Math.round(totalSuppliedCost),
        }),
      },
      monthStats: {
        totalLiters: Number((monthDispensed._sum.liters || 0).toFixed(1)),
        bySource: sourceBreakdown,
        ...(isManager && {
          totalCostRSD: Math.round(monthDispensed._sum.totalCost || 0),
        }),
      },
      anomaliesCount: activeAnomaliesCount,
    };

    res.json(responseData);
  } catch (error) {
    console.error("Greška pri dohvatanju statistike goriva:", error);
    res.status(500).json({ error: "Greška na serveru pri učitavanju stanja goriva." });
  }
});

// ==========================================
// 2. SPISAK TOČENJA SA FILTERIMA (DNEVNIK)
// ==========================================
router.get("/entries", async (req, res) => {
  try {
    const {
      machineId,
      workerId,
      fuelSource,
      hasAnomaly,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
      scope,
    } = req.query;

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    const where = {};
    if (machineId) where.machineId = String(machineId);
    if (workerId) where.workerId = String(workerId);
    if (fuelSource) where.fuelSource = String(fuelSource);
    if (hasAnomaly === "true") where.hasAnomaly = true;

    // Ako je korisnik radnik/operater, automatski ograniči SAMO na njegova točenja!
    if (!isManager) {
      const userNameParts = (req.user.name || "").trim().split(" ");
      const firstName = userNameParts[0] || "";
      const linkedWorker = await prisma.worker.findFirst({
        where: {
          OR: [
            { userId: req.user.id },
            ...(firstName ? [{ name: { contains: firstName, mode: "insensitive" } }] : []),
          ],
        },
      });
      if (linkedWorker) {
        where.OR = [{ workerId: linkedWorker.id }, { createdById: req.user.id }];
      } else {
        where.createdById = req.user.id;
      }
    }

    if (scope === "today") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      where.date = { gte: startOfToday, lte: endOfToday };
    } else if (scope === "history") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      where.date = { lt: startOfToday };
    } else if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(String(dateFrom));
      if (dateTo) {
        const dTo = new Date(String(dateTo));
        dTo.setHours(23, 59, 59, 999);
        where.date.lte = dTo;
      }
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const take = Number(limit);

    const [entries, totalCount] = await Promise.all([
      prisma.fuelEntry.findMany({
        where,
        skip,
        take,
        orderBy: { date: "desc" },
        include: {
          machine: {
            select: {
              id: true,
              name: true,
              type: true,
              brandModel: true,
              tankCapacityLiters: true,
              currentHours: true,
            },
          },
          worker: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          fieldWork: {
            select: {
              id: true,
              areaDoneHa: true,
              date: true,
              workType: {
                select: {
                  id: true,
                  name: true,
                  fuelNormLitersPerHa: true,
                },
              },
              parcel: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  areaHa: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      }),
      prisma.fuelEntry.count({ where }),
    ]);

    const todayStr = new Date().toDateString();

    // Poverljivost cena i provera prava na izmenu
    const sanitizedEntries = entries.map((entry) => {
      let lPerHa = null;
      let norm = null;
      if (entry.fieldWork && entry.fieldWork.areaDoneHa > 0) {
        lPerHa = Number((entry.liters / entry.fieldWork.areaDoneHa).toFixed(1));
        norm = entry.fieldWork.workType?.fuelNormLitersPerHa || null;
      }

      const entryDayStr = new Date(entry.date).toDateString();
      const isToday = entryDayStr === todayStr;
      const canEdit = isManager || isToday;

      if (isManager) {
        return { ...entry, calculatedLPerHa: lPerHa, fuelNorm: norm, isToday, canEdit };
      }

      const { pricePerLiter, totalCost, ...safeEntry } = entry;
      return { ...safeEntry, calculatedLPerHa: lPerHa, fuelNorm: norm, isToday, canEdit };
    });

    res.json({
      entries: sanitizedEntries,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Greška pri dohvatanju dnevnika točenja:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju točenja." });
  }
});

// ==========================================
// 3. UNOS NOVOG TOČENJA U MAŠINU (DISPENSING)
// ==========================================
const fuelSourceEnum = z.enum(["CISTERNA", "PUMPA", "KANISTER"]);

const createFuelEntrySchema = z.object({
  machineId: z.string().min(1, "Mašina je obavezna"),
  workerId: z.string().optional().nullable(),
  fuelSource: fuelSourceEnum.default("CISTERNA"),
  fuelType: z.string().default("EURODIZEL"),
  liters: z.number().positive("Količina mora biti veća od 0 litara"),
  fieldWorkId: z.string().optional().nullable(),
  pricePerLiter: z.number().nonnegative().optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  date: z.string().optional().nullable(),
});

router.post("/entries", async (req, res) => {
  try {
    const parsed = createFuelEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    let entryDate = new Date();
    if (data.date) {
      const parsedDate = new Date(data.date);
      if (parsedDate.getUTCHours() === 0 && parsedDate.getUTCMinutes() === 0 && parsedDate.getUTCSeconds() === 0) {
        const now = new Date();
        parsedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      }
      entryDate = parsedDate;
    }
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    // 1. Proveri mašinu
    const machine = await prisma.machine.findUnique({
      where: { id: data.machineId },
    });
    if (!machine) {
      return res.status(404).json({ error: "Izabrana mašina ne postoji u sistemu." });
    }

    // 2. Proveri radnika - za radnika je hardkodovan njegov profil
    let targetWorkerId = data.workerId;
    if (!isManager || !targetWorkerId) {
      const userNameParts = (req.user.name || "").trim().split(" ");
      const firstName = userNameParts[0] || "";
      const linkedWorker = await prisma.worker.findFirst({
        where: {
          OR: [
            { userId: req.user.id },
            ...(firstName ? [{ name: { contains: firstName, mode: "insensitive" } }] : []),
          ],
        },
      });
      if (linkedWorker) {
        targetWorkerId = linkedWorker.id;
      } else if (!targetWorkerId) {
        const anyWorker = await prisma.worker.findFirst({ where: { isActive: true } });
        if (anyWorker) targetWorkerId = anyWorker.id;
      }
    }

    if (!targetWorkerId) {
      return res.status(400).json({ error: "Radnik (točilac) je obavezan." });
    }

    const worker = await prisma.worker.findUnique({
      where: { id: targetWorkerId },
    });
    if (!worker) {
      return res.status(404).json({ error: "Izabrani radnik ne postoji." });
    }

    // 3. Proveri stanje cisterne ako se toči iz interne cisterne
    let effectivePricePerLiter = data.pricePerLiter;
    if (data.fuelSource === "CISTERNA") {
      const suppliesAgg = await prisma.fuelSupply.aggregate({
        _sum: { liters: true, totalCost: true },
      });
      const dispensedAgg = await prisma.fuelEntry.aggregate({
        where: { fuelSource: "CISTERNA" },
        _sum: { liters: true },
      });

      const currentLitersInTank = (suppliesAgg._sum.liters || 0) - (dispensedAgg._sum.liters || 0);

      if (currentLitersInTank < data.liters) {
        return res.status(400).json({
          error: `Nedovoljno goriva u cisterni firme. Trenutno stanje je ${Math.max(0, currentLitersInTank).toFixed(1)} L, a uneto je ${data.liters} L.`,
        });
      }

      // Ako nije uneta cena, preuzmi prosečnu ponderisanu cenu cisterne
      if (!effectivePricePerLiter) {
        effectivePricePerLiter = (suppliesAgg._sum.liters || 0) > 0
          ? Number(((suppliesAgg._sum.totalCost || 0) / suppliesAgg._sum.liters).toFixed(2))
          : 171.66;
      }
    }

    // 4. POSLOVNA LOGIKA: DETEKCIJA ANOMALIJA
    let hasAnomaly = false;
    const anomalyReasons = [];

    // Pravilo A: Fizički kapacitet rezervoara mašine - STRIKTNA ZABRANA!
    const tankCapacity = machine.tankCapacityLiters || 250;
    if (data.liters > tankCapacity) {
      return res.status(400).json({
        error: `Nije moguće sipati više od maksimalnog kapaciteta rezervoara mašine "${machine.name}" (${tankCapacity} L). Pokušano sipanje: ${data.liters} L.`,
      });
    }

    // Pravilo B: Automatsko povezivanje sa radom i provera normativa L/ha iz Cenovnika
    let linkedFieldWork = null;
    if (data.fieldWorkId) {
      linkedFieldWork = await prisma.fieldWork.findUnique({
        where: { id: data.fieldWorkId },
        include: { workType: true, parcel: true },
      });
    } else {
      // Automatski potraži rad za tu mašinu tog kalendarskog dana
      linkedFieldWork = await prisma.fieldWork.findFirst({
        where: {
          machineId: machine.id,
          date: {
            gte: new Date(new Date(entryDate).setHours(0, 0, 0, 0)),
            lte: new Date(new Date(entryDate).setHours(23, 59, 59, 999)),
          },
        },
        include: { workType: true, parcel: true },
      });
    }

    if (linkedFieldWork) {
      const area = linkedFieldWork.areaDoneHa;
      const workType = linkedFieldWork.workType;
      if (area > 0 && workType && workType.fuelNormLitersPerHa) {
        const actualLPerHa = data.liters / area;
        const norm = workType.fuelNormLitersPerHa;
        const maxAllowed = norm * 1.25; // +25% tolerancija

        if (actualLPerHa > maxAllowed) {
          hasAnomaly = true;
          const diffPct = Math.round(((actualLPerHa - norm) / norm) * 100);
          anomalyReasons.push(
            `Potrošnja ${actualLPerHa.toFixed(1)} L/ha na poslu "${workType.name}" prelazi normativ od ${norm} L/ha (+${diffPct}%)`
          );
        }
      }
    } else {
      // Pravilo D: Sipano > 30 L u poljoprivrednu mašinu (Traktor, Kombajn) a nema rada na njivi u 24h
      const isFieldHeavyMachine = ["TRAKTOR", "KOMBAJN"].includes(machine.type);
      if (isFieldHeavyMachine && data.liters >= 35) {
        const oneDayAgo = new Date(entryDate.getTime() - 24 * 60 * 60 * 1000);
        const oneDayAfter = new Date(entryDate.getTime() + 24 * 60 * 60 * 1000);

        const recentWork = await prisma.fieldWork.findFirst({
          where: {
            machineId: machine.id,
            date: { gte: oneDayAgo, lte: oneDayAfter },
          },
        });

        const recentOrder = await prisma.workOrder.findFirst({
          where: {
            machineId: machine.id,
            orderDate: { gte: oneDayAgo, lte: oneDayAfter },
          },
        });

        if (!recentWork && !recentOrder) {
          hasAnomaly = true;
          anomalyReasons.push(
            `Sipano ${data.liters} L goriva u mašinu "${machine.name}", a u proteklih 24h nema evidentiranog rada na parceli niti radnog naloga`
          );
        }
      }
    }

    // Izračunaj finansije - ako radnik nije uneo cenu (ili toči sa pumpe/kanistera), uzima se automatski
    // ponderisana cena cisterne ili referentna cena evrodizela iz Cenovnika (171.66 RSD/L)
    if (!effectivePricePerLiter) {
      effectivePricePerLiter = 171.66;
    }
    const calculatedTotalCost = Number((data.liters * effectivePricePerLiter).toFixed(2));

    // 5. TRANSAKCIJA: Upis točenja + ažuriranje nivoa goriva u mašini + revizorski trag
    const [entry] = await prisma.$transaction([
      prisma.fuelEntry.create({
        data: {
          date: entryDate,
          machineId: data.machineId,
          workerId: targetWorkerId,
          fieldWorkId: data.fieldWorkId || (linkedFieldWork ? linkedFieldWork.id : null),
          fuelSource: data.fuelSource,
          fuelType: data.fuelType,
          liters: data.liters,
          pricePerLiter: effectivePricePerLiter,
          totalCost: calculatedTotalCost,
          hasAnomaly,
          anomalyReason: anomalyReasons.length > 0 ? anomalyReasons.join(". ") : null,
          receiptNumber: data.receiptNumber,
          notes: data.notes,
          createdById: req.user.id,
        },
        include: {
          machine: true,
          worker: true,
          fieldWork: {
            include: { workType: true, parcel: true },
          },
        },
      }),
      // Ažuriraj trenutno stanje goriva u rezervoaru mašine
      prisma.machine.update({
        where: { id: data.machineId },
        data: {
          currentFuelLiters: Math.min(tankCapacity, (machine.currentFuelLiters || 0) + data.liters),
        },
      }),
      // Revizorski trag
      prisma.auditLog.create({
        data: {
          entityType: "FuelEntry",
          entityId: "new-entry", // zameniće se
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Natočeno ${data.liters} L goriva (${data.fuelType}) u mašinu "${machine.name}" [Izvor: ${data.fuelSource}]${
            hasAnomaly ? " [UPITNA POTROŠNJA]" : ""
          }`,
          newValues: {
            machineId: data.machineId,
            machineName: machine.name,
            liters: data.liters,
            fuelSource: data.fuelSource,
            hasAnomaly,
            anomalyReason: anomalyReasons.join(". "),
          },
        },
      }),
    ]);

    // Formatiraj odgovor u zavisnosti od uloge
    if (!isManager) {
      delete entry.pricePerLiter;
      delete entry.totalCost;
    }

    res.status(201).json({
      message: "Točenje goriva uspešno evidentirano.",
      entry,
      hasAnomaly,
      anomalyReason: entry.anomalyReason,
    });
  } catch (error) {
    console.error("Greška pri unosu točenja goriva:", error);
    res.status(500).json({ error: "Greška na serveru pri unosu točenja." });
  }
});

// ==========================================
// 4. IZMENA TOČENJA (DOZVOLJENO RADNIKU SAMO DO KRAJA DANA)
// ==========================================
const updateFuelEntrySchema = z.object({
  liters: z.number().positive("Količina mora biti veća od 0 litara").optional(),
  fuelSource: fuelSourceEnum.optional(),
  fuelType: z.string().optional(),
  fieldWorkId: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  pricePerLiter: z.number().nonnegative().optional().nullable(),
});

router.put("/entries/:id", async (req, res) => {
  try {
    const existing = await prisma.fuelEntry.findUnique({
      where: { id: req.params.id },
      include: { machine: true, worker: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis točenja nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    // Ako je radnik: proverava da li je točenje njegovo i da li je današnji dan
    if (!isManager) {
      const userNameParts = (req.user.name || "").trim().split(" ");
      const firstName = userNameParts[0] || "";
      const linkedWorker = await prisma.worker.findFirst({
        where: {
          OR: [
            { userId: req.user.id },
            ...(firstName ? [{ name: { contains: firstName, mode: "insensitive" } }] : []),
          ],
        },
      });
      const isOwner =
        existing.createdById === req.user.id ||
        (linkedWorker && existing.workerId === linkedWorker.id);

      if (!isOwner) {
        return res.status(403).json({ error: "Nemate dozvolu za izmenu ovog točenja." });
      }

      // Provera dana: izmena je dozvoljena SAMO do kraja tog kalendarskog dana!
      const entryDay = new Date(existing.date).toDateString();
      const today = new Date().toDateString();

      if (entryDay !== today) {
        return res.status(403).json({
          error: "Rok za izmenu je istekao. Radnik može izmeniti točenje samo do kraja dana u kojem je zabeleženo. Nakon toga zapis je trajan.",
        });
      }
    }

    const parsed = updateFuelEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const newLiters = data.liters !== undefined ? data.liters : existing.liters;
    const diffLiters = newLiters - existing.liters;
    const newSource = data.fuelSource || existing.fuelSource;

    // Ako je točenje iz cisterne i povećava se količina, proveri stanje u cisterni
    if (newSource === "CISTERNA" && diffLiters > 0) {
      const suppliesAgg = await prisma.fuelSupply.aggregate({
        _sum: { liters: true, totalCost: true },
      });
      const dispensedAgg = await prisma.fuelEntry.aggregate({
        where: { fuelSource: "CISTERNA" },
        _sum: { liters: true },
      });

      const currentLitersInTank = (suppliesAgg._sum.liters || 0) - (dispensedAgg._sum.liters || 0);

      if (currentLitersInTank < diffLiters) {
        return res.status(400).json({
          error: `Nedovoljno goriva u cisterni firme za dopunu od ${diffLiters} L. Trenutno stanje: ${currentLitersInTank.toFixed(1)} L.`,
        });
      }
    }

    // Detekcija anomalija za novu vrednost
    let hasAnomaly = false;
    const anomalyReasons = [];

    const tankCapacity = existing.machine.tankCapacityLiters || 250;
    if (newLiters > tankCapacity) {
      return res.status(400).json({
        error: `Nije moguće sipati više od maksimalnog kapaciteta rezervoara mašine "${existing.machine.name}" (${tankCapacity} L). Pokušano sipanje: ${newLiters} L.`,
      });
    }

    // Proračun cene
    let effectivePrice = existing.pricePerLiter || 171.66;
    if (isManager && data.pricePerLiter !== undefined) {
      effectivePrice = data.pricePerLiter;
    }
    const newTotalCost = effectivePrice ? Number((newLiters * effectivePrice).toFixed(2)) : null;

    const [updatedEntry] = await prisma.$transaction([
      prisma.fuelEntry.update({
        where: { id: req.params.id },
        data: {
          ...(data.liters !== undefined && { liters: data.liters }),
          ...(data.fuelSource && { fuelSource: data.fuelSource }),
          ...(data.fuelType && { fuelType: data.fuelType }),
          ...(data.fieldWorkId !== undefined && { fieldWorkId: data.fieldWorkId }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.receiptNumber !== undefined && { receiptNumber: data.receiptNumber }),
          ...(isManager && data.pricePerLiter !== undefined && {
            pricePerLiter: data.pricePerLiter,
            totalCost: newTotalCost,
          }),
          hasAnomaly,
          anomalyReason: anomalyReasons.length > 0 ? anomalyReasons.join(". ") : null,
        },
        include: {
          machine: true,
          worker: true,
          fieldWork: {
            include: { workType: true, parcel: true },
          },
        },
      }),
      // Ažuriraj stanje na mašini ako je promenjena količina
      prisma.machine.update({
        where: { id: existing.machineId },
        data: {
          ...(diffLiters !== 0 && {
            currentFuelLiters: Math.max(0, (existing.machine.currentFuelLiters || 0) + diffLiters),
          }),
        },
      }),
      prisma.auditLog.create({
        data: {
          entityType: "FuelEntry",
          entityId: existing.id,
          action: "IZMENA",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Izmenjeno točenje u mašinu "${existing.machine.name}": sa ${existing.liters} L na ${newLiters} L`,
          oldValues: existing,
          newValues: { liters: newLiters, fuelSource: newSource },
        },
      }),
    ]);

    res.json({
      message: "Točenje goriva uspešno izmenjeno.",
      entry: updatedEntry,
    });
  } catch (error) {
    console.error("Greška pri izmeni točenja goriva:", error);
    res.status(500).json({ error: "Greška na serveru pri izmeni točenja." });
  }
});

// ==========================================
// 5. BRISANJE / STORNO TOČENJA
// ==========================================
router.delete("/entries/:id", requireManager, async (req, res) => {
  try {
    const entry = await prisma.fuelEntry.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });
    if (!entry) {
      return res.status(404).json({ error: "Zapis točenja nije pronađen." });
    }

    await prisma.$transaction([
      prisma.fuelEntry.delete({ where: { id: req.params.id } }),
      // Umanji gorivo na mašini
      prisma.machine.update({
        where: { id: entry.machineId },
        data: {
          currentFuelLiters: Math.max(0, (entry.machine.currentFuelLiters || 0) - entry.liters),
        },
      }),
      prisma.auditLog.create({
        data: {
          entityType: "FuelEntry",
          entityId: entry.id,
          action: "STORNO",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Stornirano točenje ${entry.liters} L goriva u mašinu "${entry.machine.name}"`,
          oldValues: entry,
        },
      }),
    ]);

    res.json({ message: "Zapis o točenju goriva uspešno storniran." });
  } catch (error) {
    console.error("Greška pri brisanju točenja:", error);
    res.status(500).json({ error: "Greška na serveru pri storniranju točenja." });
  }
});

// ==========================================
// 5. ULAZ GORIVA U CISTERNU (PRIJEM CISTERNE)
// ==========================================
const createFuelSupplySchema = z.object({
  liters: z.number().positive("Količina mora biti veća od 0 litara"),
  pricePerLiter: z.number().positive("Cena po litru mora biti veća od 0"),
  fuelType: z.string().default("EURODIZEL"),
  supplierId: z.string().optional().nullable(),
  supplierName: z.string().max(100).optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  date: z.string().optional().nullable(),
});

router.get("/supplies", async (req, res) => {
  try {
    const canAccess = ["DIREKTOR", "RUKOVODILAC", "MAGACIN"].includes(req.user.role);
    if (!canAccess) {
      return res.status(403).json({ error: "Nemate pristup evidenciji prijema cisterne." });
    }

    const supplies = await prisma.fuelSupply.findMany({
      orderBy: { date: "desc" },
      include: {
        supplier: {
          select: { id: true, name: true, phone: true },
        },
        createdBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    const sanitized = supplies.map((s) => {
      if (isManager) return s;
      const { pricePerLiter, totalCost, ...rest } = s;
      return rest;
    });

    res.json({ supplies: sanitized });
  } catch (error) {
    console.error("Greška pri dohvatanju prijema cisterni:", error);
    res.status(500).json({ error: "Greška na serveru pri učitavanju zaliha cisterne." });
  }
});

router.post("/supplies", async (req, res) => {
  try {
    // Samo Rukovodilac, Direktor ili Magacioner mogu uneti prijem cisterne
    if (!["DIREKTOR", "RUKOVODILAC", "MAGACIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Nemate ovlašćenje za prijem goriva u cisternu." });
    }

    const parsed = createFuelSupplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const supplyDate = data.date ? new Date(data.date) : new Date();
    const totalCost = Number((data.liters * data.pricePerLiter).toFixed(2));

    const supply = await prisma.fuelSupply.create({
      data: {
        date: supplyDate,
        fuelType: data.fuelType,
        liters: data.liters,
        pricePerLiter: data.pricePerLiter,
        totalCost,
        supplierId: data.supplierId,
        supplierName: data.supplierName,
        receiptNumber: data.receiptNumber,
        notes: data.notes,
        createdById: req.user.id,
      },
      include: {
        supplier: true,
      },
    });

    // Revizorski log
    await prisma.auditLog.create({
      data: {
        entityType: "FuelSupply",
        entityId: supply.id,
        action: "KREIRANJE",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Prijem cisterne goriva: ${data.liters} L (${data.fuelType}) po ${data.pricePerLiter} RSD/L od "${
          data.supplierName || supply.supplier?.name || "Dobavljač"
        }" [Ukupno: ${totalCost} RSD]`,
        newValues: {
          liters: data.liters,
          pricePerLiter: data.pricePerLiter,
          totalCost,
          receiptNumber: data.receiptNumber,
        },
      },
    });

    res.status(201).json({
      message: "Prijem cisterne uspešno evidentiran.",
      supply,
    });
  } catch (error) {
    console.error("Greška pri unosu prijema cisterne:", error);
    res.status(500).json({ error: "Greška na serveru pri evidentiranju prijema goriva." });
  }
});

router.delete("/supplies/:id", requireManager, async (req, res) => {
  try {
    const supply = await prisma.fuelSupply.findUnique({
      where: { id: req.params.id },
    });
    if (!supply) {
      return res.status(404).json({ error: "Zapis o prijemu nije pronađen." });
    }

    await prisma.$transaction([
      prisma.fuelSupply.delete({ where: { id: req.params.id } }),
      prisma.auditLog.create({
        data: {
          entityType: "FuelSupply",
          entityId: supply.id,
          action: "STORNO",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Storniran prijem cisterne ${supply.liters} L goriva (faktura: ${supply.receiptNumber || "/"})`,
          oldValues: supply,
        },
      }),
    ]);

    res.json({ message: "Prijem cisterne uspešno storniran." });
  } catch (error) {
    console.error("Greška pri brisanju prijema cisterne:", error);
    res.status(500).json({ error: "Greška na serveru pri brisanju." });
  }
});

// ==========================================
// 6. ANALITIKA POTROŠNJE L/ha PO OPERACIJAMA
// ==========================================
router.get("/analytics/l-per-ha", async (req, res) => {
  try {
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      return res.status(403).json({ error: "Nemate pristup analitici goriva." });
    }

    // 1. Dohvati sve radne operacije
    const workTypes = await prisma.workType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    // 2. Dohvati sva točenja koja su povezana sa radom na njivi
    const fuelWithWork = await prisma.fuelEntry.findMany({
      where: {
        fieldWorkId: { not: null },
      },
      include: {
        fieldWork: {
          include: { workType: true },
        },
        machine: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    // Grupisanje po workTypeId
    const statsMap = {};

    workTypes.forEach((wt) => {
      statsMap[wt.id] = {
        workTypeId: wt.id,
        workTypeName: wt.name,
        category: wt.category,
        normLPerHa: wt.fuelNormLitersPerHa,
        totalLiters: 0,
        totalHa: 0,
        actualLPerHa: null,
        variancePercent: null,
        status: "NEMA_PODATAKA", // "OPTIMALNO", "UPOZORENJE", "ANOMALIJA"
        entriesCount: 0,
      };
    });

    fuelWithWork.forEach((fe) => {
      const wtId = fe.fieldWork?.workTypeId;
      if (wtId && statsMap[wtId]) {
        statsMap[wtId].totalLiters += fe.liters;
        statsMap[wtId].totalHa += fe.fieldWork.areaDoneHa;
        statsMap[wtId].entriesCount += 1;
      }
    });

    const results = Object.values(statsMap)
      .map((item) => {
        if (item.totalHa > 0) {
          item.actualLPerHa = Number((item.totalLiters / item.totalHa).toFixed(1));
          if (item.normLPerHa) {
            const diff = item.actualLPerHa - item.normLPerHa;
            item.variancePercent = Number(((diff / item.normLPerHa) * 100).toFixed(1));

            if (item.variancePercent > 25) {
              item.status = "ANOMALIJA"; // Crveno
            } else if (item.variancePercent > 10) {
              item.status = "UPOZORENJE"; // Narandžasto
            } else {
              item.status = "OPTIMALNO"; // Zeleno
            }
          }
        }
        item.totalLiters = Number(item.totalLiters.toFixed(1));
        item.totalHa = Number(item.totalHa.toFixed(2));
        return item;
      })
      .filter((item) => item.normLPerHa !== null || item.totalLiters > 0);

    res.json({ analytics: results });
  } catch (error) {
    console.error("Greška pri proračunu L/ha analitike:", error);
    res.status(500).json({ error: "Greška na serveru pri proračunu analitike goriva." });
  }
});

// ==========================================
// 7. CENTAR ZA DETEKTOVANE UPITNE POTROŠNJE
// ==========================================
router.get("/anomalies", async (req, res) => {
  try {
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      return res.status(403).json({ error: "Nemate pristup evidenciji upitnih potrošnji." });
    }

    const anomalies = await prisma.fuelEntry.findMany({
      where: { hasAnomaly: true },
      orderBy: { date: "desc" },
      include: {
        machine: {
          select: { id: true, name: true, type: true, tankCapacityLiters: true },
        },
        worker: {
          select: { id: true, name: true, phone: true },
        },
        fieldWork: {
          include: { workType: true, parcel: true },
        },
        createdBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    const sanitized = anomalies.map((a) => {
      if (isManager) return a;
      const { pricePerLiter, totalCost, ...rest } = a;
      return rest;
    });

    res.json({ anomalies: sanitized });
  } catch (error) {
    console.error("Greška pri dohvatanju anomalija goriva:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju anomalija." });
  }
});

export default router;

import { validateFuelFieldWork } from "../lib/fuelFieldWork.js";
import { money, rate, multiplyMoney, divideRate } from "../lib/money.js";
import { inventoryMutation } from "../lib/inventoryTransaction.js";
import { requireWorkerIdentity, getRequestWorker } from "../lib/workerIdentity.js";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";
import { isReceiptImage, MAX_RECEIPT_BYTES, uploadBufferToBunny } from "../lib/bunnyStorage.js";
import { MAX_RECEIPT_JOBS, ReceiptImageError } from "../lib/receiptImage.js";

const router = Router();
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1, fields: 0, parts: 1 },
});

let receiptUploads = 0;
function limitReceiptUploads(req, res, next) {
  // Admit before multer allocates buffers, including requests waiting for decoding.
  if (receiptUploads >= MAX_RECEIPT_JOBS) {
    res.set("Retry-After", "3");
    return res.status(503).json({ error: "Slanje fotografija je zauzeto. Pokušajte ponovo za nekoliko sekundi." });
  }
  receiptUploads++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    receiptUploads--;
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);
router.use(requireWorkerIdentity);

// ==========================================
// 0. UPLOAD SLIKE RAČUNA PREKO BACKENDA
// ==========================================
router.all(["/upload-url", "/upload-config"], (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json({ error: "Koristite /api/fuel/upload za otpremanje slike računa." });
});

function parseReceiptUpload(req, res, next) {
  uploadMemory.single("file")(req, res, (error) => {
    if (error) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: "Pošaljite jednu sliku računa do 32 MB, bez dodatnih polja.",
      });
    }
    next();
  });
}

router.post(["/upload", "/upload-fallback"], limitReceiptUploads, parseReceiptUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Slika računa nije prosleđena." });
    }
    if (!isReceiptImage(req.file.buffer)) {
      return res.status(400).json({ error: "Pošaljite fotografiju računa (JPEG, PNG, WebP, HEIC ili AVIF) do 32 MB." });
    }
    const result = await uploadBufferToBunny(req.file.buffer);
    res.json(result);
  } catch (error) {
    if (error instanceof ReceiptImageError) {
      if (error.status === 503) res.set("Retry-After", "3");
      return res.status(error.status).json({ error: error.message });
    }
    res.status(502).json({ error: "Otpremanje slike računa nije uspelo. Pokušajte ponovo." });
  }
});

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
      ? divideRate(totalSuppliedCost, totalSuppliedLiters)
      : 171.66; // Fallback referentna cena iz cenovnika

    // 3. Ukupno točeno ovog meseca (svi izvori)
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthDispensed, monthBySource] = await Promise.all([
      prisma.fuelEntry.aggregate({
        where: { date: { gte: firstDayOfMonth } },
        _sum: { liters: true, totalCost: true },
      }),
      prisma.fuelEntry.groupBy({
        by: ["fuelSource"],
        where: { date: { gte: firstDayOfMonth } },
        _sum: { liters: true },
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
          currentTankValueRSD: Math.round(multiplyMoney(currentTankLiters, avgCostPerLiter)),
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
      gasStation,
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
    if (gasStation) where.gasStation = String(gasStation).toUpperCase();
    if (hasAnomaly === "true") where.hasAnomaly = true;

    // Ako je korisnik radnik/operater, automatski ograniči SAMO na njegova točenja!
    if (!isManager) {
      where.workerId = req.worker.id;
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
      const entryDayStr = new Date(entry.date).toDateString();
      const isToday = entryDayStr === todayStr;
      const canEdit = isManager || isToday;

      if (isManager || entry.fuelSource === "PUMPA") {
        return { ...entry, isToday, canEdit };
      }

      const { pricePerLiter, totalCost, ...safeEntry } = entry;
      return { ...safeEntry, isToday, canEdit };
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
  gasStation: z.string().max(100).optional().nullable(),
  fuelType: z.string().default("EURODIZEL"),
  liters: z.number().positive("Količina mora biti veća od 0 litara"),
  fieldWorkId: z.string().min(1).optional().nullable(),
  pricePerLiter: z.number().nonnegative().optional().nullable(),
  totalCost: z.number().positive("Iznos računa mora biti veći od 0 RSD").optional().nullable(),
  receiptImageUrl: z.string().url("Neispravan link slike računa").max(1000).optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  date: z.string().optional().nullable(),
});

router.post("/entries", inventoryMutation("fuel", async (req, res, prisma) => {
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
      const worker = await getRequestWorker(req, prisma);
      if (!worker) return res.status(403).json({ error: "Nalog nije povezan sa aktivnim profilom radnika." });
      if (!isManager && data.workerId && data.workerId !== worker.id) {
        return res.status(403).json({ error: "Možete unositi gorivo samo za svoj profil radnika." });
      }
      targetWorkerId = worker.id;
    }

    if (!targetWorkerId) {
      return res.status(400).json({ error: "Radnik (točilac) je obavezan." });
    }

    const worker = await prisma.worker.findUnique({
      where: { id: targetWorkerId },
    });
    if (!worker?.isActive) {
      return res.status(404).json({ error: "Izabrani radnik nije aktivan ili ne postoji." });
    }

    // 3. Poslovno pravilo: U kanister i cisternu za firmu mogu da sipaju samo direktor i rukovodilac
    if (["CISTERNA", "KANISTER"].includes(data.fuelSource)) {
      if (!isManager) {
        return res.status(403).json({
          error: "Nemate ovlašćenje za točenje iz cisterne firme ili kanistera. U kanister i cisternu za firmu mogu sipati isključivo direktor i rukovodilac.",
        });
      }
    }

    // Poslovno pravilo za radnike: mogu da sipaju SAMO na javnoj petrol i europetrol pumpi
    let effectiveGasStation = null;
    if (data.fuelSource === "PUMPA") {
      const stationNormalized = (data.gasStation || "").trim().toUpperCase();
      if (!isManager) {
        if (!["PETROL", "EUROPETROL"].includes(stationNormalized)) {
          return res.status(400).json({
            error: "Radnici mogu sipati gorivo isključivo na javnoj Petrol ili Europetrol pumpi. Molimo izaberite ovlašćenu pumpu (Petrol ili Europetrol).",
          });
        }
        effectiveGasStation = stationNormalized;
      } else {
        effectiveGasStation = stationNormalized || "PETROL";
      }
    } else {
      if (!isManager) {
        return res.status(403).json({
          error: "Radnici mogu sipati gorivo isključivo na javnoj Petrol ili Europetrol pumpi.",
        });
      }
    }

    // Poslovno pravilo za radnike na pumpi (Petrol / Europetrol):
    // Ako je slikao račun, ne mora da unosi cenu (uneće rukovodilac/direktor sa slike računa).
    // Ako NIJE slikao račun, mora da unese cenu!
    const hasReceiptImage = Boolean(data.receiptImageUrl && data.receiptImageUrl.trim().length > 0);
    const hasEnteredPrice = Boolean(
      (data.totalCost !== undefined && data.totalCost !== null && data.totalCost > 0) ||
      (data.pricePerLiter !== undefined && data.pricePerLiter !== null && data.pricePerLiter > 0)
    );

    if (!isManager && data.fuelSource === "PUMPA" && !hasReceiptImage && !hasEnteredPrice) {
      return res.status(400).json({
        error: "Ukoliko niste slikali račun sa pumpe (Petrol / Europetrol), obavezno je da unesete ukupan iznos (cenu) računa.",
      });
    }

    // 4. Proveri stanje cisterne ako se toči iz interne cisterne
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
      if (!effectivePricePerLiter && !data.totalCost) {
        effectivePricePerLiter = (suppliesAgg._sum.liters || 0) > 0
          ? divideRate(suppliesAgg._sum.totalCost || 0, suppliesAgg._sum.liters)
          : 171.66;
      }
    }

    // 4. POSLOVNA LOGIKA: DETEKCIJA ANOMALIJA
    const hasAnomaly = false;
    const anomalyReasons = [];

    // Pravilo A: Fizički kapacitet rezervoara mašine - STRIKTNA ZABRANA!
    const tankCapacity = machine.tankCapacityLiters || 250;
    if ((machine.currentFuelLiters || 0) + data.liters > tankCapacity) {
      return res.status(400).json({ error: "Ukupna količina goriva prelazi kapacitet rezervoara mašine." });
    }
    if (data.liters > tankCapacity) {
      return res.status(400).json({
        error: `Nije moguće sipati više od maksimalnog kapaciteta rezervoara mašine "${machine.name}" (${tankCapacity} L). Pokušano sipanje: ${data.liters} L.`,
      });
    }

    const linkError = await validateFuelFieldWork(prisma, data.fieldWorkId, {
      machineId: machine.id, workerId: targetWorkerId, date: entryDate, isManager,
    });
    if (linkError) return res.status(400).json({ error: linkError });

    let calculatedTotalCost = null;
    if (data.totalCost !== undefined && data.totalCost !== null && data.totalCost > 0) {
      calculatedTotalCost = money(data.totalCost);
      effectivePricePerLiter = divideRate(calculatedTotalCost, data.liters);
    } else if (effectivePricePerLiter !== undefined && effectivePricePerLiter !== null && effectivePricePerLiter > 0) {
      effectivePricePerLiter = rate(effectivePricePerLiter);
      calculatedTotalCost = multiplyMoney(data.liters, effectivePricePerLiter);
    } else if (data.fuelSource === "CISTERNA") {
      effectivePricePerLiter = 171.66;
      calculatedTotalCost = multiplyMoney(data.liters, effectivePricePerLiter);
    } else {
      effectivePricePerLiter = null;
      calculatedTotalCost = null;
    }

    const createStationTag = effectiveGasStation ? ` (${effectiveGasStation})` : "";
    const anomalyTag = hasAnomaly ? " [UPITNA POTROŠNJA]" : "";
    const createAuditDesc = `Natočeno ${data.liters} L goriva (${data.fuelType}) u mašinu "${machine.name}" [Izvor: ${data.fuelSource}${createStationTag}]${anomalyTag}`;

    // 5. TRANSAKCIJA: Upis točenja + ažuriranje nivoa goriva u mašini + revizorski trag
    const entry = await prisma.$transaction(async (tx) => {
      const entry = await tx.fuelEntry.create({
        data: {
          date: entryDate,
          machineId: data.machineId,
          workerId: targetWorkerId,
          fieldWorkId: data.fieldWorkId || null,
          fuelSource: data.fuelSource,
          gasStation: effectiveGasStation,
          fuelType: data.fuelType,
          liters: data.liters,
          pricePerLiter: effectivePricePerLiter,
          totalCost: calculatedTotalCost,
          receiptImageUrl: data.receiptImageUrl || null,
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
      });
      await tx.machine.update({
        where: { id: data.machineId },
        data: {
          currentFuelLiters: Math.min(tankCapacity, (machine.currentFuelLiters || 0) + data.liters),
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "FuelEntry",
          entityId: entry.id,
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: createAuditDesc,
          newValues: {
            machineId: data.machineId,
            machineName: machine.name,
            liters: data.liters,
            fuelSource: data.fuelSource,
            gasStation: effectiveGasStation,
            totalCost: calculatedTotalCost,
            pricePerLiter: effectivePricePerLiter,
            receiptImageUrl: data.receiptImageUrl || null,
            hasAnomaly,
            anomalyReason: anomalyReasons.join(". "),
          },
        },
      });
      return entry;
    });

    // Formatiraj odgovor u zavisnosti od uloge
    if (!isManager && entry.fuelSource !== "PUMPA") {
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
}, { idempotent: true }));

// ==========================================
// 4. IZMENA TOČENJA (DOZVOLJENO RADNIKU SAMO DO KRAJA DANA)
// ==========================================
const updateFuelEntrySchema = z.object({
  liters: z.number().positive("Količina mora biti veća od 0 litara").optional(),
  fuelSource: fuelSourceEnum.optional(),
  gasStation: z.string().max(100).optional().nullable(),
  fuelType: z.string().optional(),
  fieldWorkId: z.string().min(1).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  pricePerLiter: z.number().nonnegative().optional().nullable(),
  totalCost: z.number().positive("Iznos računa mora biti veći od 0 RSD").optional().nullable(),
  receiptImageUrl: z.string().url("Neispravan link slike računa").max(1000).optional().nullable(),
});

router.put("/entries/:id", inventoryMutation("fuel", async (req, res, prisma) => {
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
      const isOwner = existing.workerId === req.worker.id;

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
    const linkError = await validateFuelFieldWork(prisma, data.fieldWorkId, {
      machineId: existing.machineId, workerId: existing.workerId, date: existing.date, isManager,
    });
    if (linkError) return res.status(400).json({ error: linkError });
    const newLiters = data.liters !== undefined ? data.liters : existing.liters;
    const diffLiters = newLiters - existing.liters;
    const newSource = data.fuelSource || existing.fuelSource;

    // Poslovno pravilo: u kanister i cisternu za firmu mogu sipati samo direktor i rukovodilac
    if (["CISTERNA", "KANISTER"].includes(newSource) && !isManager) {
      return res.status(403).json({
        error: "Nemate ovlašćenje za točenje iz cisterne firme ili kanistera. U kanister i cisternu za firmu mogu sipati isključivo direktor i rukovodilac.",
      });
    }

    let effectiveGasStation = data.gasStation !== undefined
      ? (data.gasStation ? data.gasStation.trim().toUpperCase() : null)
      : existing.gasStation;

    if (!isManager) {
      if (newSource !== "PUMPA") {
        return res.status(403).json({
          error: "Radnici mogu sipati gorivo isključivo na javnoj pumpi (Petrol ili Europetrol).",
        });
      }
      if (!["PETROL", "EUROPETROL"].includes(effectiveGasStation)) {
        return res.status(400).json({
          error: "Radnici mogu sipati gorivo isključivo na javnoj Petrol ili Europetrol pumpi. Molimo izaberite ovlašćenu pumpu (Petrol ili Europetrol).",
        });
      }
    }

    // Ako je točenje iz cisterne i povećava se količina, proveri stanje u cisterni
    const cisternDelta = (newSource === "CISTERNA" ? newLiters : 0) -
      (existing.fuelSource === "CISTERNA" ? existing.liters : 0);
    if (cisternDelta > 0) {
      const suppliesAgg = await prisma.fuelSupply.aggregate({
        _sum: { liters: true, totalCost: true },
      });
      const dispensedAgg = await prisma.fuelEntry.aggregate({
        where: { fuelSource: "CISTERNA" },
        _sum: { liters: true },
      });

      const currentLitersInTank = (suppliesAgg._sum.liters || 0) - (dispensedAgg._sum.liters || 0);

      if (currentLitersInTank < cisternDelta) {
        return res.status(400).json({
          error: `Nedovoljno goriva u cisterni firme za dopunu od ${diffLiters} L. Trenutno stanje: ${currentLitersInTank.toFixed(1)} L.`,
        });
      }
    }

    // Detekcija anomalija za novu vrednost
    const hasAnomaly = false;
    const anomalyReasons = [];

    const tankCapacity = existing.machine.tankCapacityLiters || 250;
    if ((existing.machine.currentFuelLiters || 0) + diffLiters > tankCapacity) {
      return res.status(400).json({ error: "Ukupna količina goriva prelazi kapacitet rezervoara mašine." });
    }
    if (newLiters > tankCapacity) {
      return res.status(400).json({
        error: `Nije moguće sipati više od maksimalnog kapaciteta rezervoara mašine "${existing.machine.name}" (${tankCapacity} L). Pokušano sipanje: ${newLiters} L.`,
      });
    }

    const newReceiptImageUrl = data.receiptImageUrl !== undefined ? (data.receiptImageUrl || null) : existing.receiptImageUrl;

    // Proračun cene i ukupnog iznosa (totalCost)
    let effectivePrice = existing.pricePerLiter;
    let newTotalCost = existing.totalCost;

    if (data.totalCost !== undefined) {
      if (data.totalCost !== null && data.totalCost > 0) {
        newTotalCost = money(data.totalCost);
        effectivePrice = divideRate(newTotalCost, newLiters);
      } else {
        newTotalCost = null;
        effectivePrice = null;
      }
    } else if (data.pricePerLiter !== undefined) {
      if (data.pricePerLiter !== null && data.pricePerLiter > 0) {
        effectivePrice = rate(data.pricePerLiter);
        newTotalCost = multiplyMoney(newLiters, effectivePrice);
      } else {
        effectivePrice = null;
        newTotalCost = null;
      }
    } else if (data.liters !== undefined) {
      if (newSource === "PUMPA" && existing.totalCost && existing.totalCost > 0) {
        newTotalCost = existing.totalCost;
        effectivePrice = divideRate(existing.totalCost, newLiters);
      } else if (existing.pricePerLiter && existing.pricePerLiter > 0) {
        effectivePrice = existing.pricePerLiter;
        newTotalCost = multiplyMoney(newLiters, effectivePrice);
      }
    }

    // Poslovno pravilo za radnike na pumpi (Petrol / Europetrol):
    // Ako je slikao račun, ne mora da unosi cenu. Ako nije slikao račun, mora da unese cenu!
    const hasReceipt = Boolean(newReceiptImageUrl && newReceiptImageUrl.trim().length > 0);
    const hasPrice = Boolean(newTotalCost && newTotalCost > 0);

    if (!isManager && newSource === "PUMPA" && !hasReceipt && !hasPrice) {
      return res.status(400).json({
        error: "Ukoliko niste slikali račun sa pumpe (Petrol / Europetrol), obavezno je da unesete ukupan iznos (cenu) računa.",
      });
    }

    const editStationTag = effectiveGasStation ? ` (${effectiveGasStation})` : "";
    const editAuditDesc = `Izmenjeno točenje u mašinu "${existing.machine.name}": sa ${existing.liters} L na ${newLiters} L [Izvor: ${newSource}${editStationTag}]`;

    const [updatedEntry] = await prisma.$transaction([
      prisma.fuelEntry.update({
        where: { id: req.params.id },
        data: {
          ...(data.liters !== undefined && { liters: data.liters }),
          ...(data.fuelSource && { fuelSource: data.fuelSource }),
          ...(effectiveGasStation !== undefined && { gasStation: effectiveGasStation }),
          ...(data.fuelType && { fuelType: data.fuelType }),
          ...(data.fieldWorkId !== undefined && { fieldWorkId: data.fieldWorkId }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.receiptNumber !== undefined && { receiptNumber: data.receiptNumber }),
          pricePerLiter: effectivePrice,
          totalCost: newTotalCost,
          receiptImageUrl: newReceiptImageUrl,
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
          description: editAuditDesc,
          oldValues: existing,
          newValues: {
            liters: newLiters,
            fuelSource: newSource,
            gasStation: effectiveGasStation,
            totalCost: newTotalCost,
            pricePerLiter: effectivePrice,
            receiptImageUrl: newReceiptImageUrl,
          },
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
}));

// ==========================================
// 5. BRISANJE / STORNO TOČENJA
// ==========================================
router.delete("/entries/:id", requireManager, inventoryMutation("fuel", async (req, res, prisma) => {
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
}));

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
    const canAccess = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!canAccess) {
      return res.status(403).json({ error: "Nemate pristup evidenciji prijema cisterne. Prijem cisterne je rezervisan za direktora i rukovodioca." });
    }

    const { dateFrom, dateTo } = req.query;
    const where = {};
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(String(dateFrom));
      if (dateTo) {
        const dTo = new Date(String(dateTo));
        dTo.setHours(23, 59, 59, 999);
        where.date.lte = dTo;
      }
    }

    const supplies = await prisma.fuelSupply.findMany({
      where,
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

router.post("/supplies", inventoryMutation("fuel", async (req, res, prisma) => {
  try {
    // Samo Rukovodilac ili Direktor mogu uneti prijem cisterne
    if (!["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
      return res.status(403).json({ error: "Nemate ovlašćenje za prijem goriva u cisternu. Prijem cisterne mogu uneti isključivo direktor i rukovodilac." });
    }

    const parsed = createFuelSupplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const supplyDate = data.date ? new Date(data.date) : new Date();
    const totalCost = multiplyMoney(data.liters, data.pricePerLiter);

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
}));

router.delete("/supplies/:id", requireManager, inventoryMutation("fuel", async (req, res, prisma) => {
  try {
    const supply = await prisma.fuelSupply.findUnique({
      where: { id: req.params.id },
    });
    if (!supply) {
      return res.status(404).json({ error: "Zapis o prijemu nije pronađen." });
    }

    const received = await prisma.fuelSupply.aggregate({ _sum: { liters: true } });
    const dispensed = await prisma.fuelEntry.aggregate({ where: { fuelSource: "CISTERNA" }, _sum: { liters: true } });
    if ((received._sum.liters || 0) - supply.liters < (dispensed._sum.liters || 0)) {
      return res.status(400).json({ error: "Prijem nije moguće obrisati jer je gorivo već izdato iz cisterne." });
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
}));

// ==========================================
// 6. ANALITIKA POTROŠNJE L/ha PO OPERACIJAMA
// ==========================================
router.get(["/analytics/l-per-ha", "/anomalies"], (req, res) => {
  res.status(410).json({ error: "Potrosnja i normativi su premesteni u direktorsku analitiku.", analyticsUrl: "/api/analytics/fuel-efficiency" });
});

export default router;

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

// Dozvola za rad sa modulom luk: DIREKTOR, RUKOVODILAC, MAGACIN
router.use(requireRole(["DIREKTOR", "RUKOVODILAC", "MAGACIN"]));

// Specifikacija boks paleta i komora hladnjače prema tehničkim podacima gazdinstva:
// - 6 komora ukupno (3 komore sa opremom + 3 komore bez opreme)
// - U svakoj komori staje 720 boks paleta (ukupno 4.320 boksova / 4.800 tona luka)
// - Dimenzija boks palete: 160x120x120 cm, u 1 boks staje 1.100 kg luka
export const BOX_PALLET_SPEC = {
  dimensionsCm: "160x120x120 cm",
  capacityKgPerBox: 1100,
  maxBoxesPerChamber: 720,
  maxKgPerChamber: 800000, // 800 t po komori (3 komore = 2.400 t, 6 komora = 4.800 t)
  totalChambers: 6,
  totalMaxBoxes: 4320,
  totalMaxCapacityKg: 4800000, // 4.800 t
  defaultResponsiblePerson: "Bojan Ćorović",
  defaultPackerWomenCount: 4,
  bagsPerPallet10kg: 100, // Na paletu staje 100 džakova po 10kg (1.000 kg)
  bagsPerPallet5kg: 200,  // Na paletu staje 200 džakova po 5kg (1.000 kg)
};

export const STANDARD_CHAMBERS = [
  { name: "Komora 1", hasEquipment: true, maxBoxes: 720, maxCapacityKg: 800000 },
  { name: "Komora 2", hasEquipment: true, maxBoxes: 720, maxCapacityKg: 800000 },
  { name: "Komora 3", hasEquipment: true, maxBoxes: 720, maxCapacityKg: 800000 },
  { name: "Komora 4", hasEquipment: false, maxBoxes: 720, maxCapacityKg: 800000 },
  { name: "Komora 5", hasEquipment: false, maxBoxes: 720, maxCapacityKg: 800000 },
  { name: "Komora 6", hasEquipment: false, maxBoxes: 720, maxCapacityKg: 800000 },
];

const PACKAGE_DEFAULT_WEIGHTS = {
  DZAK_5KG: 5,
  DZAK_10KG: 10,
  DZAK_25KG: 25,
  DZAMBO_VRECA: 1000,
  BOKS_PALETA: 1100, // 1.100 kg u boks paletu 160x120x120
  RINFUZ: 1,
  DRUGO: 1,
};

/**
 * Pomoćna funkcija za generisanje unikatnog LOT broja
 * Format: LOT-GGGGMMDD-ŠIFRA_PARCELE-XX
 */
async function generateLotNumber(parcelCode, dateObj = new Date()) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const cleanCode = String(parcelCode || "P00")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  const prefix = `LOT-${yyyy}${mm}${dd}-${cleanCode}`;

  const existingCount = await prisma.onionLot.count({
    where: {
      lotNumber: { startsWith: prefix },
    },
  });

  let seq = existingCount + 1;
  while (true) {
    const candidate = `${prefix}-${String(seq).padStart(2, "0")}`;
    const found = await prisma.onionLot.findUnique({
      where: { lotNumber: candidate },
      select: { id: true },
    });
    if (!found) return candidate;
    seq++;
  }
}

/**
 * Pomoćna funkcija za generisanje broja otpremnice
 * Format: OTP-GGGG-XXXX
 */
async function generateDispatchNumber(dateObj = new Date()) {
  const yyyy = dateObj.getFullYear();
  const prefix = `OTP-${yyyy}-`;

  const count = await prisma.onionShipment.count({
    where: {
      dispatchNumber: { startsWith: prefix },
    },
  });

  let seq = count + 1;
  while (true) {
    const candidate = `${prefix}${String(seq).padStart(4, "0")}`;
    const found = await prisma.onionShipment.findUnique({
      where: { dispatchNumber: candidate },
      select: { id: true },
    });
    if (!found) return candidate;
    seq++;
  }
}

// =========================================================================
// 0. POMOĆNI ŠIFARNICI ZA FORME (PARCELE, VOZILA, VOZAČI, KUPCI, SPECIFIKACIJA)
// =========================================================================
router.get("/lookup", async (req, res) => {
  try {
    const [parcels, machines, workers, buyers, activeLots, availablePackagings] = await Promise.all([
      prisma.parcel.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
      }),
      prisma.machine.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.worker.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.partner.findMany({
        where: {
          isActive: true,
          type: { in: ["KUPAC", "OBA"] },
        },
        orderBy: { name: "asc" },
      }),
      prisma.onionLot.findMany({
        where: { status: { in: ["NA_STANJU", "U_OBRADI"] } },
        include: {
          parcel: { select: { id: true, code: true, name: true, areaHa: true, currentCrop: true } },
          storageEntries: true,
          packagings: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.onionPackaging.findMany({
        where: { availableWeightKg: { gt: 0 } },
        include: {
          lot: {
            include: {
              parcel: { select: { id: true, code: true, name: true } },
            },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    const enrichedActiveLots = activeLots.map((lot) => {
      const totalPackedEverKg = lot.packagings.reduce((sum, p) => sum + (p.totalWeightKg || 0), 0);
      const unpackedQualityKg = Math.max(0, (lot.sortedQualityKg || 0) - totalPackedEverKg);
      const storedRawKg = lot.storageEntries.reduce(
        (sum, e) => sum + Math.max(0, e.currentQuantityKg || 0),
        0
      );
      const unstoredRawKg = Math.max(0, (lot.rawStockKg || 0) - storedRawKg);

      return {
        ...lot,
        unpackedQualityKg,
        storedRawKg,
        unstoredRawKg,
      };
    });

    res.json({
      parcels,
      machines,
      workers,
      buyers,
      activeLots: enrichedActiveLots,
      availablePackagings,
      spec: BOX_PALLET_SPEC,
      standardChambers: STANDARD_CHAMBERS,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju lookup podataka za luk:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju šifarnika." });
  }
});

// =========================================================================
// 1. CENTRALNI 360° DASHBOARD STANJA LUKA
// =========================================================================
router.get("/dashboard", async (req, res) => {
  try {
    const [lots, storageEntries, packagings, shipments, wastes] = await Promise.all([
      prisma.onionLot.findMany({
        include: {
          parcel: { select: { id: true, code: true, name: true, currentCrop: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.onionStorageEntry.findMany({
        include: {
          lot: {
            select: {
              id: true,
              lotNumber: true,
              cropVariety: true,
              parcel: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: { date: "desc" },
      }),
      prisma.onionPackaging.findMany({
        orderBy: { date: "desc" },
      }),
      prisma.onionShipment.findMany({
        include: {
          buyer: { select: { id: true, name: true } },
        },
        orderBy: { date: "desc" },
      }),
      prisma.onionWaste.findMany({
        orderBy: { date: "desc" },
      }),
    ]);

    // 1. Ukupno dovezeno sa njive
    const totalHarvestedKg = lots.reduce((sum, l) => sum + (l.initialQuantityKg || 0), 0);

    // 2. Sirovi luk trenutno na stanju (ukupno nesortirano)
    const totalRawStockKg = lots.reduce((sum, l) => sum + Math.max(0, l.rawStockKg || 0), 0);

    // 3. Inicijalizuj svih 6 standardnih komora hladnjače (3 sa opremom + 3 bez opreme)
    let inColdStorageKg = 0;
    let inWarehouseKg = 0;
    let totalColdStorageBoxes = 0;
    const chamberMap = new Map();

    for (const stdCh of STANDARD_CHAMBERS) {
      chamberMap.set(`HLADNJACA::${stdCh.name}`, {
        storageType: "HLADNJACA",
        locationOrChamber: stdCh.name,
        hasEquipment: stdCh.hasEquipment,
        maxBoxes: stdCh.maxBoxes,
        maxCapacityKg: stdCh.maxCapacityKg,
        totalEnteredKg: 0,
        currentQuantityKg: 0,
        currentBoxes: 0,
        temperatureC: stdCh.hasEquipment ? 1.5 : 4.0,
        humidityPercent: stdCh.hasEquipment ? 72 : 68,
        lotsCount: 0,
        lots: [],
      });
    }

    for (const entry of storageEntries) {
      const cur = Math.max(0, entry.currentQuantityKg || 0);
      if (entry.storageType === "HLADNJACA") {
        inColdStorageKg += cur;
      } else {
        inWarehouseKg += cur;
      }

      const key = `${entry.storageType}::${entry.locationOrChamber}`;
      if (!chamberMap.has(key)) {
        const isUnkWithoutEq =
          entry.locationOrChamber.includes("4") ||
          entry.locationOrChamber.includes("5") ||
          entry.locationOrChamber.includes("6");
        chamberMap.set(key, {
          storageType: entry.storageType,
          locationOrChamber: entry.locationOrChamber,
          hasEquipment: entry.hasEquipment !== undefined ? entry.hasEquipment : !isUnkWithoutEq,
          maxBoxes: entry.storageType === "HLADNJACA" ? 720 : 1000,
          maxCapacityKg: entry.storageType === "HLADNJACA" ? 800000 : 1100000,
          totalEnteredKg: 0,
          currentQuantityKg: 0,
          currentBoxes: 0,
          temperatureC: entry.temperatureC,
          humidityPercent: entry.humidityPercent,
          lotsCount: 0,
          lots: [],
        });
      }
      const ch = chamberMap.get(key);
      ch.totalEnteredKg += entry.quantityKg || 0;
      ch.currentQuantityKg += cur;
      const entryCurrentBoxes =
        entry.boxCount && entry.quantityKg > 0
          ? Math.round((cur / entry.quantityKg) * entry.boxCount)
          : Math.round(cur / BOX_PALLET_SPEC.capacityKgPerBox);
      ch.currentBoxes += entryCurrentBoxes;

      if (entry.storageType === "HLADNJACA") {
        totalColdStorageBoxes += entryCurrentBoxes;
      }

      if (entry.temperatureC !== null && entry.temperatureC !== undefined) {
        ch.temperatureC = entry.temperatureC;
      }
      if (entry.humidityPercent !== null && entry.humidityPercent !== undefined) {
        ch.humidityPercent = entry.humidityPercent;
      }
      if (cur > 0 && entry.lot) {
        ch.lotsCount += 1;
        ch.lots.push({
          entryId: entry.id,
          lotNumber: entry.lot.lotNumber,
          parcelName: entry.lot.parcel?.name || "",
          currentQuantityKg: cur,
          currentBoxes: entryCurrentBoxes,
        });
      }
    }

    const allocatedStorageKg = inColdStorageKg + inWarehouseKg;
    const unallocatedRawKg = Math.max(0, totalRawStockKg - allocatedStorageKg);

    // 4. Sortirano I klasa, sitan luk i spakovano
    const totalSortedQualityKg = lots.reduce((sum, l) => sum + (l.sortedQualityKg || 0), 0);
    const smallOnionStockKg = lots.reduce((sum, l) => sum + (l.sortedSmallKg || 0), 0);

    const totalPackagedEverKg = packagings.reduce((sum, p) => sum + (p.totalWeightKg || 0), 0);
    const unpackedQualityKg = Math.max(0, totalSortedQualityKg - totalPackagedEverKg);

    const packagedStockKg = packagings.reduce((sum, p) => sum + Math.max(0, p.availableWeightKg || 0), 0);
    const packagedPackagesCount = packagings.reduce((sum, p) => sum + Math.max(0, p.availableCount || 0), 0);
    const packagedPalletsCount = Number((packagedStockKg / 1000).toFixed(1)); // 1 paleta = 100x10kg ili 200x5kg = 1.000kg

    const packagedByTypeMap = {};
    for (const p of packagings) {
      if (!packagedByTypeMap[p.packageType]) {
        packagedByTypeMap[p.packageType] = {
          packageType: p.packageType,
          availableCount: 0,
          availableWeightKg: 0,
          availablePallets: 0,
          totalPackedCount: 0,
          totalPackedWeightKg: 0,
        };
      }
      const availKg = Math.max(0, p.availableWeightKg || 0);
      packagedByTypeMap[p.packageType].availableCount += Math.max(0, p.availableCount || 0);
      packagedByTypeMap[p.packageType].availableWeightKg += availKg;
      packagedByTypeMap[p.packageType].availablePallets = Number(
        (packagedByTypeMap[p.packageType].availableWeightKg / 1000).toFixed(1)
      );
      packagedByTypeMap[p.packageType].totalPackedCount += p.packageCount || 0;
      packagedByTypeMap[p.packageType].totalPackedWeightKg += p.totalWeightKg || 0;
    }

    // 5. Isporučeno kupcima
    const shippedKg = shipments.reduce((sum, s) => sum + (s.totalWeightKg || 0), 0);
    const shippedPackagesCount = shipments.reduce((sum, s) => sum + (s.totalPackagesCount || 0), 0);
    const shippedTotalValue = shipments.reduce((sum, s) => sum + (s.totalValue || 0), 0);

    // 6. Ukupan otpis i kalo (sortiranje + skladište)
    const sortingWasteKg = lots.reduce((sum, l) => sum + (l.sortedWasteKg || 0), 0);
    const explicitWasteKg = wastes.reduce((sum, w) => sum + (w.quantityKg || 0), 0);
    const totalWasteKg = lots.reduce((sum, l) => sum + (l.totalWasteKg || 0), 0);
    const wastePercentage =
      totalHarvestedKg > 0 ? Number(((totalWasteKg / totalHarvestedKg) * 100).toFixed(2)) : 0;

    res.json({
      kpi: {
        totalHarvestedKg,
        totalRawStockKg,
        inColdStorageKg,
        totalColdStorageBoxes,
        maxColdStorageBoxes: BOX_PALLET_SPEC.totalMaxBoxes,
        maxColdStorageKg: BOX_PALLET_SPEC.totalMaxCapacityKg,
        inWarehouseKg: inWarehouseKg + unallocatedRawKg,
        explicitWarehouseKg: inWarehouseKg,
        unallocatedRawKg,
        totalSortedQualityKg,
        unpackedQualityKg,
        packagedStockKg,
        packagedPackagesCount,
        packagedPalletsCount,
        smallOnionStockKg,
        shippedKg,
        shippedPackagesCount,
        shippedTotalValue,
        sortingWasteKg,
        explicitWasteKg,
        totalWasteKg,
        wastePercentage,
        activeLotsCount: lots.filter((l) => l.status !== "ARHIVIRAN" && l.status !== "ISPORUCEN").length,
        totalLotsCount: lots.length,
        responsiblePerson: BOX_PALLET_SPEC.defaultResponsiblePerson,
      },
      spec: BOX_PALLET_SPEC,
      packagedByType: Object.values(packagedByTypeMap),
      chambersSummary: Array.from(chamberMap.values()),
    });
  } catch (error) {
    console.error("Greška na /api/onion/dashboard:", error);
    res.status(500).json({ error: "Greška pri učitavanju 360° stanja luka." });
  }
});

// =========================================================================
// 2. PREGLED SVIH LOT-OVA
// =========================================================================
router.get("/lots", async (req, res) => {
  try {
    const { parcelId, status, search, page, limit, all } = req.query;

    const where = {};
    if (parcelId && parcelId !== "ALL") {
      where.parcelId = String(parcelId);
    }
    if (status && status !== "ALL") {
      where.status = String(status);
    }
    if (search) {
      const s = String(search).trim();
      where.OR = [
        { lotNumber: { contains: s, mode: "insensitive" } },
        { cropVariety: { contains: s, mode: "insensitive" } },
        { parcel: { name: { contains: s, mode: "insensitive" } } },
        { parcel: { code: { contains: s, mode: "insensitive" } } },
      ];
    }

    if (all === "true") {
      const lots = await prisma.onionLot.findMany({
        where,
        include: {
          parcel: { select: { id: true, code: true, name: true, areaHa: true, currentCrop: true } },
          storageEntries: true,
          packagings: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const enrichedLots = lots.map((lot) => {
        const totalPackedEverKg = lot.packagings.reduce((sum, p) => sum + (p.totalWeightKg || 0), 0);
        const unpackedQualityKg = Math.max(0, (lot.sortedQualityKg || 0) - totalPackedEverKg);
        const storedRawKg = lot.storageEntries.reduce(
          (sum, e) => sum + Math.max(0, e.currentQuantityKg || 0),
          0
        );
        const unstoredRawKg = Math.max(0, (lot.rawStockKg || 0) - storedRawKg);

        return {
          ...lot,
          unpackedQualityKg,
          storedRawKg,
          unstoredRawKg,
        };
      });

      return res.json({ lots: enrichedLots });
    }

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [total, lots] = await Promise.all([
      prisma.onionLot.count({ where }),
      prisma.onionLot.findMany({
        where,
        include: {
          parcel: { select: { id: true, code: true, name: true, areaHa: true, currentCrop: true } },
          storageEntries: true,
          packagings: true,
          _count: {
            select: {
              harvestArrivals: true,
              storageEntries: true,
              sortings: true,
              packagings: true,
              shipments: true,
              wastes: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    const enrichedLots = lots.map((lot) => {
      const totalPackedEverKg = lot.packagings.reduce((sum, p) => sum + (p.totalWeightKg || 0), 0);
      const unpackedQualityKg = Math.max(0, (lot.sortedQualityKg || 0) - totalPackedEverKg);
      const storedRawKg = lot.storageEntries.reduce(
        (sum, e) => sum + Math.max(0, e.currentQuantityKg || 0),
        0
      );
      const unstoredRawKg = Math.max(0, (lot.rawStockKg || 0) - storedRawKg);

      return {
        ...lot,
        unpackedQualityKg,
        storedRawKg,
        unstoredRawKg,
      };
    });

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      lots: enrichedLots,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju LOT-ova:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju LOT-ova." });
  }
});

// =========================================================================
// 3. DOVOZ SA NJIVE (HARVEST ARRIVALS)
// =========================================================================
router.get("/harvest", async (req, res) => {
  try {
    const { parcelId, lotId, search, page, limit } = req.query;
    const where = {};

    if (parcelId && parcelId !== "ALL") where.parcelId = String(parcelId);
    if (lotId && lotId !== "ALL") where.lotId = String(lotId);
    if (search) {
      const s = String(search).trim();
      where.OR = [
        { lot: { lotNumber: { contains: s, mode: "insensitive" } } },
        { parcel: { name: { contains: s, mode: "insensitive" } } },
        { trailerInfo: { contains: s, mode: "insensitive" } },
        { notes: { contains: s, mode: "insensitive" } },
      ];
    }

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [total, arrivals] = await Promise.all([
      prisma.onionHarvestArrival.count({ where }),
      prisma.onionHarvestArrival.findMany({
        where,
        include: {
          lot: true,
          parcel: { select: { id: true, code: true, name: true, areaHa: true, currentCrop: true } },
          vehicle: { select: { id: true, name: true, type: true, regNumber: true } },
          driver: { select: { id: true, name: true, phone: true } },
          supervisor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      arrivals,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju dovoza sa njive:", error);
    res.status(500).json({ error: "Greška pri dohvatanju dovoza sa njive." });
  }
});

const harvestSchema = z.object({
  date: z.string().optional(),
  parcelId: z.string().min(1, "Parcela je obavezna."),
  existingLotId: z.string().optional().nullable(),
  customLotNumber: z.string().optional().nullable(),
  cropVariety: z.string().optional().nullable(),
  quantityKg: z.number().positive("Količina mora biti veća od 0 kg."),
  boxCount: z.number().int().positive().optional().nullable(),
  vehicleId: z.string().optional().nullable(),
  driverId: z.string().optional().nullable(),
  trailerInfo: z.string().optional().nullable(),
  autoStore: z.boolean().optional(),
  storageType: z.enum(["HLADNJACA", "MAGACIN"]).optional(),
  locationOrChamber: z.string().optional().nullable(),
  hasEquipment: z.boolean().optional(),
  temperatureC: z.number().optional().nullable(),
  humidityPercent: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/harvest", async (req, res) => {
  try {
    const parsed = harvestSchema.safeParse({
      ...req.body,
      quantityKg: Number(req.body.quantityKg),
      boxCount:
        req.body.boxCount !== undefined && req.body.boxCount !== "" && req.body.boxCount !== null
          ? Number(req.body.boxCount)
          : Math.round(Number(req.body.quantityKg || 0) / BOX_PALLET_SPEC.capacityKgPerBox),
      temperatureC:
        req.body.temperatureC !== undefined && req.body.temperatureC !== "" && req.body.temperatureC !== null
          ? Number(req.body.temperatureC)
          : null,
      humidityPercent:
        req.body.humidityPercent !== undefined && req.body.humidityPercent !== "" && req.body.humidityPercent !== null
          ? Number(req.body.humidityPercent)
          : null,
    });

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const data = parsed.data;
    const arrivalDate = data.date ? new Date(data.date) : new Date();

    const parcel = await prisma.parcel.findUnique({ where: { id: data.parcelId } });
    if (!parcel) {
      return res.status(404).json({ error: "Izabrana parcela nije pronađena." });
    }

    const result = await prisma.$transaction(async (tx) => {
      let lot;

      if (data.existingLotId) {
        const existingLot = await tx.onionLot.findUnique({ where: { id: data.existingLotId } });
        if (!existingLot) {
          throw new Error("Izabrani LOT ne postoji.");
        }
        lot = await tx.onionLot.update({
          where: { id: existingLot.id },
          data: {
            initialQuantityKg: existingLot.initialQuantityKg + data.quantityKg,
            rawStockKg: existingLot.rawStockKg + data.quantityKg,
            ...(data.cropVariety && !existingLot.cropVariety ? { cropVariety: data.cropVariety } : {}),
          },
        });
      } else {
        const lotNumber =
          data.customLotNumber && data.customLotNumber.trim()
            ? data.customLotNumber.trim().toUpperCase()
            : await generateLotNumber(parcel.code, arrivalDate);

        lot = await tx.onionLot.create({
          data: {
            lotNumber,
            status: "NA_STANJU",
            parcelId: parcel.id,
            cropVariety: data.cropVariety || parcel.currentCrop || "Žuti luk",
            initialQuantityKg: data.quantityKg,
            rawStockKg: data.quantityKg,
            notes: data.notes || null,
          },
        });
      }

      const arrival = await tx.onionHarvestArrival.create({
        data: {
          date: arrivalDate,
          lotId: lot.id,
          parcelId: parcel.id,
          quantityKg: data.quantityKg,
          vehicleId: data.vehicleId || null,
          driverId: data.driverId || null,
          trailerInfo: data.trailerInfo || null,
          supervisorId: req.user.id,
          notes: data.notes || null,
        },
        include: {
          lot: true,
          parcel: true,
          vehicle: true,
          driver: true,
          supervisor: { select: { id: true, name: true } },
        },
      });

      let storageEntry = null;
      if (data.autoStore && data.locationOrChamber && data.locationOrChamber.trim()) {
        const chName = data.locationOrChamber.trim();
        const stdCh = STANDARD_CHAMBERS.find((c) => c.name === chName);
        const hasEq =
          data.hasEquipment !== undefined
            ? data.hasEquipment
            : stdCh
            ? stdCh.hasEquipment
            : true;

        storageEntry = await tx.onionStorageEntry.create({
          data: {
            date: arrivalDate,
            lotId: lot.id,
            storageType: data.storageType || "HLADNJACA",
            locationOrChamber: chName,
            hasEquipment: hasEq,
            boxCount: data.boxCount || Math.round(data.quantityKg / BOX_PALLET_SPEC.capacityKgPerBox),
            quantityKg: data.quantityKg,
            currentQuantityKg: data.quantityKg,
            temperatureC: data.temperatureC,
            humidityPercent: data.humidityPercent,
            supervisorId: req.user.id,
            notes: data.notes
              ? `Uskladišteno pri dovozu: ${data.notes}`
              : "Uskladišteno u boks palete (160x120x120 cm) pri prijemu sa njive",
          },
        });
      }

      return { lot, arrival, storageEntry };
    });

    res.status(201).json({
      ...result,
      message: `Dovoz od ${data.quantityKg.toLocaleString("sr-RS")} kg (${data.boxCount || Math.round(data.quantityKg / 1100)} boks paleta) uspešno evidentiran (${result.lot.lotNumber}).`,
    });
  } catch (error) {
    console.error("Greška pri kreiranju dovoza sa njive:", error);
    res.status(400).json({ error: error.message || "Greška pri evidentiranju dovoza sa njive." });
  }
});

// =========================================================================
// 4. SKLADIŠTENJE U HLADNJAČU / MAGACIN (STORAGE) & IZMENA KOMORA
// =========================================================================
router.get("/storage", async (req, res) => {
  try {
    const { storageType, lotId, onlyActive, page, limit } = req.query;
    const where = {};

    if (storageType && storageType !== "ALL") where.storageType = String(storageType);
    if (lotId && lotId !== "ALL") where.lotId = String(lotId);
    if (onlyActive === "true") where.currentQuantityKg = { gt: 0 };

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [total, entries] = await Promise.all([
      prisma.onionStorageEntry.count({ where }),
      prisma.onionStorageEntry.findMany({
        where,
        include: {
          lot: {
            include: {
              parcel: { select: { id: true, code: true, name: true } },
            },
          },
          supervisor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      entries,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju skladišta:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju skladišta." });
  }
});

const storageSchema = z.object({
  date: z.string().optional(),
  lotId: z.string().min(1, "Izbor LOT-a je obavezan."),
  storageType: z.enum(["HLADNJACA", "MAGACIN"]),
  locationOrChamber: z.string().trim().min(1, "Naziv komore ili lokacije u magacinu je obavezan."),
  hasEquipment: z.boolean().optional(),
  boxCount: z.number().int().positive().optional().nullable(),
  quantityKg: z.number().positive("Količina mora biti veća od 0 kg."),
  temperatureC: z.number().optional().nullable(),
  humidityPercent: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/storage", async (req, res) => {
  try {
    const qtyKg = Number(req.body.quantityKg);
    const parsed = storageSchema.safeParse({
      ...req.body,
      quantityKg: qtyKg,
      boxCount:
        req.body.boxCount !== undefined && req.body.boxCount !== "" && req.body.boxCount !== null
          ? Number(req.body.boxCount)
          : Math.round(qtyKg / BOX_PALLET_SPEC.capacityKgPerBox),
      temperatureC:
        req.body.temperatureC !== undefined && req.body.temperatureC !== "" && req.body.temperatureC !== null
          ? Number(req.body.temperatureC)
          : null,
      humidityPercent:
        req.body.humidityPercent !== undefined && req.body.humidityPercent !== "" && req.body.humidityPercent !== null
          ? Number(req.body.humidityPercent)
          : null,
    });

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const data = parsed.data;

    const lot = await prisma.onionLot.findUnique({
      where: { id: data.lotId },
      include: { storageEntries: true },
    });

    if (!lot) {
      return res.status(404).json({ error: "Izabrani LOT nije pronađen." });
    }

    const alreadyStoredKg = lot.storageEntries.reduce(
      (sum, e) => sum + Math.max(0, e.currentQuantityKg || 0),
      0
    );
    const maxAvailableToStore = Math.max(0, lot.rawStockKg - alreadyStoredKg);

    if (data.quantityKg > maxAvailableToStore + 0.01) {
      return res.status(400).json({
        error: `Preostalo neraspoređenog sirovog luka na LOT-u ${lot.lotNumber} je ${maxAvailableToStore.toLocaleString("sr-RS")} kg.`,
      });
    }

    const stdCh = STANDARD_CHAMBERS.find((c) => c.name === data.locationOrChamber);
    const hasEq =
      data.hasEquipment !== undefined
        ? data.hasEquipment
        : stdCh
        ? stdCh.hasEquipment
        : true;

    const entry = await prisma.onionStorageEntry.create({
      data: {
        date: data.date ? new Date(data.date) : new Date(),
        lotId: lot.id,
        storageType: data.storageType,
        locationOrChamber: data.locationOrChamber,
        hasEquipment: hasEq,
        boxCount: data.boxCount,
        quantityKg: data.quantityKg,
        currentQuantityKg: data.quantityKg,
        temperatureC: data.temperatureC,
        humidityPercent: data.humidityPercent,
        supervisorId: req.user.id,
        notes: data.notes || null,
      },
      include: {
        lot: { include: { parcel: true } },
        supervisor: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({
      entry,
      message: `Uskladišteno ${data.quantityKg.toLocaleString("sr-RS")} kg (${data.boxCount} boksova) u ${data.locationOrChamber}.`,
    });
  } catch (error) {
    console.error("Greška pri unosu u skladište:", error);
    res.status(500).json({ error: "Greška na serveru pri unosu u skladište." });
  }
});

/**
 * PUT /api/onion/storage/:id
 * Izmena komore, broja boks paleta, temperature, vlažnosti ili opreme
 */
router.put("/storage/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.onionStorageEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Zapis u skladištu nije pronađen." });
    }

    const updated = await prisma.onionStorageEntry.update({
      where: { id },
      data: {
        ...(req.body.locationOrChamber !== undefined && {
          locationOrChamber: String(req.body.locationOrChamber).trim(),
        }),
        ...(req.body.hasEquipment !== undefined && {
          hasEquipment: Boolean(req.body.hasEquipment),
        }),
        ...(req.body.boxCount !== undefined && {
          boxCount: req.body.boxCount !== null && req.body.boxCount !== "" ? Number(req.body.boxCount) : null,
        }),
        ...(req.body.currentQuantityKg !== undefined && {
          currentQuantityKg: Number(req.body.currentQuantityKg),
        }),
        ...(req.body.temperatureC !== undefined && {
          temperatureC:
            req.body.temperatureC !== null && req.body.temperatureC !== ""
              ? Number(req.body.temperatureC)
              : null,
        }),
        ...(req.body.humidityPercent !== undefined && {
          humidityPercent:
            req.body.humidityPercent !== null && req.body.humidityPercent !== ""
              ? Number(req.body.humidityPercent)
              : null,
        }),
        ...(req.body.notes !== undefined && { notes: req.body.notes || null }),
      },
      include: {
        lot: { include: { parcel: true } },
        supervisor: { select: { id: true, name: true } },
      },
    });

    res.json({
      entry: updated,
      message: `Podaci za ${updated.locationOrChamber} uspešno ažurirani.`,
    });
  } catch (error) {
    console.error("Greška pri izmeni zapisa skladišta:", error);
    res.status(500).json({ error: "Greška pri ažuriranju podataka komore." });
  }
});

// =========================================================================
// 5. SORTIRANJE & KALIBRACIJA (SORTING)
// =========================================================================
router.get("/sorting", async (req, res) => {
  try {
    const { lotId, page, limit } = req.query;
    const where = {};
    if (lotId && lotId !== "ALL") where.lotId = String(lotId);

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [total, sortings] = await Promise.all([
      prisma.onionSorting.count({ where }),
      prisma.onionSorting.findMany({
        where,
        include: {
          lot: {
            include: {
              parcel: { select: { id: true, code: true, name: true } },
            },
          },
          supervisor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      sortings,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju sortiranja:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju sortiranja." });
  }
});

const sortingSchema = z.object({
  date: z.string().optional(),
  lotId: z.string().min(1, "Izbor LOT-a je obavezan."),
  storageEntryId: z.string().optional().nullable(),
  inputQuantityKg: z.number().positive("Ulazna količina za sortiranje mora biti veća od 0 kg."),
  qualityQuantityKg: z.number().nonnegative("Količina I klase ne može biti negativna."),
  smallQuantityKg: z.number().nonnegative("Količina sitnog luka ne može biti negativna."),
  wasteQuantityKg: z.number().nonnegative("Količina otpada/kala ne može biti negativna."),
  notes: z.string().optional().nullable(),
});

router.post("/sorting", async (req, res) => {
  try {
    const parsed = sortingSchema.safeParse({
      ...req.body,
      inputQuantityKg: Number(req.body.inputQuantityKg),
      qualityQuantityKg: Number(req.body.qualityQuantityKg || 0),
      smallQuantityKg: Number(req.body.smallQuantityKg || 0),
      wasteQuantityKg: Number(req.body.wasteQuantityKg || 0),
    });

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const data = parsed.data;
    const sumOutputs = data.qualityQuantityKg + data.smallQuantityKg + data.wasteQuantityKg;

    if (Math.abs(sumOutputs - data.inputQuantityKg) > 0.5) {
      return res.status(400).json({
        error: `Zbir izlaznih frakcija (${sumOutputs.toLocaleString("sr-RS")} kg) mora odgovarati ulaznoj količini (${data.inputQuantityKg.toLocaleString("sr-RS")} kg).`,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const lot = await tx.onionLot.findUnique({
        where: { id: data.lotId },
        include: {
          storageEntries: {
            where: { currentQuantityKg: { gt: 0 } },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!lot) {
        throw new Error("Izabrani LOT ne postoji.");
      }

      if (data.inputQuantityKg > lot.rawStockKg + 0.01) {
        throw new Error(
          `Na LOT-u ${lot.lotNumber} ima samo ${lot.rawStockKg.toLocaleString("sr-RS")} kg nesortiranog sirovog luka.`
        );
      }

      if (data.storageEntryId) {
        const stEntry = await tx.onionStorageEntry.findUnique({
          where: { id: data.storageEntryId },
        });
        if (!stEntry || stEntry.lotId !== lot.id) {
          throw new Error("Izabrana lokacija skladišta ne pripada ovom LOT-u.");
        }
        if (data.inputQuantityKg > stEntry.currentQuantityKg + 0.01) {
          throw new Error(
            `U lokaciji "${stEntry.locationOrChamber}" ima samo ${stEntry.currentQuantityKg.toLocaleString("sr-RS")} kg ovog LOT-a.`
          );
        }
        await tx.onionStorageEntry.update({
          where: { id: stEntry.id },
          data: {
            currentQuantityKg: Math.max(0, stEntry.currentQuantityKg - data.inputQuantityKg),
          },
        });
      } else if (lot.storageEntries.length > 0) {
        let remainingToDeduct = data.inputQuantityKg;
        for (const entry of lot.storageEntries) {
          if (remainingToDeduct <= 0) break;
          const deduct = Math.min(entry.currentQuantityKg, remainingToDeduct);
          await tx.onionStorageEntry.update({
            where: { id: entry.id },
            data: {
              currentQuantityKg: Math.max(0, entry.currentQuantityKg - deduct),
            },
          });
          remainingToDeduct -= deduct;
        }
      }

      const wastePercentage =
        data.inputQuantityKg > 0
          ? Number(((data.wasteQuantityKg / data.inputQuantityKg) * 100).toFixed(2))
          : 0;

      const sorting = await tx.onionSorting.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          lotId: lot.id,
          storageEntryId: data.storageEntryId || null,
          inputQuantityKg: data.inputQuantityKg,
          qualityQuantityKg: data.qualityQuantityKg,
          smallQuantityKg: data.smallQuantityKg,
          wasteQuantityKg: data.wasteQuantityKg,
          wastePercentage,
          supervisorId: req.user.id,
          notes: data.notes || null,
        },
        include: {
          lot: { include: { parcel: true } },
          supervisor: { select: { id: true, name: true } },
        },
      });

      const updatedLot = await tx.onionLot.update({
        where: { id: lot.id },
        data: {
          rawStockKg: Math.max(0, lot.rawStockKg - data.inputQuantityKg),
          sortedQualityKg: lot.sortedQualityKg + data.qualityQuantityKg,
          sortedSmallKg: lot.sortedSmallKg + data.smallQuantityKg,
          sortedWasteKg: lot.sortedWasteKg + data.wasteQuantityKg,
          totalWasteKg: lot.totalWasteKg + data.wasteQuantityKg,
          status: "U_OBRADI",
        },
      });

      return { sorting, updatedLot };
    });

    res.status(201).json({
      ...result,
      message: `Sortiranje uspešno sačuvano: ${data.qualityQuantityKg.toLocaleString("sr-RS")} kg I klase, ${data.smallQuantityKg.toLocaleString("sr-RS")} kg sitnog, ${data.wasteQuantityKg.toLocaleString("sr-RS")} kg otpada (${result.sorting.wastePercentage}%).`,
    });
  } catch (error) {
    console.error("Greška pri sortiranju luka:", error);
    res.status(400).json({ error: error.message || "Greška pri evidentiranju sortiranja." });
  }
});

// =========================================================================
// 6. PAKOVANJE & PAKERICA (PACKAGING) + OPCIJA IZMENE
// =========================================================================
router.get("/packaging", async (req, res) => {
  try {
    const { lotId, packageType, onlyAvailable, page, limit } = req.query;
    const where = {};

    if (lotId && lotId !== "ALL") where.lotId = String(lotId);
    if (packageType && packageType !== "ALL") where.packageType = String(packageType);
    if (onlyAvailable === "true") where.availableWeightKg = { gt: 0 };

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [total, packagings] = await Promise.all([
      prisma.onionPackaging.count({ where }),
      prisma.onionPackaging.findMany({
        where,
        include: {
          lot: {
            include: {
              parcel: { select: { id: true, code: true, name: true } },
            },
          },
          supervisor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      packagings,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju pakovanja:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju pakovanja." });
  }
});

const packagingSchema = z.object({
  date: z.string().optional(),
  lotId: z.string().min(1, "Izbor LOT-a je obavezan."),
  packageType: z.enum([
    "DZAK_5KG",
    "DZAK_10KG",
    "DZAK_25KG",
    "DZAMBO_VRECA",
    "BOKS_PALETA",
    "RINFUZ",
    "DRUGO",
  ]),
  unitWeightKg: z.number().positive("Težina po jedinici pakovanja mora biti veća od 0."),
  packageCount: z.number().int().positive("Broj džakova/jedinica mora biti ceo pozitivan broj."),
  palletsCount: z.number().positive().optional().nullable(),
  palletNumber: z.string().optional().nullable(),
  packerCount: z.number().int().positive().optional(),
  packerNotes: z.string().optional().nullable(),
  responsiblePerson: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/packaging", async (req, res) => {
  try {
    const pkgType = req.body.packageType || "DZAK_10KG";
    const defaultUnitWeight = PACKAGE_DEFAULT_WEIGHTS[pkgType] || 10;
    const unitWeightKg =
      req.body.unitWeightKg !== undefined && req.body.unitWeightKg !== ""
        ? Number(req.body.unitWeightKg)
        : defaultUnitWeight;
    const packageCount = Number(req.body.packageCount);
    const totalWeightKg = Number((unitWeightKg * packageCount).toFixed(2));
    const computedPalletsCount =
      req.body.palletsCount !== undefined && req.body.palletsCount !== "" && req.body.palletsCount !== null
        ? Number(req.body.palletsCount)
        : Number((totalWeightKg / 1000).toFixed(2)); // 100 džakova po 10kg = 1.000kg = 1 paleta; 200 džakova po 5kg = 1.000kg = 1 paleta

    const parsed = packagingSchema.safeParse({
      ...req.body,
      packageType: pkgType,
      unitWeightKg,
      packageCount,
      palletsCount: computedPalletsCount,
      packerCount:
        req.body.packerCount !== undefined && req.body.packerCount !== ""
          ? Number(req.body.packerCount)
          : BOX_PALLET_SPEC.defaultPackerWomenCount,
    });

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const data = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const lot = await tx.onionLot.findUnique({
        where: { id: data.lotId },
        include: { packagings: true },
      });

      if (!lot) {
        throw new Error("Izabrani LOT ne postoji.");
      }

      const alreadyPackagedKg = lot.packagings.reduce((sum, p) => sum + (p.totalWeightKg || 0), 0);
      const availableSortedQualityKg = Math.max(0, lot.sortedQualityKg - alreadyPackagedKg);

      if (totalWeightKg > availableSortedQualityKg + 0.5) {
        throw new Error(
          `Na LOT-u ${lot.lotNumber} ima ${availableSortedQualityKg.toLocaleString("sr-RS")} kg nespakovanog luka I klase, a pokušavate da spakujete ${totalWeightKg.toLocaleString("sr-RS")} kg.`
        );
      }

      const packaging = await tx.onionPackaging.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          lotId: lot.id,
          packageType: data.packageType,
          unitWeightKg: data.unitWeightKg,
          packageCount: data.packageCount,
          totalWeightKg,
          availableCount: data.packageCount,
          availableWeightKg: totalWeightKg,
          palletsCount: data.palletsCount,
          palletNumber: data.palletNumber || null,
          packerCount: data.packerCount || 4,
          packerNotes: data.packerNotes || null,
          responsiblePerson: data.responsiblePerson || BOX_PALLET_SPEC.defaultResponsiblePerson,
          supervisorId: req.user.id,
          notes: data.notes || null,
        },
        include: {
          lot: { include: { parcel: true } },
          supervisor: { select: { id: true, name: true } },
        },
      });

      const updatedLot = await tx.onionLot.update({
        where: { id: lot.id },
        data: {
          packagedStockKg: lot.packagedStockKg + totalWeightKg,
          status: "U_OBRADI",
        },
      });

      return { packaging, updatedLot };
    });

    res.status(201).json({
      ...result,
      message: `Uspešno spakovano ${data.packageCount} džakova (${data.palletsCount} paleta / ${totalWeightKg.toLocaleString("sr-RS")} kg) na pakerici (${data.packerCount || 4} radnika).`,
    });
  } catch (error) {
    console.error("Greška pri pakovanju luka:", error);
    res.status(400).json({ error: error.message || "Greška pri evidentiranju pakovanja." });
  }
});

/**
 * PUT /api/onion/packaging/:id
 * Izmena podataka o pakovanju i pakerici (broj žena na pakerici, zaduženo lice, paleta, tip džaka 5kg/10kg, broj džakova)
 */
router.put("/packaging/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.onionPackaging.findUnique({
      where: { id },
      include: { lot: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o pakovanju nije pronađen." });
    }

    const newPackageType = req.body.packageType || existing.packageType;
    const newUnitWeightKg =
      req.body.unitWeightKg !== undefined && req.body.unitWeightKg !== ""
        ? Number(req.body.unitWeightKg)
        : existing.unitWeightKg;
    const newPackageCount =
      req.body.packageCount !== undefined && req.body.packageCount !== ""
        ? Number(req.body.packageCount)
        : existing.packageCount;

    const shippedCountAlready = Math.max(0, existing.packageCount - existing.availableCount);
    if (newPackageCount < shippedCountAlready) {
      return res.status(400).json({
        error: `Sa ove partije je već isporučeno ${shippedCountAlready} komada, pa ukupan broj ne može biti manji od toga.`,
      });
    }

    const newTotalWeightKg = Number((newUnitWeightKg * newPackageCount).toFixed(2));
    const newAvailableCount = newPackageCount - shippedCountAlready;
    const newAvailableWeightKg = Number((newAvailableCount * newUnitWeightKg).toFixed(2));
    const weightDiffKg = newAvailableWeightKg - existing.availableWeightKg;
    const newPalletsCount =
      req.body.palletsCount !== undefined && req.body.palletsCount !== ""
        ? Number(req.body.palletsCount)
        : Number((newTotalWeightKg / 1000).toFixed(2));

    const updated = await prisma.$transaction(async (tx) => {
      const pkg = await tx.onionPackaging.update({
        where: { id },
        data: {
          packageType: newPackageType,
          unitWeightKg: newUnitWeightKg,
          packageCount: newPackageCount,
          totalWeightKg: newTotalWeightKg,
          availableCount: newAvailableCount,
          availableWeightKg: newAvailableWeightKg,
          palletsCount: newPalletsCount,
          ...(req.body.palletNumber !== undefined && {
            palletNumber: req.body.palletNumber || null,
          }),
          ...(req.body.packerCount !== undefined && {
            packerCount: Number(req.body.packerCount) || 4,
          }),
          ...(req.body.packerNotes !== undefined && {
            packerNotes: req.body.packerNotes || null,
          }),
          ...(req.body.responsiblePerson !== undefined && {
            responsiblePerson: req.body.responsiblePerson || BOX_PALLET_SPEC.defaultResponsiblePerson,
          }),
          ...(req.body.notes !== undefined && {
            notes: req.body.notes || null,
          }),
        },
        include: {
          lot: { include: { parcel: true } },
          supervisor: { select: { id: true, name: true } },
        },
      });

      if (Math.abs(weightDiffKg) > 0.01) {
        await tx.onionLot.update({
          where: { id: existing.lotId },
          data: {
            packagedStockKg: Math.max(0, existing.lot.packagedStockKg + weightDiffKg),
          },
        });
      }

      return pkg;
    });

    res.json({
      packaging: updated,
      message: "Podaci o pakovanju i pakerici su uspešno izmenjeni.",
    });
  } catch (error) {
    console.error("Greška pri izmeni pakovanja:", error);
    res.status(400).json({ error: error.message || "Greška pri izmeni pakovanja." });
  }
});

// =========================================================================
// 7. ISPORUKA KUPCU & OTPREMNICA (SHIPMENTS)
// =========================================================================
router.get("/shipment", async (req, res) => {
  try {
    const { buyerId, lotId, search, page, limit } = req.query;
    const where = {};

    if (buyerId && buyerId !== "ALL") where.buyerId = String(buyerId);
    if (lotId && lotId !== "ALL") where.lotId = String(lotId);
    if (search) {
      const s = String(search).trim();
      where.OR = [
        { dispatchNumber: { contains: s, mode: "insensitive" } },
        { buyer: { name: { contains: s, mode: "insensitive" } } },
        { lot: { lotNumber: { contains: s, mode: "insensitive" } } },
        { vehicleReg: { contains: s, mode: "insensitive" } },
        { driverName: { contains: s, mode: "insensitive" } },
      ];
    }

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [total, shipments] = await Promise.all([
      prisma.onionShipment.count({ where }),
      prisma.onionShipment.findMany({
        where,
        include: {
          buyer: true,
          lot: {
            include: {
              parcel: { select: { id: true, code: true, name: true } },
            },
          },
          items: {
            include: {
              packaging: true,
            },
          },
          supervisor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      shipments,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju isporuka:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju isporuka." });
  }
});

const shipmentSchema = z.object({
  date: z.string().optional(),
  dispatchNumber: z.string().optional().nullable(),
  buyerId: z.string().min(1, "Izbor kupca je obavezan."),
  packagingId: z.string().min(1, "Izbor spakovane partije / palete je obavezan."),
  packageCount: z.number().int().positive("Broj džakova za isporuku mora biti veći od 0."),
  pricePerKg: z.number().nonnegative().optional().nullable(),
  vehicleReg: z.string().optional().nullable(),
  driverName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/shipment", async (req, res) => {
  try {
    const parsed = shipmentSchema.safeParse({
      ...req.body,
      packageCount: Number(req.body.packageCount),
      pricePerKg:
        req.body.pricePerKg !== undefined && req.body.pricePerKg !== "" && req.body.pricePerKg !== null
          ? Number(req.body.pricePerKg)
          : null,
    });

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const data = parsed.data;
    const shipmentDate = data.date ? new Date(data.date) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const packaging = await tx.onionPackaging.findUnique({
        where: { id: data.packagingId },
        include: { lot: true },
      });

      if (!packaging) {
        throw new Error("Izabrano pakovanje ne postoji.");
      }

      if (data.packageCount > packaging.availableCount) {
        throw new Error(
          `Na izabranoj paleti/pakovanju ima samo ${packaging.availableCount} slobodnih komada.`
        );
      }

      const buyer = await tx.partner.findUnique({ where: { id: data.buyerId } });
      if (!buyer) {
        throw new Error("Izabrani kupac ne postoji u šifarniku partnera.");
      }

      const totalWeightKg = Number((data.packageCount * packaging.unitWeightKg).toFixed(2));
      const totalValue =
        data.pricePerKg !== null && data.pricePerKg !== undefined
          ? Number((totalWeightKg * data.pricePerKg).toFixed(2))
          : null;

      const dispatchNumber =
        data.dispatchNumber && data.dispatchNumber.trim()
          ? data.dispatchNumber.trim().toUpperCase()
          : await generateDispatchNumber(shipmentDate);

      await tx.onionPackaging.update({
        where: { id: packaging.id },
        data: {
          availableCount: packaging.availableCount - data.packageCount,
          availableWeightKg: Math.max(0, packaging.availableWeightKg - totalWeightKg),
        },
      });

      const shipment = await tx.onionShipment.create({
        data: {
          date: shipmentDate,
          dispatchNumber,
          buyerId: buyer.id,
          lotId: packaging.lotId,
          totalWeightKg,
          totalPackagesCount: data.packageCount,
          pricePerKg: data.pricePerKg,
          totalValue,
          vehicleReg: data.vehicleReg || null,
          driverName: data.driverName || null,
          supervisorId: req.user.id,
          notes: data.notes || null,
          items: {
            create: [
              {
                packagingId: packaging.id,
                packageCount: data.packageCount,
                totalWeightKg,
              },
            ],
          },
        },
        include: {
          buyer: true,
          lot: { include: { parcel: true } },
          items: { include: { packaging: true } },
          supervisor: { select: { id: true, name: true } },
        },
      });

      const lot = packaging.lot;
      const newPackagedStockKg = Math.max(0, lot.packagedStockKg - totalWeightKg);
      const newShippedKg = lot.shippedKg + totalWeightKg;
      const isCompletelyShipped = lot.rawStockKg <= 0.1 && newPackagedStockKg <= 0.1;

      await tx.onionLot.update({
        where: { id: lot.id },
        data: {
          packagedStockKg: newPackagedStockKg,
          shippedKg: newShippedKg,
          status: isCompletelyShipped ? "ISPORUCEN" : "U_OBRADI",
        },
      });

      return shipment;
    });

    res.status(201).json({
      shipment: result,
      message: `Otpremnica ${result.dispatchNumber} uspešno kreirana (${result.totalWeightKg.toLocaleString("sr-RS")} kg za kupca ${result.buyer.name}).`,
    });
  } catch (error) {
    console.error("Greška pri kreiranju isporuke:", error);
    res.status(400).json({ error: error.message || "Greška pri evidentiranju isporuke kupcu." });
  }
});

// =========================================================================
// 8. OTPIS & KALO (WASTE)
// =========================================================================
router.get("/waste", async (req, res) => {
  try {
    const { lotId, reason, page, limit } = req.query;
    const where = {};

    if (lotId && lotId !== "ALL") where.lotId = String(lotId);
    if (reason && reason !== "ALL") where.reason = String(reason);

    const take = Math.min(Number(limit) || 25, 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const [allWastesSums, sortingWasteSum, total, wastes] = await Promise.all([
      prisma.onionWaste.groupBy({
        by: ["reason"],
        where,
        _sum: { quantityKg: true },
      }),
      prisma.onionSorting.aggregate({
        where: {
          wasteQuantityKg: { gt: 0 },
          ...(lotId && lotId !== "ALL" ? { lotId: String(lotId) } : {}),
        },
        _sum: { wasteQuantityKg: true },
      }),
      prisma.onionWaste.count({ where }),
      prisma.onionWaste.findMany({
        where,
        include: {
          lot: {
            include: {
              parcel: { select: { id: true, code: true, name: true } },
            },
          },
          supervisor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
    ]);

    const byReason = {
      TRULEZ: 0,
      MEHANICKO_OSTECENJE: 0,
      KALO_SUSENJE: 0,
      PROKLIJAO: 0,
      PRLJAVSTINA_ZEMLJA: 0,
      OSTALO: 0,
      SORTIRANJE_SKART: sortingWasteSum._sum.wasteQuantityKg || 0,
    };

    for (const item of allWastesSums) {
      if (item.reason && byReason[item.reason] !== undefined) {
        byReason[item.reason] = item._sum.quantityKg || 0;
      }
    }

    res.json({
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
      byReason,
      wastes,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju otpisa:", error);
    res.status(500).json({ error: "Greška na serveru pri dohvatanju otpisa i kala." });
  }
});

const wasteSchema = z.object({
  date: z.string().optional(),
  lotId: z.string().min(1, "Izbor LOT-a je obavezan."),
  storageEntryId: z.string().optional().nullable(),
  quantityKg: z.number().positive("Količina otpisa mora biti veća od 0 kg."),
  reason: z.enum([
    "TRULEZ",
    "MEHANICKO_OSTECENJE",
    "KALO_SUSENJE",
    "PROKLIJAO",
    "PRLJAVSTINA_ZEMLJA",
    "OSTALO",
  ]),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/waste", async (req, res) => {
  try {
    const parsed = wasteSchema.safeParse({
      ...req.body,
      quantityKg: Number(req.body.quantityKg),
    });

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const data = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const lot = await tx.onionLot.findUnique({
        where: { id: data.lotId },
        include: {
          storageEntries: {
            where: { currentQuantityKg: { gt: 0 } },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!lot) {
        throw new Error("Izabrani LOT ne postoji.");
      }

      let locationLabel = data.location || null;

      if (data.storageEntryId) {
        const stEntry = await tx.onionStorageEntry.findUnique({
          where: { id: data.storageEntryId },
        });
        if (!stEntry || stEntry.lotId !== lot.id) {
          throw new Error("Izabrana lokacija skladišta ne pripada ovom LOT-u.");
        }
        if (data.quantityKg > stEntry.currentQuantityKg + 0.01) {
          throw new Error(
            `Na lokaciji "${stEntry.locationOrChamber}" ima samo ${stEntry.currentQuantityKg.toLocaleString("sr-RS")} kg.`
          );
        }
        await tx.onionStorageEntry.update({
          where: { id: stEntry.id },
          data: {
            currentQuantityKg: Math.max(0, stEntry.currentQuantityKg - data.quantityKg),
          },
        });
        if (!locationLabel) locationLabel = stEntry.locationOrChamber;
      } else if (lot.storageEntries.length > 0) {
        let rem = data.quantityKg;
        for (const entry of lot.storageEntries) {
          if (rem <= 0) break;
          const ded = Math.min(entry.currentQuantityKg, rem);
          await tx.onionStorageEntry.update({
            where: { id: entry.id },
            data: { currentQuantityKg: Math.max(0, entry.currentQuantityKg - ded) },
          });
          rem -= ded;
        }
      }

      const waste = await tx.onionWaste.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          lotId: lot.id,
          quantityKg: data.quantityKg,
          reason: data.reason,
          description: data.description || null,
          location: locationLabel,
          supervisorId: req.user.id,
          notes: data.notes || null,
        },
        include: {
          lot: { include: { parcel: true } },
          supervisor: { select: { id: true, name: true } },
        },
      });

      const updatedLot = await tx.onionLot.update({
        where: { id: lot.id },
        data: {
          rawStockKg: Math.max(0, lot.rawStockKg - data.quantityKg),
          totalWasteKg: lot.totalWasteKg + data.quantityKg,
        },
      });

      return { waste, updatedLot };
    });

    res.status(201).json({
      ...result,
      message: `Otpis od ${data.quantityKg.toLocaleString("sr-RS")} kg uspešno evidentiran na LOT-u ${result.updatedLot.lotNumber}.`,
    });
  } catch (error) {
    console.error("Greška pri unosu otpisa luka:", error);
    res.status(400).json({ error: error.message || "Greška pri evidentiranju otpisa." });
  }
});

// =========================================================================
// 9. LOT SLEDLJIVOST (TRACEABILITY 360° OD NJIVE DO KUPCA)
// =========================================================================
router.get("/traceability/:lotQuery", async (req, res) => {
  try {
    const q = decodeURIComponent(req.params.lotQuery).trim();

    const lot = await prisma.onionLot.findFirst({
      where: {
        OR: [
          { lotNumber: { equals: q, mode: "insensitive" } },
          { id: q },
          { lotNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      include: {
        parcel: {
          include: {
            fieldWorks: {
              take: 8,
              orderBy: { date: "desc" },
              include: {
                workType: true,
                worker: true,
                machine: true,
              },
            },
            fertilizerMovements: {
              where: { movementType: "IZDAVANJE_NJIVA" },
              take: 8,
              orderBy: { date: "desc" },
              include: {
                product: true,
              },
            },
          },
        },
        harvestArrivals: {
          include: {
            vehicle: true,
            driver: true,
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
        storageEntries: {
          include: {
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
        sortings: {
          include: {
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
        packagings: {
          include: {
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
        shipments: {
          include: {
            buyer: true,
            items: { include: { packaging: true } },
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
        wastes: {
          include: {
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
      },
    });

    if (!lot) {
      return res.status(404).json({ error: `LOT sa oznakom "${q}" nije pronađen.` });
    }

    const timeline = [];

    for (const h of lot.harvestArrivals) {
      timeline.push({
        id: `harvest-${h.id}`,
        stage: "DOVOZ_NJIVA",
        title: "Dovoz sa njive",
        date: h.date,
        createdAt: h.createdAt,
        time: h.createdAt || h.date,
        quantityKg: h.quantityKg,
        details: `Parcela: ${lot.parcel.name} (${lot.parcel.code}) | Vozilo: ${h.vehicle?.name || "Nije navedeno"} | Vozač: ${h.driver?.name || "Nije navedeno"}`,
        supervisor: h.supervisor?.name || "Bojan Ćorović",
        notes: h.notes,
      });
    }

    for (const st of lot.storageEntries) {
      timeline.push({
        id: `storage-${st.id}`,
        stage: st.storageType === "HLADNJACA" ? "HLADNJACA" : "MAGACIN",
        title: `Uskladištenje (${st.locationOrChamber} — ${st.hasEquipment ? "Sa opremom" : "Bez opreme"})`,
        date: st.date,
        createdAt: st.createdAt,
        time: st.createdAt || st.date,
        quantityKg: st.quantityKg,
        details: `Lokacija: ${st.locationOrChamber} | Boks paleta (160x120x120): ${st.boxCount || Math.round(st.quantityKg / 1100)} kom`,
        supervisor: st.supervisor?.name || "Bojan Ćorović",
        notes: st.notes,
      });
    }

    for (const sr of lot.sortings) {
      timeline.push({
        id: `sorting-${sr.id}`,
        stage: "SORTIRANJE",
        title: "Sortiranje i kalibracija",
        date: sr.date,
        createdAt: sr.createdAt,
        time: sr.createdAt || sr.date,
        quantityKg: sr.inputQuantityKg,
        details: `I klasa: ${sr.qualityQuantityKg.toLocaleString("sr-RS")} kg | Sitan luk: ${sr.smallQuantityKg.toLocaleString("sr-RS")} kg | Otpad/Kalo: ${sr.wasteQuantityKg.toLocaleString("sr-RS")} kg (${sr.wastePercentage}%)`,
        supervisor: sr.supervisor?.name || "Bojan Ćorović",
        notes: sr.notes,
      });
    }

    const packageLabels = {
      DZAK_10KG: "Mrežasti džakovi 10 kg",
      DZAK_5KG: "Mrežasti džakovi 5 kg",
      DZAK_25KG: "Džakovi 25 kg",
      DZAMBO_VRECA: "Džambo vreće",
      BOKS_PALETA: "Boks palete",
      RINFUZ: "Rinfuz",
      DRUGO: "Pakovanje",
    };

    for (const pk of lot.packagings) {
      const typeLabel = packageLabels[pk.packageType] || pk.packageType;
      timeline.push({
        id: `packaging-${pk.id}`,
        stage: "PAKOVANJE",
        title: `Pakovanje na pakerici: ${typeLabel}`,
        date: pk.date,
        createdAt: pk.createdAt,
        time: pk.createdAt || pk.date,
        quantityKg: pk.totalWeightKg,
        details: `${typeLabel} — ${pk.packageCount} kom x ${pk.unitWeightKg} kg (${pk.palletsCount || (pk.totalWeightKg / 1000).toFixed(1)} paleta)${pk.palletNumber ? ` | Paleta: ${pk.palletNumber}` : ""} | Zadužen: ${pk.responsiblePerson || "Bojan Ćorović"}`,
        supervisor: pk.responsiblePerson || pk.supervisor?.name || "Bojan Ćorović",
        notes: pk.notes,
      });
    }

    for (const sh of lot.shipments) {
      timeline.push({
        id: `shipment-${sh.id}`,
        stage: "ISPORUKA_KUPAC",
        title: `Isporuka kupcu: ${sh.buyer.name}`,
        date: sh.date,
        createdAt: sh.createdAt,
        time: sh.createdAt || sh.date,
        quantityKg: sh.totalWeightKg,
        details: `Otpremnica: ${sh.dispatchNumber} | Pakovanja: ${sh.totalPackagesCount} kom${sh.vehicleReg ? ` | Vozilo: ${sh.vehicleReg}` : ""}${sh.driverName ? ` | Vozač: ${sh.driverName}` : ""}`,
        supervisor: sh.supervisor?.name || "Bojan Ćorović",
        notes: sh.notes,
      });
    }

    for (const w of lot.wastes) {
      timeline.push({
        id: `waste-${w.id}`,
        stage: "OTPIS_KALO",
        title: `Otpis u skladištu (${w.reason})`,
        date: w.date,
        createdAt: w.createdAt,
        time: w.createdAt || w.date,
        quantityKg: w.quantityKg,
        details: `${w.location ? `Lokacija: ${w.location} | ` : ""}Razlog: ${w.description || w.reason}`,
        supervisor: w.supervisor?.name || "Bojan Ćorović",
        notes: w.notes,
      });
    }

    timeline.sort((a, b) => {
      const timeA = new Date(a.date).getTime() || new Date(a.createdAt).getTime();
      const timeB = new Date(b.date).getTime() || new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return new Date(a.createdAt || a.date).getTime() - new Date(b.createdAt || b.date).getTime();
    });

    res.json({ lot, timeline });
  } catch (error) {
    console.error("Greška pri LOT sledljivosti:", error);
    res.status(500).json({ error: "Greška na serveru pri pretrazi sledljivosti LOT-a." });
  }
});

export default router;

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

// Dozvola za rad sa magacinom đubriva: DIREKTOR, RUKOVODILAC, MAGACIN
const requireWarehouseAccess = requireRole(["DIREKTOR", "RUKOVODILAC", "MAGACIN"]);

const fertilizerTypeEnum = z.enum([
  "MINERALNO_GRANULISANO",
  "VODOTOPIVO_FERTIRIGACIJA",
  "TECNI_BIOSTIMULATOR",
  "ORGANSKO_PELETIRANO",
]);

const fertilizerUnitEnum = z.enum(["KG", "L", "TONA"]);

const movementTypeEnum = z.enum([
  "PRIJEM_NABAVKA",
  "IZDAVANJE_NJIVA",
  "POVRAT_SA_NJIVE",
  "OTPIS_KOREKCIJA",
]);

// Pomoćna funkcija za preračun količine u osnovnu jedinicu (kg / L)
function toBaseKgOrL(quantity, unit) {
  if (unit === "TONA") return quantity * 1000;
  return quantity;
}

const DEFAULT_FERTILIZER_CATALOG = [
  {
    name: "NPK 16:16:16",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 4500,
    minStockWarning: 1000,
    defaultPricePerUnit: 68,
    defaultLocation: "Glavni magacin B1",
    description: "Osnovno kompleksno mineralno đubrivo za jesenju i predsetvenu obradu",
  },
  {
    name: "UREA 46% N",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 3200,
    minStockWarning: 1000,
    defaultPricePerUnit: 74,
    defaultLocation: "Glavni magacin B1",
    description: "Visokokoncentrovano azotno đubrivo za prihranu ratarskih i povrtarskih kultura",
  },
  {
    name: "KAN 27% N",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 650,
    minStockWarning: 1000,
    defaultPricePerUnit: 52,
    defaultLocation: "Magacin pod nadstrešnicom",
    description: "Krečni amonijum nitrat za prihranu u vegetaciji",
  },
  {
    name: "YaraMila Complex 12-11-18",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 2500,
    minStockWarning: 800,
    defaultPricePerUnit: 115,
    defaultLocation: "Sektor A - Boks 2",
    description: "Specijalizovano bezhlorno NPK đubrivo sa mikroelementima za luk i povrće",
  },
  {
    name: "YaraTera Kristalon 18-18-18",
    type: "VODOTOPIVO_FERTIRIGACIJA",
    unit: "KG",
    currentStock: 180,
    minStockWarning: 250,
    defaultPricePerUnit: 310,
    defaultLocation: "Magacin fertirigacije",
    description: "Vodotopivo kristalno đubrivo za prihranu kroz sistem kap-po-kap",
  },
];

// ==========================================
// 1. PREGLED SVIH PROIZVODA I KPI STATISTIKA MAGACINA
// ==========================================
router.get("/products", async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    // Ako je šifarnik đubriva potpuno prazan, inicijalizuj osnovne artikle
    const existingTotal = await prisma.fertilizerProduct.count();
    if (existingTotal === 0) {
      await prisma.fertilizerProduct.createMany({
        data: DEFAULT_FERTILIZER_CATALOG,
        skipDuplicates: true,
      });
    }

    const where = {};
    if (includeInactive !== "true") {
      where.isActive = true;
    }

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [products, monthMovements] = await Promise.all([
      prisma.fertilizerProduct.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        include: {
          _count: {
            select: { movements: true },
          },
        },
      }),
      prisma.fertilizerMovement.findMany({
        where: {
          date: { gte: firstDayOfMonth },
        },
        include: {
          product: {
            select: { unit: true },
          },
        },
      }),
    ]);

    let lowStockCount = 0;
    let totalStockKg = 0;
    let totalStockValueRSD = 0;

    const enrichedProducts = products.map((p) => {
      const isBelowMin = p.isActive && p.currentStock < p.minStockWarning;
      if (isBelowMin) lowStockCount++;

      const baseStockKg = toBaseKgOrL(p.currentStock, p.unit);
      if (p.isActive) {
        totalStockKg += baseStockKg;
        totalStockValueRSD += p.currentStock * (p.defaultPricePerUnit || 0);
      }

      // Referentni kapacitet za vizuelni progress bar (3x minStockWarning ili trenutno stanje)
      const refMax = Math.max(p.minStockWarning * 3, p.currentStock, 100);
      const fillPercentage = Math.min(100, Math.round((p.currentStock / refMax) * 100));

      return {
        ...p,
        isBelowMin,
        fillPercentage,
        stockValueRSD: isManager ? Math.round(p.currentStock * (p.defaultPricePerUnit || 0)) : undefined,
      };
    });

    let monthReceivedKg = 0;
    let monthReceivedCostRSD = 0;
    let monthIssuedKg = 0;
    let monthIssuedCostRSD = 0;

    for (const m of monthMovements) {
      const qtyKg = toBaseKgOrL(m.quantity, m.product?.unit || "KG");
      if (m.movementType === "PRIJEM_NABAVKA") {
        monthReceivedKg += qtyKg;
        monthReceivedCostRSD += m.totalCost || 0;
      } else if (m.movementType === "IZDAVANJE_NJIVA") {
        monthIssuedKg += qtyKg;
        monthIssuedCostRSD += m.totalCost || 0;
      } else if (m.movementType === "POVRAT_SA_NJIVE") {
        monthIssuedKg = Math.max(0, monthIssuedKg - qtyKg);
        monthIssuedCostRSD = Math.max(0, monthIssuedCostRSD - (m.totalCost || 0));
      }
    }

    res.json({
      products: enrichedProducts,
      stats: {
        totalProducts: products.filter((p) => p.isActive).length,
        lowStockCount,
        totalStockKg: Number(totalStockKg.toFixed(1)),
        totalStockTons: Number((totalStockKg / 1000).toFixed(2)),
        monthReceivedKg: Number(monthReceivedKg.toFixed(1)),
        monthReceivedTons: Number((monthReceivedKg / 1000).toFixed(2)),
        monthIssuedKg: Number(monthIssuedKg.toFixed(1)),
        monthIssuedTons: Number((monthIssuedKg / 1000).toFixed(2)),
        ...(isManager && {
          totalStockValueRSD: Math.round(totalStockValueRSD),
          monthReceivedCostRSD: Math.round(monthReceivedCostRSD),
          monthIssuedCostRSD: Math.round(monthIssuedCostRSD),
        }),
      },
    });
  } catch (error) {
    console.error("Greška pri dohvatanju proizvoda đubriva:", error);
    res.status(500).json({ error: "Greška na serveru pri učitavanju magacina đubriva." });
  }
});

// ==========================================
// 2. DODAVANJE NOVOG ARTIKLA ĐUBRIVA U ŠIFARNIK
// ==========================================
const createProductSchema = z.object({
  name: z.string().min(2, "Naziv đubriva mora imati najmanje 2 karaktera").max(120),
  type: fertilizerTypeEnum.default("MINERALNO_GRANULISANO"),
  unit: fertilizerUnitEnum.default("KG"),
  currentStock: z.number().nonnegative("Početno stanje ne može biti negativno").default(0),
  minStockWarning: z.number().nonnegative("Minimalni prag ne može biti negativan").default(500),
  defaultPricePerUnit: z.number().nonnegative("Cena ne može biti negativna").optional().nullable(),
  defaultLocation: z.string().max(120).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

router.post("/products", requireWarehouseAccess, async (req, res) => {
  try {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;

    const existing = await prisma.fertilizerProduct.findUnique({
      where: { name: data.name.trim() },
    });
    if (existing) {
      return res.status(409).json({
        error: `Artikal đubriva sa nazivom „${data.name.trim()}” već postoji u magacinu.`,
      });
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.fertilizerProduct.create({
        data: {
          name: data.name.trim(),
          type: data.type,
          unit: data.unit,
          currentStock: data.currentStock || 0,
          minStockWarning: data.minStockWarning ?? 500,
          defaultPricePerUnit: data.defaultPricePerUnit ?? 0,
          defaultLocation: data.defaultLocation?.trim() || null,
          description: data.description?.trim() || null,
          isActive: data.isActive,
        },
      });

      // Ako je uneto početno stanje > 0, kreiraj inicijalni zapis prijema
      if (created.currentStock > 0) {
        const unitPrice = created.defaultPricePerUnit || 0;
        await tx.fertilizerMovement.create({
          data: {
            date: new Date(),
            movementType: "PRIJEM_NABAVKA",
            productId: created.id,
            quantity: created.currentStock,
            unitPrice: unitPrice > 0 ? unitPrice : null,
            totalCost: unitPrice > 0 ? Number((created.currentStock * unitPrice).toFixed(2)) : null,
            warehouseLocation: created.defaultLocation,
            receiptNumber: "POČETNO-STANJE",
            issuedById: req.user.id,
            notes: "Inicijalno stanje prilikom otvaranja kartice artikla u magacinu.",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          entityType: "FertilizerProduct",
          entityId: created.id,
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Dodato novo đubrivo u magacin: "${created.name}" (Stanje: ${created.currentStock} ${created.unit}, Min. prag: ${created.minStockWarning} ${created.unit})`,
          newValues: created,
        },
      });

      return created;
    });

    res.status(201).json({
      message: "Artikal đubriva uspešno dodat u magacin.",
      product,
    });
  } catch (error) {
    console.error("Greška pri kreiranju artikla đubriva:", error);
    res.status(500).json({ error: "Greška na serveru pri dodavanju đubriva." });
  }
});

// ==========================================
// 3. IZMENA ARTIKLA ĐUBRIVA (PRAG, CENA, LOKACIJA)
// ==========================================
const updateProductSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  type: fertilizerTypeEnum.optional(),
  unit: fertilizerUnitEnum.optional(),
  minStockWarning: z.number().nonnegative().optional(),
  defaultPricePerUnit: z.number().nonnegative().optional().nullable(),
  defaultLocation: z.string().max(120).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.put("/products/:id", requireWarehouseAccess, async (req, res) => {
  try {
    const existing = await prisma.fertilizerProduct.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Artikal đubriva nije pronađen." });
    }

    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const prod = await tx.fertilizerProduct.update({
        where: { id: existing.id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.unit !== undefined && { unit: data.unit }),
          ...(data.minStockWarning !== undefined && { minStockWarning: data.minStockWarning }),
          ...(data.defaultPricePerUnit !== undefined && { defaultPricePerUnit: data.defaultPricePerUnit }),
          ...(data.defaultLocation !== undefined && { defaultLocation: data.defaultLocation?.trim() || null }),
          ...(data.description !== undefined && { description: data.description?.trim() || null }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "FertilizerProduct",
          entityId: prod.id,
          action: "IZMENA",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Ažuriran artikal đubriva "${prod.name}" (Min. prag: ${prod.minStockWarning} ${prod.unit}, Lokacija: ${prod.defaultLocation || "N/A"})`,
          oldValues: existing,
          newValues: prod,
        },
      });

      return prod;
    });

    res.json({
      message: "Podaci o đubrivu su uspešno ažurirani.",
      product: updated,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Artikal sa tim nazivom već postoji." });
    }
    console.error("Greška pri izmeni artikla đubriva:", error);
    res.status(500).json({ error: "Greška na serveru pri izmeni đubriva." });
  }
});

// ==========================================
// 4. DNEVNIK KRETANJA ĐUBRIVA (PRIJEMI, IZDAVANJA, POVRATI, OTPISI)
// ==========================================
router.get("/movements", async (req, res) => {
  try {
    const {
      productId,
      parcelId,
      movementType,
      type,
      supplierId,
      workerId,
      dateFrom,
      dateTo,
      limit = 100,
    } = req.query;

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    const where = {};
    if (productId) where.productId = String(productId);
    if (parcelId) where.parcelId = String(parcelId);
    if (movementType || type) where.movementType = String(movementType || type);
    if (supplierId) where.supplierId = String(supplierId);
    if (workerId) where.receivedWorkerId = String(workerId);

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(String(dateFrom));
      if (dateTo) {
        const end = new Date(String(dateTo));
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const movements = await prisma.fertilizerMovement.findMany({
      where,
      take: Math.min(500, Math.max(1, Number(limit))),
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        product: {
          select: {
            id: true,
            name: true,
            type: true,
            unit: true,
            currentStock: true,
            minStockWarning: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            pib: true,
          },
        },
        parcel: {
          select: {
            id: true,
            code: true,
            name: true,
            areaHa: true,
            currentCrop: true,
          },
        },
        issuedBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        receivedWorker: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    const todayStr = new Date().toDateString();
    const sanitized = movements.map((m) => {
      const entryDayStr = new Date(m.date).toDateString();
      const isToday = entryDayStr === todayStr;
      const canEdit = isManager || (req.user.role === "MAGACIN" && isToday);

      if (isManager) return { ...m, isToday, canEdit };
      const { unitPrice, totalCost, ...rest } = m;
      return { ...rest, isToday, canEdit };
    });

    res.json({ movements: sanitized });
  } catch (error) {
    console.error("Greška pri dohvatanju kretanja đubriva:", error);
    res.status(500).json({ error: "Greška na serveru pri učitavanju istorijata kretanja." });
  }
});

// ==========================================
// 4b. IZMENA ZAPISA KRETANJA (DIREKTOR I RUKOVODILAC UVEK, MAGACIONER SAMO DANAS)
// ==========================================
const updateMovementSchema = z.object({
  quantity: z.number().positive("Količina mora biti veća od 0").optional(),
  unitPrice: z.number().nonnegative("Cena ne može biti negativna").optional().nullable(),
  totalCost: z.number().nonnegative().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  warehouseLocation: z.string().max(120).optional().nullable(),
  date: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  parcelId: z.string().optional().nullable(),
  receivedWorkerId: z.string().optional().nullable(),
  cropName: z.string().max(120).optional().nullable(),
  areaHa: z.number().positive("Površina parcele mora biti veća od 0 ha").optional().nullable(),
});

router.put("/movements/:id", async (req, res) => {
  try {
    const existing = await prisma.fertilizerMovement.findUnique({
      where: { id: req.params.id },
      include: { product: true, supplier: true, parcel: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis kretanja đubriva nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      if (req.user.role !== "MAGACIN") {
        return res.status(403).json({ error: "Nemate dozvolu za izmenu ovog zapisa." });
      }

      const entryDay = new Date(existing.date).toDateString();
      const today = new Date().toDateString();
      if (entryDay !== today) {
        return res.status(403).json({
          error: "Rok za izmenu je istekao. Magacioner može izmeniti unos samo do kraja dana u kojem je zabeležen. Nakon toga zapis mogu menjati isključivo direktor i rukovodilac.",
        });
      }
    }

    const parsed = updateMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const product = existing.product;

    let movementDate = undefined;
    if (data.date) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) {
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
          const now = new Date();
          d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
        }
        movementDate = d;
      }
    }

    let effectiveUnitPrice = data.unitPrice !== undefined ? data.unitPrice : existing.unitPrice;
    let effectiveTotalCost = data.totalCost !== undefined ? data.totalCost : existing.totalCost;
    const newQty = data.quantity !== undefined ? data.quantity : existing.quantity;

    if (data.totalCost !== undefined && data.totalCost !== null && data.totalCost > 0) {
      effectiveTotalCost = Number(data.totalCost.toFixed(2));
      effectiveUnitPrice = Number((data.totalCost / newQty).toFixed(2));
    } else if (data.unitPrice !== undefined && data.unitPrice !== null && data.unitPrice > 0) {
      effectiveUnitPrice = Number(data.unitPrice.toFixed(2));
      effectiveTotalCost = Number((newQty * effectiveUnitPrice).toFixed(2));
    } else if (data.quantity !== undefined && effectiveUnitPrice) {
      effectiveTotalCost = Number((newQty * effectiveUnitPrice).toFixed(2));
    }

    const diffQty = newQty - existing.quantity;

    const result = await prisma.$transaction(async (tx) => {
      if (diffQty !== 0) {
        if (existing.movementType === "PRIJEM_NABAVKA") {
          const projectedStock = product.currentStock + diffQty;
          if (projectedStock < 0) {
            throw new Error(
              `Nije moguće smanjiti količinu prijema na ${newQty} ${product.unit} jer bi trenutno stanje u magacinu postalo negativno (${projectedStock.toFixed(2)} ${product.unit}). Deo robe je već izdat na njivu.`
            );
          }
          await tx.fertilizerProduct.update({
            where: { id: product.id },
            data: {
              currentStock: Number(projectedStock.toFixed(3)),
              ...(effectiveUnitPrice && effectiveUnitPrice > 0 ? { defaultPricePerUnit: effectiveUnitPrice } : {}),
            },
          });
        } else if (existing.movementType === "IZDAVANJE_NJIVA" || existing.movementType === "OTPIS_KOREKCIJA") {
          const projectedStock = product.currentStock - diffQty;
          if (projectedStock < 0) {
            throw new Error(
              `Nedovoljno zaliha na stanju za povećanje izdavanja! Na stanju ima ${product.currentStock} ${product.unit}.`
            );
          }
          await tx.fertilizerProduct.update({
            where: { id: product.id },
            data: { currentStock: Number(projectedStock.toFixed(3)) },
          });
        }
      }

      // Ažuriraj dozu kg/ha ako je u pitanju izdavanje na njivu
      let newKgPerHa = existing.kgPerHa;
      const targetAreaHa = data.areaHa !== undefined ? data.areaHa : existing.areaHa;
      if (existing.movementType === "IZDAVANJE_NJIVA" && targetAreaHa && targetAreaHa > 0) {
        const baseQty = toBaseKgOrL(newQty, product.unit);
        newKgPerHa = Number((baseQty / targetAreaHa).toFixed(2));
      }

      const updated = await tx.fertilizerMovement.update({
        where: { id: existing.id },
        data: {
          ...(data.quantity !== undefined && { quantity: data.quantity }),
          ...(effectiveUnitPrice !== undefined && { unitPrice: effectiveUnitPrice }),
          ...(effectiveTotalCost !== undefined && { totalCost: effectiveTotalCost }),
          ...(data.supplierId !== undefined && { supplierId: data.supplierId || null }),
          ...(data.receiptNumber !== undefined && { receiptNumber: data.receiptNumber?.trim() || null }),
          ...(data.warehouseLocation !== undefined && { warehouseLocation: data.warehouseLocation?.trim() || null }),
          ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
          ...(data.parcelId !== undefined && { parcelId: data.parcelId || null }),
          ...(data.receivedWorkerId !== undefined && { receivedWorkerId: data.receivedWorkerId || null }),
          ...(data.cropName !== undefined && { cropName: data.cropName?.trim() || null }),
          ...(data.areaHa !== undefined && { areaHa: data.areaHa || null }),
          ...(newKgPerHa !== undefined && { kgPerHa: newKgPerHa }),
          ...(movementDate && { date: movementDate }),
        },
        include: {
          product: true,
          supplier: true,
          parcel: true,
          issuedBy: { select: { id: true, name: true, role: true } },
          receivedWorker: { select: { id: true, name: true, type: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "FertilizerMovement",
          entityId: existing.id,
          action: "IZMENA",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Izmenjen zapis kretanja đubriva "${product.name}" (${existing.quantity} -> ${newQty} ${product.unit})`,
          oldValues: existing,
          newValues: updated,
        },
      });

      return updated;
    });

    res.json({
      message: "Zapis kretanja je uspešno izmenjen.",
      movement: result,
    });
  } catch (error) {
    console.error("Greška pri izmeni kretanja đubriva:", error);
    if (error.message && (error.message.includes("Nije moguće smanjiti") || error.message.includes("Nedovoljno zaliha"))) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Greška na serveru pri izmeni zapisa." });
  }
});

// ==========================================
// 4c. BRISANJE / STORNIRANJE ZAPISA KRETANJA (DIREKTOR I RUKOVODILAC UVEK, MAGACIONER SAMO DANAS)
// ==========================================
router.delete("/movements/:id", async (req, res) => {
  try {
    const existing = await prisma.fertilizerMovement.findUnique({
      where: { id: req.params.id },
      include: { product: true, supplier: true, parcel: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis kretanja đubriva nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);
    if (!isManager) {
      if (req.user.role !== "MAGACIN") {
        return res.status(403).json({ error: "Nemate dozvolu za brisanje ovog zapisa." });
      }

      const entryDay = new Date(existing.date).toDateString();
      const today = new Date().toDateString();
      if (entryDay !== today) {
        return res.status(403).json({
          error: "Rok za brisanje je istekao. Magacioner može obrisati unos samo do kraja dana u kojem je zabeležen. Nakon toga zapis mogu obrisati isključivo direktor i rukovodilac.",
        });
      }
    }

    const product = existing.product;

    await prisma.$transaction(async (tx) => {
      if (existing.movementType === "PRIJEM_NABAVKA") {
        const newStock = product.currentStock - existing.quantity;
        if (newStock < 0) {
          throw new Error(
            `Nije moguće obrisati prijem robe jer bi trenutno stanje zaliha u magacinu postalo negativno (${newStock.toFixed(2)} ${product.unit}). Deo robe iz ovog prijema je već izdat na njivu.`
          );
        }
        await tx.fertilizerProduct.update({
          where: { id: product.id },
          data: { currentStock: Number(newStock.toFixed(3)) },
        });
      } else if (existing.movementType === "IZDAVANJE_NJIVA" || existing.movementType === "OTPIS_KOREKCIJA") {
        await tx.fertilizerProduct.update({
          where: { id: product.id },
          data: {
            currentStock: Number((product.currentStock + existing.quantity).toFixed(3)),
          },
        });
      } else if (existing.movementType === "POVRAT_SA_NJIVE") {
        await tx.fertilizerProduct.update({
          where: { id: product.id },
          data: {
            currentStock: Math.max(0, Number((product.currentStock - existing.quantity).toFixed(3))),
          },
        });
      }

      await tx.fertilizerMovement.delete({
        where: { id: existing.id },
      });

      await tx.auditLog.create({
        data: {
          entityType: "FertilizerMovement",
          entityId: existing.id,
          action: "STORNO",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Storniran/obrisan zapis kretanja đubriva "${product.name}" (${existing.movementType}: ${existing.quantity} ${product.unit})`,
          oldValues: existing,
        },
      });
    });

    res.json({ message: "Zapis kretanja je uspešno obrisan i zalihe su vraćene." });
  } catch (error) {
    console.error("Greška pri brisanju kretanja đubriva:", error);
    if (error.message && error.message.includes("Nije moguće obrisati")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Greška na serveru pri brisanju zapisa." });
  }
});

// ==========================================
// 5. PRIJEM ĐUBRIVA U MAGACIN (NABAVKA OD DOBAVLJAČA)
// ==========================================
const receiveFertilizerSchema = z.object({
  productId: z.string().min(1, "Morate izabrati đubrivo"),
  quantity: z.number().positive("Količina prijema mora biti veća od 0"),
  unitPrice: z.number().nonnegative("Cena ne može biti negativna").optional().nullable(),
  totalCost: z.number().nonnegative().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  warehouseLocation: z.string().max(120).optional().nullable(),
  date: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

router.post("/receive", requireWarehouseAccess, async (req, res) => {
  try {
    const parsed = receiveFertilizerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;

    const product = await prisma.fertilizerProduct.findUnique({
      where: { id: data.productId },
    });
    if (!product) {
      return res.status(404).json({ error: "Izabrani artikal đubriva ne postoji." });
    }

    if (data.supplierId) {
      const supplier = await prisma.partner.findUnique({
        where: { id: data.supplierId },
      });
      if (!supplier) {
        return res.status(404).json({ error: "Izabrani dobavljač ne postoji u šifarniku partnera." });
      }
    }

    let movementDate = new Date();
    if (data.date) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) {
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
          const now = new Date();
          d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
        }
        movementDate = d;
      }
    }

    let effectiveUnitPrice = data.unitPrice ?? product.defaultPricePerUnit ?? null;
    let effectiveTotalCost = data.totalCost ?? null;

    if (effectiveUnitPrice !== null && effectiveUnitPrice > 0 && !effectiveTotalCost) {
      effectiveTotalCost = Number((data.quantity * effectiveUnitPrice).toFixed(2));
    } else if (effectiveTotalCost !== null && effectiveTotalCost > 0 && (!effectiveUnitPrice || effectiveUnitPrice === 0)) {
      effectiveUnitPrice = Number((effectiveTotalCost / data.quantity).toFixed(2));
    }

    const newStock = Number((product.currentStock + data.quantity).toFixed(3));
    const effectiveLocation = data.warehouseLocation?.trim() || product.defaultLocation || null;

    const result = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.fertilizerProduct.update({
        where: { id: product.id },
        data: {
          currentStock: newStock,
          ...(effectiveUnitPrice && effectiveUnitPrice > 0 ? { defaultPricePerUnit: effectiveUnitPrice } : {}),
          ...(effectiveLocation ? { defaultLocation: effectiveLocation } : {}),
        },
      });

      const movement = await tx.fertilizerMovement.create({
        data: {
          date: movementDate,
          movementType: "PRIJEM_NABAVKA",
          productId: product.id,
          quantity: data.quantity,
          unitPrice: effectiveUnitPrice,
          totalCost: effectiveTotalCost,
          supplierId: data.supplierId || null,
          receiptNumber: data.receiptNumber?.trim() || null,
          warehouseLocation: effectiveLocation,
          issuedById: req.user.id,
          notes: data.notes?.trim() || null,
        },
        include: {
          product: true,
          supplier: true,
          issuedBy: { select: { id: true, name: true, role: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "FertilizerMovement",
          entityId: movement.id,
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `Prijem đubriva u magacin: +${data.quantity} ${product.unit} "${product.name}" (Novo stanje: ${newStock} ${product.unit}${data.receiptNumber ? `, Dok: ${data.receiptNumber}` : ""})`,
          newValues: {
            productName: product.name,
            quantity: data.quantity,
            unit: product.unit,
            newStock,
            receiptNumber: data.receiptNumber,
            totalCost: effectiveTotalCost,
          },
        },
      });

      return { movement, updatedProduct };
    });

    res.status(201).json({
      message: `Uspešno primljeno ${data.quantity} ${product.unit} đubriva „${product.name}”. Novo stanje: ${newStock} ${product.unit}.`,
      movement: result.movement,
      product: result.updatedProduct,
    });
  } catch (error) {
    console.error("Greška pri prijemu đubriva:", error);
    res.status(500).json({ error: "Greška na serveru prilikom prijema robe u magacin." });
  }
});

// ==========================================
// 6. IZDAVANJE ĐUBRIVA NA NJIVU / POVRAT / OTPIS
// ==========================================
const issueFertilizerSchema = z.object({
  productId: z.string().min(1, "Morate izabrati đubrivo"),
  movementType: z
    .enum(["IZDAVANJE_NJIVA", "POVRAT_SA_NJIVE", "OTPIS_KOREKCIJA"])
    .default("IZDAVANJE_NJIVA"),
  quantity: z.number().positive("Količina mora biti veća od 0"),
  parcelId: z.string().optional().nullable(),
  receivedWorkerId: z.string().optional().nullable(),
  cropName: z.string().max(120).optional().nullable(),
  areaHa: z.number().positive("Površina parcele mora biti veća od 0 ha").optional().nullable(),
  date: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

router.post("/issue", requireWarehouseAccess, async (req, res) => {
  try {
    const parsed = issueFertilizerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;

    // 1. Proveri artikal u magacinu
    const product = await prisma.fertilizerProduct.findUnique({
      where: { id: data.productId },
    });
    if (!product) {
      return res.status(404).json({ error: "Izabrani artikal đubriva ne postoji." });
    }

    // 2. Za izdavanje na njivu, parcela i radnik su obavezni
    let parcel = null;
    if (data.parcelId) {
      parcel = await prisma.parcel.findUnique({
        where: { id: data.parcelId },
      });
      if (!parcel) {
        return res.status(404).json({ error: "Izabrana parcela ne postoji u šifarniku." });
      }
    } else if (data.movementType === "IZDAVANJE_NJIVA") {
      return res.status(400).json({
        error: "Za izdavanje đubriva na njivu morate izabrati parcelu.",
      });
    }

    let worker = null;
    if (data.receivedWorkerId) {
      worker = await prisma.worker.findUnique({
        where: { id: data.receivedWorkerId },
      });
      if (!worker) {
        return res.status(404).json({ error: "Izabrani radnik / traktorista ne postoji." });
      }
    } else if (data.movementType === "IZDAVANJE_NJIVA") {
      return res.status(400).json({
        error: "Morate izabrati radnika (traktoristu) koji preuzima đubrivo iz magacina.",
      });
    }

    // 3. KONTROLA ZALIHA: Ne može se izdati više nego što ima na stanju
    const isOutflow = ["IZDAVANJE_NJIVA", "OTPIS_KOREKCIJA"].includes(data.movementType);
    if (isOutflow && product.currentStock < data.quantity) {
      return res.status(400).json({
        error: `Nedovoljno zaliha na stanju! Trenutno stanje za „${product.name}” iznosi ${product.currentStock} ${product.unit}, a pokušano je izdavanje od ${data.quantity} ${product.unit}.`,
      });
    }

    // 4. Automatski proračun površine, kulture i doze (kg/ha)
    const effectiveAreaHa = data.areaHa || (parcel ? parcel.areaHa : null);
    const effectiveCropName = data.cropName?.trim() || (parcel ? parcel.currentCrop : null) || null;

    let calculatedKgPerHa = null;
    if (effectiveAreaHa && effectiveAreaHa > 0) {
      const baseQtyKg = toBaseKgOrL(data.quantity, product.unit);
      calculatedKgPerHa = Number((baseQtyKg / effectiveAreaHa).toFixed(2));
    }

    // 5. Finansije transakcije
    const unitPrice = product.defaultPricePerUnit || 0;
    const totalCost = unitPrice > 0 ? Number((data.quantity * unitPrice).toFixed(2)) : null;

    let movementDate = new Date();
    if (data.date) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) {
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
          const now = new Date();
          d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
        }
        movementDate = d;
      }
    }

    const newStock = isOutflow
      ? Number((product.currentStock - data.quantity).toFixed(3))
      : Number((product.currentStock + data.quantity).toFixed(3));

    const isBelowMinAfter = newStock < product.minStockWarning;

    // 6. ATOMSKA TRANSAKCIJA: Umanjenje stanja + upis izlaza + AuditLog
    const result = await prisma.$transaction(async (tx) => {
      // Ponovna provera stanja unutar transakcije radi sprečavanja race-condition-a
      const freshProduct = await tx.fertilizerProduct.findUnique({
        where: { id: product.id },
      });
      if (isOutflow && freshProduct.currentStock < data.quantity) {
        throw new Error(
          `Nedovoljno zaliha na stanju! Trenutno stanje za „${freshProduct.name}” iznosi ${freshProduct.currentStock} ${freshProduct.unit}.`
        );
      }

      const updatedProduct = await tx.fertilizerProduct.update({
        where: { id: product.id },
        data: {
          currentStock: isOutflow
            ? Number((freshProduct.currentStock - data.quantity).toFixed(3))
            : Number((freshProduct.currentStock + data.quantity).toFixed(3)),
        },
      });

      const movement = await tx.fertilizerMovement.create({
        data: {
          date: movementDate,
          movementType: data.movementType,
          productId: product.id,
          quantity: data.quantity,
          unitPrice: unitPrice > 0 ? unitPrice : null,
          totalCost,
          parcelId: parcel ? parcel.id : null,
          cropName: effectiveCropName,
          areaHa: effectiveAreaHa,
          kgPerHa: calculatedKgPerHa,
          issuedById: req.user.id,
          receivedWorkerId: worker ? worker.id : null,
          warehouseLocation: product.defaultLocation,
          notes: data.notes?.trim() || null,
        },
        include: {
          product: true,
          parcel: true,
          receivedWorker: true,
          issuedBy: { select: { id: true, name: true, role: true } },
        },
      });

      const actionLabel =
        data.movementType === "IZDAVANJE_NJIVA"
          ? `Izdato na parcelu "${parcel?.name || ""}" (${calculatedKgPerHa || 0} kg/ha)`
          : data.movementType === "POVRAT_SA_NJIVE"
          ? `Povrat sa njive u magacin`
          : `Otpis / korekcija zaliha`;

      await tx.auditLog.create({
        data: {
          entityType: "FertilizerMovement",
          entityId: movement.id,
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          description: `${actionLabel}: ${isOutflow ? "-" : "+"}${data.quantity} ${product.unit} "${product.name}" (Preostalo: ${updatedProduct.currentStock} ${product.unit})`,
          newValues: {
            movementType: data.movementType,
            productName: product.name,
            quantity: data.quantity,
            unit: product.unit,
            parcelName: parcel?.name,
            workerName: worker?.name,
            kgPerHa: calculatedKgPerHa,
            remainingStock: updatedProduct.currentStock,
          },
        },
      });

      return { movement, updatedProduct };
    });

    res.status(201).json({
      message:
        data.movementType === "IZDAVANJE_NJIVA"
          ? `Izdato ${data.quantity} ${product.unit} đubriva „${product.name}” za parcelu „${parcel?.name}” (Doza: ${calculatedKgPerHa} kg/ha).`
          : data.movementType === "POVRAT_SA_NJIVE"
          ? `Uspešno evidentiran povrat sa njive: +${data.quantity} ${product.unit} đubriva „${product.name}” vraćeno sa parcele „${parcel?.name || ''}”. Novo stanje u magacinu: ${result.updatedProduct.currentStock} ${product.unit}.`
          : `Uspešno evidentiran otpis/kalo: -${data.quantity} ${product.unit} đubriva „${product.name}”. Novo stanje u magacinu: ${result.updatedProduct.currentStock} ${product.unit}.`,
      movement: result.movement,
      product: result.updatedProduct,
      isBelowMinWarning: isBelowMinAfter,
    });
  } catch (error) {
    console.error("Greška pri izdavanju đubriva:", error);
    if (error.message && error.message.startsWith("Nedovoljno zaliha")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Greška na serveru prilikom izdavanja đubriva." });
  }
});

// ==========================================
// 7. AGREGIRANI IZVEŠTAJ UTROŠKA PO PARCELAMA I SEZONI
// ==========================================
router.get("/parcel-summary", async (req, res) => {
  try {
    const { year, parcelId } = req.query;
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    const targetYear = year ? Number(year) : new Date().getFullYear();
    const startOfYear = new Date(targetYear, 0, 1, 0, 0, 0);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const where = {
      parcelId: parcelId ? String(parcelId) : { not: null },
      movementType: { in: ["IZDAVANJE_NJIVA", "POVRAT_SA_NJIVE"] },
      date: {
        gte: startOfYear,
        lte: endOfYear,
      },
    };

    const movements = await prisma.fertilizerMovement.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        product: true,
        parcel: true,
        receivedWorker: { select: { id: true, name: true } },
      },
    });

    const parcelMap = new Map();

    for (const m of movements) {
      if (!m.parcel) continue;
      const pId = m.parcel.id;

      if (!parcelMap.has(pId)) {
        parcelMap.set(pId, {
          parcelId: pId,
          parcelCode: m.parcel.code,
          parcelName: m.parcel.name,
          areaHa: m.parcel.areaHa,
          currentCrop: m.cropName || m.parcel.currentCrop || "Nije navedeno",
          totalIssuedKg: 0,
          totalReturnedKg: 0,
          totalKgApplied: 0,
          totalCostRSD: 0,
          applicationsCount: 0,
          lastAppliedAt: m.date,
          productsBreakdown: {},
        });
      }

      const entry = parcelMap.get(pId);
      const isReturn = m.movementType === "POVRAT_SA_NJIVE";
      const sign = isReturn ? -1 : 1;
      const baseQty = toBaseKgOrL(m.quantity, m.product.unit);
      const qtyKg = baseQty * sign;
      const cost = (m.totalCost || 0) * sign;

      if (isReturn) {
        entry.totalReturnedKg = Number((entry.totalReturnedKg + baseQty).toFixed(2));
      } else {
        entry.totalIssuedKg = Number((entry.totalIssuedKg + baseQty).toFixed(2));
        entry.applicationsCount += 1;
      }

      entry.totalKgApplied = Math.max(0, Number((entry.totalKgApplied + qtyKg).toFixed(2)));
      entry.totalCostRSD = Math.max(0, Math.round(entry.totalCostRSD + cost));

      const prodName = m.product.name;
      if (!entry.productsBreakdown[prodName]) {
        entry.productsBreakdown[prodName] = {
          productId: m.product.id,
          productName: prodName,
          type: m.product.type,
          unit: m.product.unit,
          totalQuantity: 0,
          totalKg: 0,
        };
      }
      entry.productsBreakdown[prodName].totalQuantity = Number(
        (entry.productsBreakdown[prodName].totalQuantity + m.quantity * sign).toFixed(2)
      );
      entry.productsBreakdown[prodName].totalKg = Number(
        (entry.productsBreakdown[prodName].totalKg + qtyKg).toFixed(2)
      );
    }

    const summary = Array.from(parcelMap.values()).map((item) => {
      const avgKgPerHa = item.areaHa > 0 ? Number((item.totalKgApplied / item.areaHa).toFixed(1)) : 0;
      const costPerHaRSD = item.areaHa > 0 ? Math.round(item.totalCostRSD / item.areaHa) : 0;

      return {
        parcelId: item.parcelId,
        parcelCode: item.parcelCode,
        parcelName: item.parcelName,
        areaHa: item.areaHa,
        currentCrop: item.currentCrop,
        totalIssuedKg: item.totalIssuedKg,
        totalReturnedKg: item.totalReturnedKg,
        totalKgApplied: item.totalKgApplied,
        avgKgPerHa,
        applicationsCount: item.applicationsCount,
        lastAppliedAt: item.lastAppliedAt,
        products: Object.values(item.productsBreakdown).filter((p) => p.totalQuantity > 0),
        ...(isManager && {
          totalCostRSD: item.totalCostRSD,
          costPerHaRSD,
        }),
      };
    });

    summary.sort((a, b) => b.totalKgApplied - a.totalKgApplied);

    res.json({
      year: targetYear,
      parcelSummary: summary,
    });
  } catch (error) {
    console.error("Greška pri obračunu utroška đubriva po parcelama:", error);
    res.status(500).json({ error: "Greška na serveru pri učitavanju utroška po parcelama." });
  }
});

export default router;

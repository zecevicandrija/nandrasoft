import { Router } from "express";
import { machineMutation, hasOpenMaintenance } from "../lib/machineAvailability.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

// Helper za proveru rola za izmene (samo DIREKTOR i RUKOVODILAC smeju da menjaju šifarnike)
const requireManager = requireRole(["DIREKTOR", "RUKOVODILAC"]);

// ==========================================
// 1. STATISTIKA ŠIFARNIKA
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const [
      parcels,
      machines,
      workers,
      workTypes,
      crops,
      partners,
    ] = await Promise.all([
      prisma.parcel.findMany({ where: { isActive: true } }),
      prisma.machine.findMany({ where: { isActive: true } }),
      prisma.worker.findMany({ where: { isActive: true } }),
      prisma.workType.count({ where: { isActive: true } }),
      prisma.crop.count({ where: { isActive: true } }),
      prisma.partner.count({ where: { isActive: true } }),
    ]);

    const totalAreaHa = parcels.reduce((sum, p) => sum + p.areaHa, 0);
    const machinesInBreakdown = machines.filter((m) => m.status === "U_KVARU").length;
    const seasonalWorkers = workers.filter((w) => w.type === "SEZONAC").length;

    res.json({
      parcelsCount: parcels.length,
      totalAreaHa: Math.round(totalAreaHa * 100) / 100,
      machinesCount: machines.length,
      machinesInBreakdown,
      workersCount: workers.length,
      seasonalWorkers,
      workTypesCount: workTypes,
      cropsCount: crops,
      partnersCount: partners,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju statistike šifarnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2. PARCELE (PARCELS)
// ==========================================
const parcelSchema = z.object({
  code: z.string().min(1, "Šifra parcele je obavezna").max(20),
  name: z.string().min(2, "Naziv parcele mora imati barem 2 karaktera").max(100),
  areaHa: z.number().positive("Površina mora biti pozitivan broj"),
  location: z.string().max(200).optional().nullable(),
  currentCrop: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get("/parcels", async (req, res) => {
  try {
    const parcels = await prisma.parcel.findMany({
      orderBy: { code: "asc" },
    });
    res.json({ parcels });
  } catch (error) {
    console.error("Greška:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.post("/parcels", requireManager, async (req, res) => {
  try {
    const parsed = parcelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const parcel = await prisma.parcel.create({ data: parsed.data });
    res.status(201).json({ parcel });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Šifra parcele već postoji." });
    }
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.put("/parcels/:id", requireManager, async (req, res) => {
  try {
    const parsed = parcelSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const parcel = await prisma.parcel.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ parcel });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Šifra parcele već postoji." });
    }
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.delete("/parcels/:id", requireManager, async (req, res) => {
  try {
    await prisma.parcel.delete({ where: { id: req.params.id } });
    res.json({ message: "Parcela uspešno obrisana." });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 3. MAŠINE I PRIKLJUČCI (MACHINES)
// ==========================================
const machineTypeEnum = z.enum(["TRAKTOR", "PRIKLJUCAK", "KOMBAJN", "KAMION", "VILJUSKAR", "OSTALO"]);
const machineStatusEnum = z.enum(["SLOBODNA", "ZADUZENA", "U_KVARU", "SERVIS"]);

const machineSchema = z.object({
  name: z.string().min(2, "Naziv mašine je obavezan").max(100),
  type: machineTypeEnum.default("TRAKTOR"),
  brandModel: z.string().max(100).optional().nullable(),
  regNumber: z.string().max(50).optional().nullable(),
  year: z.number().int().min(1950).max(2035).optional().nullable(),
  currentHours: z.number().nonnegative().default(0),
  tankCapacityLiters: z.number().nonnegative().optional().nullable(),
  currentFuelLiters: z.number().nonnegative().optional().nullable(),
  enpTagNumber: z.string().max(80).optional().nullable(),
  enpTagBalance: z.number().optional().nullable(),
  status: machineStatusEnum.default("SLOBODNA"),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get("/machines", async (req, res) => {
  try {
    const machines = await prisma.machine.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    res.json({ machines });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.post("/machines", requireManager, async (req, res) => {
  try {
    const parsed = machineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const machine = await prisma.machine.create({ data: parsed.data });
    res.status(201).json({ machine });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.put("/machines/:id", requireManager, machineMutation(async (req, res, prisma) => {
  try {
    const parsed = machineSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    if (parsed.data.status === "SLOBODNA" &&
        (await hasOpenMaintenance(prisma, req.params.id) ||
         await prisma.machineAssignment.findFirst({ where: { machineId: req.params.id, status: "ZADUZENA" } }))) {
      return res.status(409).json({ error: "Mašina ima otvoren servis ili aktivno zaduženje i ne može biti označena kao slobodna." });
    }
    const machine = await prisma.machine.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ machine });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
}));

router.delete("/machines/:id", requireManager, async (req, res) => {
  try {
    await prisma.machine.delete({ where: { id: req.params.id } });
    res.json({ message: "Mašina uspešno obrisana." });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 4. RADNICI I ZAPOSLENI (WORKERS)
// ==========================================
const workerRoleInputEnum = z.enum(["RUKOVODILAC", "MAGACIN", "MEHANICAR", "OPERATER", "SEZONAC"]);

const workerSchema = z.object({
  name: z.string().min(2, "Ime i prezime radnika je obavezno").max(100),
  role: workerRoleInputEnum.optional(),
  type: z.enum(["STALNI", "SEZONAC"]).optional(),
  city: z.string().max(100).optional().nullable(),
  dailyWage: z.number().nonnegative().optional().nullable(),
  jmbg: z.string().max(20).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  hourlyRate: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
  userId: z.string().optional().nullable(),
});

router.get("/workers", async (req, res) => {
  try {
    const workers = await prisma.worker.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    // Osiguraj effectiveRole za svakog radnika
    const mapped = workers.map((w) => {
      let effectiveRole = w.role || w.user?.role;
      if (!effectiveRole) {
        effectiveRole = w.type === "SEZONAC" ? "SEZONAC" : "OPERATER";
      }
      return {
        ...w,
        role: effectiveRole,
      };
    });

    res.json({ workers: mapped });
  } catch (error) {
    console.error("Greška pri dohvatanju radnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.post("/workers", requireManager, async (req, res) => {
  try {
    const parsed = workerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }

    const data = parsed.data;
    const currentUserRole = req.user.role;

    // Određivanje ciljne uloge
    let targetRole = data.role;
    if (!targetRole) {
      targetRole = data.type === "SEZONAC" ? "SEZONAC" : "OPERATER";
    }

    // Sigurnosna pravila za kreiranje
    if (targetRole === "DIREKTOR") {
      return res.status(403).json({ error: "Niko ne može kreirati direktora kroz šifarnike." });
    }

    if (targetRole === "RUKOVODILAC" && currentUserRole !== "DIREKTOR") {
      return res.status(403).json({ error: "Samo direktor ima ovlašćenje da kreira ili postavi rukovodioca." });
    }

    if (currentUserRole === "RUKOVODILAC") {
      const allowedForManager = ["MAGACIN", "MEHANICAR", "OPERATER", "SEZONAC"];
      if (!allowedForManager.includes(targetRole)) {
        return res.status(403).json({
          error: "Rukovodilac može kreirati radnike samo sa ulogama: Magacioner, Mehaničar, Operater ili Sezonac.",
        });
      }
    }

    const isSezonac = targetRole === "SEZONAC";

    if (isSezonac && (!data.city || !data.city.trim())) {
      return res.status(400).json({ error: "Grad / Mesto je obavezno polje za sezonskog radnika." });
    }

    const worker = await prisma.worker.create({
      data: {
        name: data.name.trim(),
        type: isSezonac ? "SEZONAC" : "STALNI",
        role: isSezonac ? null : targetRole,
        city: data.city?.trim() || null,
        dailyWage: isSezonac && data.dailyWage !== undefined && data.dailyWage !== null ? Number(data.dailyWage) : null,
        phone: data.phone?.trim() || null,
        jmbg: data.jmbg?.trim() || null,
        isActive: data.isActive ?? true,
        userId: data.userId || null,
      },
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
    });

    // Sinhronizacija sa SeasonalWorker tabelom ako je u pitanju sezonac
    if (isSezonac) {
      await prisma.seasonalWorker
        .create({
          data: {
            name: data.name.trim(),
            phone: data.phone?.trim() || null,
            city: data.city?.trim() || null,
            dailyWage: data.dailyWage !== undefined && data.dailyWage !== null ? Number(data.dailyWage) : null,
            isActive: data.isActive ?? true,
          },
        })
        .catch((err) => console.error("Greška pri sinhronizaciji SeasonalWorker-a:", err));
    }

    res.status(201).json({ worker: { ...worker, role: targetRole } });
  } catch (error) {
    console.error("Greška pri kreiranju radnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.put("/workers/:id", requireManager, async (req, res) => {
  try {
    const parsed = workerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }

    const data = parsed.data;
    const currentUserRole = req.user.role;

    const existing = await prisma.worker.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Radnik nije pronađen." });
    }

    const currentWorkerRole = existing.role || existing.user?.role || (existing.type === "SEZONAC" ? "SEZONAC" : "OPERATER");

    // Provere zaštite postojećeg radnika
    if (currentWorkerRole === "DIREKTOR") {
      return res.status(403).json({ error: "Podaci i uloga direktora se ne mogu menjati kroz šifarnike." });
    }

    if (currentWorkerRole === "RUKOVODILAC" && currentUserRole !== "DIREKTOR") {
      return res.status(403).json({ error: "Samo direktor ima ovlašćenje da menja podatke ili ulogu rukovodiocu." });
    }

    // Ako se menja uloga radnika
    let newRole = data.role !== undefined ? data.role : currentWorkerRole;
    if (data.type === "SEZONAC" && !data.role) newRole = "SEZONAC";
    if (data.type === "STALNI" && data.role === "SEZONAC") newRole = "OPERATER";

    if (newRole === "DIREKTOR") {
      return res.status(403).json({ error: "Niko ne može dodeliti ulogu direktora." });
    }

    if (newRole === "RUKOVODILAC" && currentUserRole !== "DIREKTOR") {
      return res.status(403).json({ error: "Samo direktor može dodeliti ulogu rukovodioca." });
    }

    if (currentUserRole === "RUKOVODILAC") {
      const allowedRoles = ["MAGACIN", "MEHANICAR", "OPERATER", "SEZONAC"];
      if (!allowedRoles.includes(newRole)) {
        return res.status(403).json({
          error: "Rukovodilac može dodeliti samo uloge Magacioner, Mehaničar, Operater ili Sezonac.",
        });
      }
    }

    const isSezonac = newRole === "SEZONAC";

    const updatePayload = {};
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.phone !== undefined) updatePayload.phone = data.phone?.trim() || null;
    if (data.city !== undefined) updatePayload.city = data.city?.trim() || null;
    if (data.jmbg !== undefined) updatePayload.jmbg = data.jmbg?.trim() || null;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    updatePayload.type = isSezonac ? "SEZONAC" : "STALNI";
    updatePayload.role = isSezonac ? null : newRole;

    if (isSezonac) {
      if (data.dailyWage !== undefined) {
        updatePayload.dailyWage = data.dailyWage !== null ? Number(data.dailyWage) : null;
      }
    } else {
      updatePayload.dailyWage = null;
    }

    const worker = await prisma.worker.update({
      where: { id: req.params.id },
      data: updatePayload,
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
    });

    // Ako radnik ima povezan korisnički nalog (User), ažuriraj i ulogu korisnika
    if (existing.userId && !isSezonac) {
      await prisma.user
        .update({
          where: { id: existing.userId },
          data: {
            role: newRole,
            ...(data.name ? { name: data.name.trim() } : {}),
            ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
          },
        })
        .catch((err) => console.error("Greška pri ažuriranju User role:", err));
    }

    // Sinhronizacija sa SeasonalWorker ako je Sezonac
    if (isSezonac) {
      const existingSeasonal = await prisma.seasonalWorker.findFirst({
        where: { name: { equals: existing.name.trim(), mode: "insensitive" } },
      });

      if (existingSeasonal) {
        await prisma.seasonalWorker.update({
          where: { id: existingSeasonal.id },
          data: {
            name: updatePayload.name || existingSeasonal.name,
            phone: updatePayload.phone !== undefined ? updatePayload.phone : existingSeasonal.phone,
            city: updatePayload.city !== undefined ? updatePayload.city : existingSeasonal.city,
            dailyWage: updatePayload.dailyWage !== undefined ? updatePayload.dailyWage : existingSeasonal.dailyWage,
            isActive: updatePayload.isActive !== undefined ? updatePayload.isActive : existingSeasonal.isActive,
          },
        });
      } else {
        await prisma.seasonalWorker.create({
          data: {
            name: updatePayload.name || existing.name,
            phone: updatePayload.phone || existing.phone,
            city: updatePayload.city || null,
            dailyWage: updatePayload.dailyWage || null,
            isActive: updatePayload.isActive ?? true,
          },
        });
      }
    }

    res.json({ worker: { ...worker, role: newRole } });
  } catch (error) {
    console.error("Greška pri izmeni radnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.delete("/workers/:id", requireManager, async (req, res) => {
  try {
    const existing = await prisma.worker.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Radnik nije pronađen." });
    }

    const currentWorkerRole = existing.role || existing.user?.role || (existing.type === "SEZONAC" ? "SEZONAC" : "OPERATER");

    if (currentWorkerRole === "DIREKTOR") {
      return res.status(403).json({ error: "Direktora nije moguće obrisati." });
    }

    if (currentWorkerRole === "RUKOVODILAC" && req.user.role !== "DIREKTOR") {
      return res.status(403).json({ error: "Samo direktor ima ovlašćenje da obriše rukovodioca." });
    }

    await prisma.worker.delete({ where: { id: req.params.id } });
    res.json({ message: "Radnik uspešno obrisan." });
  } catch (error) {
    console.error("Greška pri brisanju radnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 5. RADNE OPERACIJE (WORK TYPES)
// ==========================================
const workCategoryEnum = z.enum(["OBRADA", "ZASTITA", "SETVA", "ZETVA_BERBA", "TRANSPORT", "OSTALO"]);

const workTypeSchema = z.object({
  name: z.string().min(2, "Naziv operacije je obavezan").max(100),
  category: workCategoryEnum.default("OBRADA"),
  unit: z.string().max(20).default("ha"),
  fuelNormLitersPerHa: z.number().nonnegative().optional().nullable(),
  laborPricePerHa: z.number().nonnegative().optional().nullable(),
  totalPricePerHa: z.number().nonnegative().optional().nullable(),
  referenceFuelPrice: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get("/work-types", async (req, res) => {
  try {
    const workTypes = await prisma.workType.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    // Poverljivost cena: Operateri i Mehaničari vide samo usluge, bez cena i normativa!
    const canSeePrices = ["DIREKTOR", "RUKOVODILAC"].includes(req.user?.role);
    const sanitized = workTypes.map((wt) => {
      if (canSeePrices) return wt;
      const { fuelNormLitersPerHa, laborPricePerHa, totalPricePerHa, referenceFuelPrice, ...rest } = wt;
      return rest;
    });

    res.json({ workTypes: sanitized });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.post("/work-types", requireManager, async (req, res) => {
  try {
    const parsed = workTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const workType = await prisma.workType.create({ data: parsed.data });
    res.status(201).json({ workType });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Operacija sa ovim nazivom već postoji." });
    }
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.put("/work-types/:id", requireManager, async (req, res) => {
  try {
    const parsed = workTypeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const workType = await prisma.workType.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ workType });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.delete("/work-types/:id", requireManager, async (req, res) => {
  try {
    await prisma.workType.delete({ where: { id: req.params.id } });
    res.json({ message: "Operacija uspešno obrisana." });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 6. KULTURE I SORTE (CROPS)
// ==========================================
const cropSchema = z.object({
  name: z.string().min(2, "Naziv kulture je obavezan").max(100),
  variety: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get("/crops", async (req, res) => {
  try {
    const crops = await prisma.crop.findMany({
      orderBy: { name: "asc" },
    });
    res.json({ crops });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.post("/crops", requireManager, async (req, res) => {
  try {
    const parsed = cropSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const crop = await prisma.crop.create({ data: parsed.data });
    res.status(201).json({ crop });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.put("/crops/:id", requireManager, async (req, res) => {
  try {
    const parsed = cropSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const crop = await prisma.crop.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ crop });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.delete("/crops/:id", requireManager, async (req, res) => {
  try {
    await prisma.crop.delete({ where: { id: req.params.id } });
    res.json({ message: "Kultura uspešno obrisana." });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 7. PARTNERI (PARTNERS)
// ==========================================
const partnerTypeEnum = z.enum(["KUPAC", "DOBAVLJAC", "SERVIS", "OBA"]);

const partnerSchema = z.object({
  name: z.string().min(2, "Naziv partnera je obavezan").max(100),
  type: partnerTypeEnum.default("KUPAC"),
  pib: z.string().max(30).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email("Neispravan email").optional().nullable().or(z.literal("")).transform((val) => (val === "" ? null : val)),
  address: z.string().max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get("/partners", async (req, res) => {
  try {
    const partners = await prisma.partner.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    res.json({ partners });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.post("/partners", requireManager, async (req, res) => {
  try {
    const parsed = partnerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const partner = await prisma.partner.create({ data: parsed.data });
    res.status(201).json({ partner });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.put("/partners/:id", requireManager, async (req, res) => {
  try {
    const parsed = partnerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
    }
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ partner });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

router.delete("/partners/:id", requireManager, async (req, res) => {
  try {
    await prisma.partner.delete({ where: { id: req.params.id } });
    res.json({ message: "Partner uspešno obrisan." });
  } catch (error) {
    res.status(500).json({ error: "Greška na serveru." });
  }
});

export default router;

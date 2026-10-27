import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

const tollEntrySchema = z.object({
  date: z.string().optional(),
  machineId: z.string().min(1, "Vozilo / mašina je obavezna"),
  workerId: z.string().min(1, "Vozač / radnik je obavezan"),
  amount: z.number().positive("Iznos putarine mora biti veći od 0 RSD"),
  paymentMethod: z.enum(["ENP_TAG", "GOTOVINA", "KARTICA"]).default("ENP_TAG"),
  tagNumber: z.string().max(80).optional().nullable(),
  entryStation: z.string().max(100).optional().nullable(),
  exitStation: z.string().max(100).optional().nullable(),
  routeRelation: z.string().max(200).optional().nullable(),
  receiptNumber: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const tollTopUpSchema = z.object({
  date: z.string().optional(),
  machineId: z.string().min(1, "Vozilo / kamion je obavezan"),
  tagNumber: z.string().max(80).optional().nullable(),
  amount: z.number().positive("Iznos dopune mora biti veći od 0 RSD"),
  paymentReference: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const vehicleTagSchema = z.object({
  enpTagNumber: z.string().max(80).optional().nullable(),
  enpTagBalance: z.number().optional().nullable(),
});

// ==========================================
// 1. PREGLED PUTARINA, ENP TAGOVA I STATISTIKE
// ==========================================
router.get("/", async (req, res) => {
  try {
    const {
      machineId,
      workerId,
      paymentMethod,
      dateFrom,
      dateTo,
    } = req.query;

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    const where = {};
    if (machineId) where.machineId = String(machineId);
    if (workerId) where.workerId = String(workerId);
    if (paymentMethod) where.paymentMethod = String(paymentMethod);

    // Ako je ulogovan vozač / operater, vidi svoje unose putarina
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

    const dateFilter = {};
    if (dateFrom) {
      dateFilter.gte = new Date(String(dateFrom));
    }
    if (dateTo) {
      const dTo = new Date(String(dateTo));
      dTo.setHours(23, 59, 59, 999);
      dateFilter.lte = dTo;
    }
    if (Object.keys(dateFilter).length > 0) {
      where.date = dateFilter;
    }

    const topUpWhere = {};
    if (machineId) topUpWhere.machineId = String(machineId);
    if (Object.keys(dateFilter).length > 0) {
      topUpWhere.date = dateFilter;
    }

    const [entries, topUps, vehicles] = await Promise.all([
      prisma.tollEntry.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 300,
        include: {
          machine: {
            select: {
              id: true,
              name: true,
              type: true,
              regNumber: true,
              brandModel: true,
              enpTagNumber: true,
              enpTagBalance: true,
            },
          },
          worker: {
            select: {
              id: true,
              name: true,
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
      isManager
        ? prisma.tollTopUp.findMany({
            where: topUpWhere,
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 100,
            include: {
              machine: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  regNumber: true,
                  enpTagNumber: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.machine.findMany({
        where: { isActive: true },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          regNumber: true,
          brandModel: true,
          enpTagNumber: true,
          enpTagBalance: true,
        },
      }),
    ]);

    // Statistika za izabrani period
    let totalCostPeriod = 0;
    let enpCostPeriod = 0;
    let cashCardCostPeriod = 0;

    for (const entry of entries) {
      const amt = Number(entry.amount || 0);
      totalCostPeriod += amt;
      if (entry.paymentMethod === "ENP_TAG") {
        enpCostPeriod += amt;
      } else {
        cashCardCostPeriod += amt;
      }
    }

    const totalTopUpsPeriod = topUps.reduce((acc, t) => acc + Number(t.amount || 0), 0);

    // Zbirno stanje na svim ENP tagovima (kamioni i mašine koje imaju ENP tag ili su tipa KAMION)
    const taggedVehicles = vehicles.filter(
      (v) => v.type === "KAMION" || Boolean(v.enpTagNumber) || Number(v.enpTagBalance || 0) !== 0
    );
    const totalTagBalance = taggedVehicles.reduce((acc, v) => acc + Number(v.enpTagBalance || 0), 0);

    res.json({
      entries,
      topUps,
      vehicles,
      taggedVehicles,
      stats: {
        totalCostPeriod: Math.round(totalCostPeriod),
        enpCostPeriod: Math.round(enpCostPeriod),
        cashCardCostPeriod: Math.round(cashCardCostPeriod),
        totalEntriesCount: entries.length,
        totalTopUpsPeriod: Math.round(totalTopUpsPeriod),
        totalTagBalance: Math.round(totalTagBalance),
      },
    });
  } catch (error) {
    console.error("Greška pri učitavanju putarina:", error);
    res.status(500).json({ error: "Greška na serveru pri učitavanju putarina." });
  }
});

// ==========================================
// 2. UNOS NOVE PUTARINE (VOZAČI, RUKOVODILAC, DIREKTOR)
// ==========================================
router.post("/", async (req, res) => {
  try {
    const parsed = tollEntrySchema.safeParse({
      ...req.body,
      amount: Number(req.body.amount),
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const machine = await prisma.machine.findUnique({ where: { id: data.machineId } });
    if (!machine) {
      return res.status(404).json({ error: "Izabrano vozilo nije pronađeno." });
    }

    const resolvedTagNumber = data.tagNumber?.trim() || machine.enpTagNumber || null;
    const resolvedRoute =
      data.routeRelation?.trim() ||
      (data.entryStation || data.exitStation
        ? `${data.entryStation || "?"} - ${data.exitStation || "?"}`
        : null);

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.tollEntry.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          machineId: data.machineId,
          workerId: data.workerId,
          amount: data.amount,
          paymentMethod: data.paymentMethod,
          tagNumber: resolvedTagNumber,
          entryStation: data.entryStation?.trim() || null,
          exitStation: data.exitStation?.trim() || null,
          routeRelation: resolvedRoute,
          receiptNumber: data.receiptNumber?.trim() || null,
          notes: data.notes?.trim() || null,
          createdById: req.user.id,
        },
        include: {
          machine: true,
          worker: true,
        },
      });

      // Ako je plaćeno ENP tagom, umanji stanje kredita na ENP tagu vozila
      if (data.paymentMethod === "ENP_TAG") {
        const currentBal = Number(machine.enpTagBalance || 0);
        await tx.machine.update({
          where: { id: machine.id },
          data: {
            enpTagBalance: currentBal - data.amount,
            ...(resolvedTagNumber && !machine.enpTagNumber ? { enpTagNumber: resolvedTagNumber } : {}),
          },
        });
      } else if (resolvedTagNumber && !machine.enpTagNumber) {
        await tx.machine.update({
          where: { id: machine.id },
          data: { enpTagNumber: resolvedTagNumber },
        });
      }

      await tx.auditLog.create({
        data: {
          entityType: "TollEntry",
          entityId: created.id,
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name || "Korisnik",
          userRole: req.user.role || "OPERATER",
          description: `Uneta putarina za vozilo ${machine.name}: ${data.amount} RSD (${data.paymentMethod})`,
          newValues: {
            machine: machine.name,
            worker: created.worker?.name,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            routeRelation: resolvedRoute,
          },
        },
      });

      return created;
    });

    res.status(201).json({ entry });
  } catch (error) {
    console.error("Greška pri unosu putarine:", error);
    res.status(500).json({ error: "Greška na serveru pri čuvanju putarine." });
  }
});

// ==========================================
// 3. IZMENA PUTARINE (DIREKTOR I RUKOVODILAC)
// ==========================================
router.put("/:id", requireManager, async (req, res) => {
  try {
    const existing = await prisma.tollEntry.findUnique({
      where: { id: req.params.id },
      include: { machine: true, worker: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o putarini nije pronađen." });
    }

    const parsed = tollEntrySchema.partial().safeParse({
      ...req.body,
      ...(req.body.amount !== undefined ? { amount: Number(req.body.amount) } : {}),
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const newMachineId = data.machineId || existing.machineId;
    const newAmount = data.amount !== undefined ? data.amount : existing.amount;
    const newPaymentMethod = data.paymentMethod || existing.paymentMethod;

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Vrati staro stanje ENP taga ako je stari zapis bio ENP_TAG
      if (existing.paymentMethod === "ENP_TAG") {
        const oldMachine = await tx.machine.findUnique({ where: { id: existing.machineId } });
        if (oldMachine) {
          await tx.machine.update({
            where: { id: oldMachine.id },
            data: {
              enpTagBalance: Number(oldMachine.enpTagBalance || 0) + Number(existing.amount || 0),
            },
          });
        }
      }

      // 2. Oduzmi novo stanje ako je novi zapis ENP_TAG
      if (newPaymentMethod === "ENP_TAG") {
        const targetMachine = await tx.machine.findUnique({ where: { id: newMachineId } });
        if (targetMachine) {
          await tx.machine.update({
            where: { id: targetMachine.id },
            data: {
              enpTagBalance: Number(targetMachine.enpTagBalance || 0) - Number(newAmount || 0),
              ...(data.tagNumber ? { enpTagNumber: data.tagNumber.trim() } : {}),
            },
          });
        }
      }

      const resolvedRoute =
        data.routeRelation !== undefined
          ? data.routeRelation?.trim() || null
          : existing.routeRelation;

      const record = await tx.tollEntry.update({
        where: { id: existing.id },
        data: {
          ...(data.date ? { date: new Date(data.date) } : {}),
          machineId: newMachineId,
          ...(data.workerId ? { workerId: data.workerId } : {}),
          amount: newAmount,
          paymentMethod: newPaymentMethod,
          ...(data.tagNumber !== undefined ? { tagNumber: data.tagNumber?.trim() || null } : {}),
          ...(data.entryStation !== undefined ? { entryStation: data.entryStation?.trim() || null } : {}),
          ...(data.exitStation !== undefined ? { exitStation: data.exitStation?.trim() || null } : {}),
          routeRelation: resolvedRoute,
          ...(data.receiptNumber !== undefined ? { receiptNumber: data.receiptNumber?.trim() || null } : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        },
        include: {
          machine: true,
          worker: true,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "TollEntry",
          entityId: record.id,
          action: "IZMENA",
          userId: req.user.id,
          userName: req.user.name || "Korisnik",
          userRole: req.user.role,
          description: `Izmenjena putarina za vozilo ${record.machine.name}: ${existing.amount} RSD -> ${record.amount} RSD`,
          oldValues: { amount: existing.amount, paymentMethod: existing.paymentMethod },
          newValues: { amount: record.amount, paymentMethod: record.paymentMethod },
        },
      });

      return record;
    });

    res.json({ entry: updated });
  } catch (error) {
    console.error("Greška pri izmeni putarine:", error);
    res.status(500).json({ error: "Greška na serveru pri izmeni putarine." });
  }
});

// ==========================================
// 4. BRISANJE PUTARINE (DIREKTOR I RUKOVODILAC)
// ==========================================
router.delete("/:id", requireManager, async (req, res) => {
  try {
    const existing = await prisma.tollEntry.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o putarini nije pronađen." });
    }

    await prisma.$transaction(async (tx) => {
      if (existing.paymentMethod === "ENP_TAG") {
        const machine = await tx.machine.findUnique({ where: { id: existing.machineId } });
        if (machine) {
          await tx.machine.update({
            where: { id: machine.id },
            data: {
              enpTagBalance: Number(machine.enpTagBalance || 0) + Number(existing.amount || 0),
            },
          });
        }
      }

      await tx.tollEntry.delete({ where: { id: existing.id } });

      await tx.auditLog.create({
        data: {
          entityType: "TollEntry",
          entityId: existing.id,
          action: "STORNO",
          userId: req.user.id,
          userName: req.user.name || "Korisnik",
          userRole: req.user.role,
          description: `Obrisana putarina za vozilo ${existing.machine?.name || ""}: ${existing.amount} RSD`,
          oldValues: { amount: existing.amount, paymentMethod: existing.paymentMethod },
        },
      });
    });

    res.json({ message: "Putarina je uspešno obrisana." });
  } catch (error) {
    console.error("Greška pri brisanju putarine:", error);
    res.status(500).json({ error: "Greška na serveru pri brisanju putarine." });
  }
});

// ==========================================
// 5. DOPUNA ENP TAGA (DIREKTOR I RUKOVODILAC)
// ==========================================
router.post("/top-up", requireManager, async (req, res) => {
  try {
    const parsed = tollTopUpSchema.safeParse({
      ...req.body,
      amount: Number(req.body.amount),
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const data = parsed.data;
    const machine = await prisma.machine.findUnique({ where: { id: data.machineId } });
    if (!machine) {
      return res.status(404).json({ error: "Vozilo nije pronađeno." });
    }

    const resolvedTag = data.tagNumber?.trim() || machine.enpTagNumber || null;

    const topUp = await prisma.$transaction(async (tx) => {
      const created = await tx.tollTopUp.create({
        data: {
          date: data.date ? new Date(data.date) : new Date(),
          machineId: data.machineId,
          tagNumber: resolvedTag,
          amount: data.amount,
          paymentReference: data.paymentReference?.trim() || null,
          notes: data.notes?.trim() || null,
          createdById: req.user.id,
        },
        include: {
          machine: true,
        },
      });

      const currentBal = Number(machine.enpTagBalance || 0);
      await tx.machine.update({
        where: { id: machine.id },
        data: {
          enpTagBalance: currentBal + data.amount,
          ...(resolvedTag ? { enpTagNumber: resolvedTag } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "TollTopUp",
          entityId: created.id,
          action: "KREIRANJE",
          userId: req.user.id,
          userName: req.user.name || "Korisnik",
          userRole: req.user.role,
          description: `Dopuna ENP taga za vozilo ${machine.name}: +${data.amount} RSD`,
          newValues: {
            machine: machine.name,
            tagNumber: resolvedTag,
            amount: data.amount,
            newBalance: currentBal + data.amount,
          },
        },
      });

      return created;
    });

    res.status(201).json({ topUp });
  } catch (error) {
    console.error("Greška pri dopuni ENP taga:", error);
    res.status(500).json({ error: "Greška na serveru pri dopuni ENP taga." });
  }
});

// ==========================================
// 6. BRISANJE DOPUNE ENP TAGA
// ==========================================
router.delete("/top-up/:id", requireManager, async (req, res) => {
  try {
    const existing = await prisma.tollTopUp.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Dopuna ENP taga nije pronađena." });
    }

    await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findUnique({ where: { id: existing.machineId } });
      if (machine) {
        await tx.machine.update({
          where: { id: machine.id },
          data: {
            enpTagBalance: Number(machine.enpTagBalance || 0) - Number(existing.amount || 0),
          },
        });
      }

      await tx.tollTopUp.delete({ where: { id: existing.id } });
    });

    res.json({ message: "Dopuna ENP taga je obrisana." });
  } catch (error) {
    console.error("Greška pri brisanju dopune ENP taga:", error);
    res.status(500).json({ error: "Greška na serveru pri brisanju dopune." });
  }
});

// ==========================================
// 7. PODEŠAVANJE ENP TAGA I STANJA NA VOZILU
// ==========================================
router.put("/vehicle-tag/:machineId", requireManager, async (req, res) => {
  try {
    const parsed = vehicleTagSchema.safeParse({
      enpTagNumber: req.body.enpTagNumber,
      enpTagBalance:
        req.body.enpTagBalance !== undefined && req.body.enpTagBalance !== ""
          ? Number(req.body.enpTagBalance)
          : undefined,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const updated = await prisma.machine.update({
      where: { id: req.params.machineId },
      data: {
        ...(parsed.data.enpTagNumber !== undefined
          ? { enpTagNumber: parsed.data.enpTagNumber?.trim() || null }
          : {}),
        ...(parsed.data.enpTagBalance !== undefined
          ? { enpTagBalance: parsed.data.enpTagBalance }
          : {}),
      },
    });

    res.json({ machine: updated });
  } catch (error) {
    console.error("Greška pri ažuriranju ENP taga vozila:", error);
    res.status(500).json({ error: "Greška na serveru pri ažuriranju ENP taga." });
  }
});

export default router;


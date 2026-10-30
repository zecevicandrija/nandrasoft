import { inventoryMutation } from "../lib/inventoryTransaction.js";
import { requireWorkerIdentity, resolveWorkerForUser } from "../lib/workerIdentity.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);
router.use(requireWorkerIdentity);

const tollEntrySchema = z.object({
  date: z.string().optional(),
  machineId: z.string().min(1, "Vozilo / mašina je obavezna"),
  workerId: z.string().optional().nullable(),
  amount: z.number().positive("Iznos putarine mora biti veći od 0 RSD"),
  paymentMethod: z.enum(["ENP_TAG", "GOTOVINA", "KARTICA"]).default("ENP_TAG"),
  tagNumber: z.string().max(80).optional().nullable(),
  entryStation: z.string().max(100).optional().nullable(),
  exitStation: z.string().max(100).optional().nullable(),
  routeRelation: z.string().max(200).optional().nullable(),
  receiptNumber: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// Pomoćna funkcija za parsiranje datuma u lokalnoj vremenskoj zoni
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const now = new Date();
    return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  }
  return new Date(s);
}

// Pomoćna funkcija: proverava da li je zapis unet danas (do kraja današnjeg dana)
function isRecordFromToday(entry) {
  if (!entry) return false;
  const now = new Date();
  const d = new Date(entry.date);
  const c = entry.createdAt ? new Date(entry.createdAt) : d;

  const sameEntryDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const sameCreatedDay =
    c.getFullYear() === now.getFullYear() &&
    c.getMonth() === now.getMonth() &&
    c.getDate() === now.getDate();

  return sameEntryDay && sameCreatedDay;
}

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
// 1. PREGLED PUTARINA, ENP TAGOVA I STATISTIKE (PAGINIRANO PO 25)
// ==========================================
router.get("/", async (req, res) => {
  try {
    const {
      machineId,
      workerId,
      paymentMethod,
      dateFrom,
      dateTo,
      page,
      entriesPage,
      topUpsPage,
      limit = 25,
    } = req.query;

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    const takeLimit = Math.min(Math.max(1, Number(limit) || 25), 100);
    const entriesPageNum = Math.max(1, Number(entriesPage || page) || 1);
    const topUpsPageNum = Math.max(1, Number(topUpsPage) || 1);

    const entriesSkip = (entriesPageNum - 1) * takeLimit;
    const topUpsSkip = (topUpsPageNum - 1) * takeLimit;

    const where = {};
    if (machineId) where.machineId = String(machineId);
    if (isManager && workerId) where.workerId = String(workerId);
    if (paymentMethod) where.paymentMethod = String(paymentMethod);

    // Izolacija podataka: Radnik vidi isključivo sopstvene unose putarina (ne vidi tuđe)
    let linkedWorker = null;
    if (!isManager) {
      linkedWorker = await resolveWorkerForUser(req.user);
      if (linkedWorker) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [{ createdById: req.user.id }, { workerId: linkedWorker.id }],
          },
        ];
      } else {
        where.createdById = req.user.id;
      }
    } else {
      linkedWorker = await resolveWorkerForUser(req.user);
    }

    const dateFilter = {};
    if (dateFrom) {
      const dFrom = parseLocalDate(String(dateFrom));
      dFrom.setHours(0, 0, 0, 0);
      dateFilter.gte = dFrom;
    }
    if (dateTo) {
      const dTo = parseLocalDate(String(dateTo));
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

    const [
      rawEntries,
      totalEntriesCount,
      entriesByMethod,
      topUps,
      totalTopUpsCount,
      topUpsAgg,
      vehicles,
    ] = await Promise.all([
      prisma.tollEntry.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: entriesSkip,
        take: takeLimit,
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
              userId: true,
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
      prisma.tollEntry.count({ where }),
      prisma.tollEntry.groupBy({
        by: ["paymentMethod"],
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      isManager
        ? prisma.tollTopUp.findMany({
            where: topUpWhere,
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            skip: topUpsSkip,
            take: takeLimit,
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
      isManager ? prisma.tollTopUp.count({ where: topUpWhere }) : Promise.resolve(0),
      isManager
        ? prisma.tollTopUp.aggregate({
            where: topUpWhere,
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: 0 } }),
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

    // Dodaj zastavice isToday i canEdit za svaki zapis
    const entries = rawEntries.map((entry) => {
      const isToday = isRecordFromToday(entry);
      const isOwner =
        entry.createdById === req.user.id ||
        (linkedWorker && entry.workerId === linkedWorker.id);
      const canEdit = isManager || (isOwner && isToday);
      return {
        ...entry,
        isToday,
        canEdit,
      };
    });

    // Statistika iz baze za ceo filtrirani opseg (bez učitavanja svih redova u memoriju)
    let totalCostPeriod = 0;
    let enpCostPeriod = 0;
    let cashCardCostPeriod = 0;

    for (const grp of entriesByMethod) {
      const amt = Number(grp._sum?.amount || 0);
      totalCostPeriod += amt;
      if (grp.paymentMethod === "ENP_TAG") {
        enpCostPeriod += amt;
      } else {
        cashCardCostPeriod += amt;
      }
    }

    const totalTopUpsPeriod = Number(topUpsAgg?._sum?.amount || 0);

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
      currentWorker: linkedWorker ? { id: linkedWorker.id, name: linkedWorker.name } : null,
      entriesPagination: {
        total: totalEntriesCount,
        page: entriesPageNum,
        limit: takeLimit,
        totalPages: Math.max(1, Math.ceil(totalEntriesCount / takeLimit)),
      },
      topUpsPagination: {
        total: totalTopUpsCount,
        page: topUpsPageNum,
        limit: takeLimit,
        totalPages: Math.max(1, Math.ceil(totalTopUpsCount / takeLimit)),
      },
      stats: {
        totalCostPeriod: Math.round(totalCostPeriod),
        enpCostPeriod: Math.round(enpCostPeriod),
        cashCardCostPeriod: Math.round(cashCardCostPeriod),
        totalEntriesCount,
        totalTopUpsCount,
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
router.post("/", inventoryMutation("tolls", async (req, res, prisma) => {
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
    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    const machine = await prisma.machine.findUnique({ where: { id: data.machineId } });
    if (!machine) {
      return res.status(404).json({ error: "Izabrano vozilo nije pronađeno." });
    }

    // Za radnika (ne-menadžera) uvek vezujemo unos za njegov sopstveni profil radnika
    let finalWorkerId = data.workerId;
    if (!isManager) {
      const linkedWorker = await resolveWorkerForUser(req.user);
      if (!linkedWorker) {
        return res.status(400).json({ error: "Nije moguće povezati profil radnika za vaš nalog." });
      }
      finalWorkerId = linkedWorker.id;
    } else if (!finalWorkerId) {
      const linkedWorker = await resolveWorkerForUser(req.user);
      if (linkedWorker) {
        finalWorkerId = linkedWorker.id;
      }
    }

    if (!finalWorkerId) {
      return res.status(400).json({ error: "Vozač / radnik je obavezan." });
    }

    // Radnik unosi putarinu za tekući (današnji) dan; menadžer može izabrati bilo koji datum
    const entryDate = isManager && data.date ? parseLocalDate(data.date) : new Date();

    const resolvedTagNumber = data.tagNumber?.trim() || machine.enpTagNumber || null;
    const resolvedRoute =
      data.routeRelation?.trim() ||
      (data.entryStation || data.exitStation
        ? `${data.entryStation || "?"} - ${data.exitStation || "?"}`
        : null);

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.tollEntry.create({
        data: {
          date: entryDate,
          machineId: data.machineId,
          workerId: finalWorkerId,
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
        await tx.machine.update({
          where: { id: machine.id },
          data: {
            enpTagBalance: { decrement: data.amount },
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
}));

// ==========================================
// 3. IZMENA PUTARINE (MENADŽERI UVEK, RADNIK SAMO SVOJ UNOS DO KRAJA DANA)
// ==========================================
router.put("/:id", inventoryMutation("tolls", async (req, res, prisma) => {
  try {
    const existing = await prisma.tollEntry.findUnique({
      where: { id: req.params.id },
      include: { machine: true, worker: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o putarini nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    if (!isManager) {
      const linkedWorker = await resolveWorkerForUser(req.user);
      const isOwner =
        existing.createdById === req.user.id ||
        (linkedWorker && existing.workerId === linkedWorker.id);

      if (!isOwner) {
        return res.status(403).json({
          error: "Možete menjati isključivo sopstvene unose putarina.",
        });
      }

      if (!isRecordFromToday(existing)) {
        return res.status(403).json({
          error:
            "Rok za izmenu je istekao. Putarinu možete menjati samo do kraja dana u kojem je uneta.",
        });
      }
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
              enpTagBalance: { increment: Number(existing.amount || 0) },
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
              enpTagBalance: { decrement: Number(newAmount || 0) },
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
          ...(isManager && data.date ? { date: parseLocalDate(data.date) } : {}),
          machineId: newMachineId,
          ...(isManager && data.workerId ? { workerId: data.workerId } : {}),
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
}));

// ==========================================
// 4. BRISANJE PUTARINE (MENADŽERI UVEK, RADNIK SAMO SVOJ UNOS DO KRAJA DANA)
// ==========================================
router.delete("/:id", inventoryMutation("tolls", async (req, res, prisma) => {
  try {
    const existing = await prisma.tollEntry.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Zapis o putarini nije pronađen." });
    }

    const isManager = ["DIREKTOR", "RUKOVODILAC"].includes(req.user.role);

    if (!isManager) {
      const linkedWorker = await resolveWorkerForUser(req.user);
      const isOwner =
        existing.createdById === req.user.id ||
        (linkedWorker && existing.workerId === linkedWorker.id);

      if (!isOwner) {
        return res.status(403).json({
          error: "Možete brisati isključivo sopstvene unose putarina.",
        });
      }

      if (!isRecordFromToday(existing)) {
        return res.status(403).json({
          error:
            "Rok za brisanje je istekao. Putarinu možete obrisati samo do kraja dana u kojem je uneta.",
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (existing.paymentMethod === "ENP_TAG") {
        const machine = await tx.machine.findUnique({ where: { id: existing.machineId } });
        if (machine) {
          await tx.machine.update({
            where: { id: machine.id },
            data: {
              enpTagBalance: { increment: Number(existing.amount || 0) },
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
}));

// ==========================================
// 5. DOPUNA ENP TAGA (DIREKTOR I RUKOVODILAC)
// ==========================================
router.post("/top-up", requireManager, inventoryMutation("tolls", async (req, res, prisma) => {
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

      const updatedMachine = await tx.machine.update({
        where: { id: machine.id },
        data: {
          enpTagBalance: { increment: data.amount },
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
            newBalance: updatedMachine.enpTagBalance,
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
}));

// ==========================================
// 6. BRISANJE DOPUNE ENP TAGA
// ==========================================
router.delete("/top-up/:id", requireManager, inventoryMutation("tolls", async (req, res, prisma) => {
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
            enpTagBalance: { decrement: Number(existing.amount || 0) },
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
}));

// ==========================================
// 7. PODEŠAVANJE ENP TAGA I STANJA NA VOZILU
// ==========================================
router.put("/vehicle-tag/:machineId", requireManager, inventoryMutation("tolls", async (req, res, prisma) => {
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
}));

export default router;


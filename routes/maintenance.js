import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, requireManager } from "../middlewares/auth.js";
import { sendWorkOrderPushNotification } from "../lib/pushNotification.js";

const router = Router();

// Svi endpointi radionice zahtevaju ulogovanog korisnika i ulogu MEHANICAR, RUKOVODILAC ili DIREKTOR
router.use(requireAuth);
router.use(requireRole(["MEHANICAR", "RUKOVODILAC", "DIREKTOR"]));

/**
 * Pomoćna funkcija za pronalaženje ili povezivanje radnika sa nalogom korisnika
 */
async function getOrCreateWorkerForUser(user) {
  let worker = await prisma.worker.findFirst({
    where: { userId: user.id },
  });

  if (!worker) {
    worker = await prisma.worker.findFirst({
      where: { name: user.name },
    });
    if (worker) {
      worker = await prisma.worker.update({
        where: { id: worker.id },
        data: { userId: user.id },
      });
    } else {
      worker = await prisma.worker.create({
        data: {
          name: user.name,
          userId: user.id,
          type: "STALNI",
          phone: user.phone || null,
        },
      });
    }
  }

  return worker;
}

/**
 * Pomoćna funkcija za generisanje sledećeg broja radnog naloga
 */
async function generateOrderNumber() {
  const currentYear = new Date().getFullYear();
  const prefix = `RN-${currentYear}-`;

  const lastOrder = await prisma.workOrder.findFirst({
    where: {
      orderNumber: { startsWith: prefix },
    },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  let nextSeq = 1;
  if (lastOrder && lastOrder.orderNumber) {
    const parts = lastOrder.orderNumber.split("-");
    const lastNum = parseInt(parts[2], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Pomoćna funkcija koja proverava da li neka mašina ima status U_KVARU
 * a nema otvoren zapis u maintenanceIssue, i automatski ga kreira
 */
async function syncBrokenMachines(userId) {
  try {
    const brokenWithoutIssue = await prisma.machine.findMany({
      where: {
        status: "U_KVARU",
        maintenanceIssues: {
          none: {
            status: { in: ["OTVOREN", "U_RADU", "CEKA_DELOVE"] },
          },
        },
      },
      include: {
        assignments: {
          where: { status: "VRACENA_SA_KVAROM" },
          orderBy: { returnedAt: "desc" },
          take: 1,
        },
      },
    });

    if (brokenWithoutIssue.length > 0) {
      const defaultWorker = await prisma.worker.findFirst();
      const defaultUser = await prisma.user.findFirst();

      for (const m of brokenWithoutIssue) {
        const lastAss = m.assignments[0];
        await prisma.maintenanceIssue.create({
          data: {
            serviceType: "KVAR_NJIVA",
            priority: "VISOKA",
            status: "OTVOREN",
            machineId: m.id,
            parcelId: lastAss?.parcelId || null,
            reportedById: lastAss?.workerId || defaultWorker?.id,
            title: `Prijava kvara pri razduživanju: ${m.name}`,
            description: lastAss?.returnNotes || "Radnik prijavio neispravnost prilikom razduživanja mašine.",
            isMachineStopped: true,
            createdById: lastAss?.createdById || userId || defaultUser?.id,
          },
        });
      }
    }
  } catch (err) {
    console.warn("Greška pri sinhronizaciji pokvarenih mašina:", err);
  }
}

// ==========================================
// 1. STATISTIKA RADIONICE (DASHBOARD KARTICE)
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const [
      brokenIssues,
      inRepairIssues,
      waitingPartsIssues,
      repairedIssues,
      freeMachines,
      brokenMachines,
      serviceMachines,
      remontOrders,
    ] = await Promise.all([
      prisma.maintenanceIssue.count({ where: { status: "OTVOREN" } }),
      prisma.maintenanceIssue.count({ where: { status: "U_RADU" } }),
      prisma.maintenanceIssue.count({ where: { status: "CEKA_DELOVE" } }),
      prisma.maintenanceIssue.count({ where: { status: "POPRAVLJENO" } }),
      prisma.machine.count({ where: { status: "SLOBODNA", isActive: true } }),
      prisma.machine.count({ where: { status: "U_KVARU", isActive: true } }),
      prisma.machine.count({ where: { status: "SERVIS", isActive: true } }),
      prisma.workOrder.count({
        where: {
          orderType: "REMONT_SERVIS",
          status: { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] },
        },
      }),
    ]);

    res.json({
      brokenIssues,
      inRepairIssues,
      waitingPartsIssues,
      repairedIssues,
      totalActiveIssues: brokenIssues + inRepairIssues + waitingPartsIssues,
      freeMachines,
      brokenMachines,
      serviceMachines,
      remontOrders,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju statistike radionice:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 2. LISTA KVAROVA SA FILTERIMA (TAB 1 I TAB 3)
// ==========================================
router.get("/issues", async (req, res) => {
  try {
    const { status, machineId, priority, serviceType, search } = req.query;

    const where = {};

    if (status && status !== "SVE") {
      if (status === "AKTIVNI") {
        where.status = { in: ["OTVOREN", "U_RADU", "CEKA_DELOVE"] };
      } else {
        where.status = String(status);
      }
    }

    if (machineId) where.machineId = String(machineId);
    if (priority) where.priority = String(priority);
    if (serviceType) where.serviceType = String(serviceType);

    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: "insensitive" } },
        { description: { contains: String(search), mode: "insensitive" } },
        { partsReplaced: { contains: String(search), mode: "insensitive" } },
        { machine: { name: { contains: String(search), mode: "insensitive" } } },
      ];
    }

    const issues = await prisma.maintenanceIssue.findMany({
      where,
      include: {
        machine: true,
        reportedBy: { select: { id: true, name: true, phone: true } },
        mechanic: { select: { id: true, name: true, phone: true } },
        servicePartner: { select: { id: true, name: true, phone: true } },
        parcel: { select: { id: true, code: true, name: true } },
        workOrder: { select: { id: true, orderNumber: true, status: true } },
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ dateReported: "desc" }, { createdAt: "desc" }],
    });

    res.json({ issues });
  } catch (error) {
    console.error("Greška pri dohvatanju kvarova:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 3. RUČNA PRIJAVA KVARA
// ==========================================
const createIssueSchema = z.object({
  machineId: z.string().min(1, "Mašina je obavezna"),
  serviceType: z.enum(["KVAR_NJIVA", "REDOVAN_SERVIS", "GENERALNI_REMONT"]).default("KVAR_NJIVA"),
  priority: z.enum(["NISKA", "SREDNJA", "VISOKA", "KRITICNA"]).default("VISOKA"),
  title: z.string().min(3, "Naslov kvara mora imati bar 3 karaktera"),
  description: z.string().optional().nullable(),
  parcelId: z.string().optional().nullable(),
  servicePartnerId: z.string().optional().nullable(),
  isMachineStopped: z.boolean().default(true),
});

router.post("/issues", async (req, res) => {
  try {
    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const worker = await getOrCreateWorkerForUser(req.user);

    const machine = await prisma.machine.findUnique({
      where: { id: parsed.data.machineId },
    });

    if (!machine) {
      return res.status(404).json({ error: "Mašina nije pronađena." });
    }

    const newMachineStatus = parsed.data.serviceType === "KVAR_NJIVA" ? "U_KVARU" : "SERVIS";

    const [issue] = await prisma.$transaction([
      prisma.maintenanceIssue.create({
        data: {
          machineId: parsed.data.machineId,
          serviceType: parsed.data.serviceType,
          priority: parsed.data.priority,
          title: parsed.data.title,
          description: parsed.data.description || null,
          parcelId: parsed.data.parcelId || null,
          servicePartnerId: parsed.data.servicePartnerId || null,
          reportedById: worker.id,
          isMachineStopped: parsed.data.isMachineStopped,
          status: "OTVOREN",
          createdById: req.user.id,
        },
        include: {
          machine: true,
          reportedBy: true,
        },
      }),
      prisma.machine.update({
        where: { id: parsed.data.machineId },
        data: { status: newMachineStatus },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        entityType: "MaintenanceIssue",
        entityId: issue.id,
        action: "KREIRANJE",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Prijavljen kvar/servis za mašinu "${machine.name}": ${issue.title}`,
        newValues: issue,
      },
    });

    res.status(201).json({ message: "Kvar je uspešno evidentiran.", issue });
  } catch (error) {
    console.error("Greška pri prijavi kvara:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 4. RADNI NALOZI ZA REMONT (TAB 2)
// ==========================================
router.get("/remont-orders", async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let orders = await prisma.workOrder.findMany({
      where: {
        orderType: "REMONT_SERVIS",
        OR: [
          // 1. Svi nalozi koji još uvek nisu završeni ili otkazani
          { status: { in: ["PLANIRAN", "DODELJEN", "U_TOKU"] } },
          // 2. Završeni nalozi ali SAMO ONI koji su završeni DANAS (vidljivi do kraja dana do 23:59:59h)
          {
            status: "ZAVRSEN",
            updatedAt: { gte: startOfToday },
          },
        ],
      },
      include: {
        machine: true,
        attachment: true,
        worker: true,
        issuedBy: { select: { id: true, name: true, role: true } },
        maintenance: true,
      },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    });

    // Automatska sinhronizacija: ako neki nalog za remont nema povezan MaintenanceIssue, kreiraj ga odmah
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (!order.maintenance && order.machineId) {
        const priorityMap = {
          KRITICNO: "KRITICNA",
          HITNO: "VISOKA",
          NORMALNO: "SREDNJA",
        };
        const issuePriority = priorityMap[order.priority] || "VISOKA";
        const issueStatus =
          order.status === "ZAVRSEN"
            ? "POPRAVLJENO"
            : order.status === "U_TOKU"
            ? "U_RADU"
            : "OTVOREN";

        const newIssue = await prisma.maintenanceIssue.create({
          data: {
            machineId: order.machineId,
            serviceType: "REDOVAN_SERVIS",
            priority: issuePriority,
            status: issueStatus,
            reportedById: order.workerId,
            mechanicId: order.workerId,
            title: `Radni nalog ${order.orderNumber}: ${
              order.instructions ? order.instructions.slice(0, 50) : "Servis mašine"
            }`,
            description: order.instructions || "Planski remont i servis mehanizacije.",
            isMachineStopped: true,
            createdById: order.issuedById,
          },
          include: {
            machine: true,
            mechanic: true,
            reportedBy: true,
          },
        });

        await prisma.workOrder.update({
          where: { id: order.id },
          data: { maintenanceId: newIssue.id },
        });

        orders[i].maintenance = newIssue;
        orders[i].maintenanceId = newIssue.id;

        // Takođe sinhronizuj status mašine u SERVIS ako nije završeno
        if (
          order.status !== "ZAVRSEN" &&
          order.machine &&
          order.machine.status !== "SERVIS" &&
          order.machine.status !== "U_KVARU"
        ) {
          await prisma.machine.update({
            where: { id: order.machineId },
            data: { status: "SERVIS" },
          });
        }
      }
    }

    res.json({ orders });
  } catch (error) {
    console.error("Greška pri dohvatanju naloga za remont:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 5. IZDAVANJE NALOGA ZA REMONT (RUKOVODILAC & DIREKTOR)
// ==========================================
const createRemontOrderSchema = z.object({
  machineId: z.string().min(1, "Mašina je obavezna"),
  workerId: z.string().min(1, "Mehaničar je obavezan"),
  orderDate: z.string().or(z.date()),
  priority: z.enum(["NISKA", "SREDNJA", "VISOKA", "KRITICNA"]).default("VISOKA"),
  serviceType: z.enum(["REDOVAN_SERVIS", "GENERALNI_REMONT", "KVAR_NJIVA"]).default("REDOVAN_SERVIS"),
  instructions: z.string().min(3, "Uputstvo/opis radova je obavezno"),
});

router.post("/remont-order", requireManager, async (req, res) => {
  try {
    const parsed = createRemontOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const { machineId, workerId, orderDate, priority, serviceType, instructions } = parsed.data;

    const machine = await prisma.machine.findUnique({ where: { id: machineId } });
    if (!machine) return res.status(404).json({ error: "Mašina nije pronađena." });

    const orderNumber = await generateOrderNumber();

    // Kreiramo MaintenanceIssue i povezani WorkOrder u transakciji, a mašinu stavljamo u status SERVIS
    const issue = await prisma.maintenanceIssue.create({
      data: {
        machineId,
        serviceType,
        priority,
        status: "OTVOREN",
        reportedById: workerId,
        mechanicId: workerId,
        title: `Radni nalog ${orderNumber}: ${instructions.slice(0, 50)}`,
        description: instructions,
        isMachineStopped: true,
        createdById: req.user.id,
      },
    });

    const workOrder = await prisma.workOrder.create({
      data: {
        orderNumber,
        orderDate: new Date(orderDate),
        orderType: "REMONT_SERVIS",
        priority,
        status: "DODELJEN",
        workerId,
        machineId,
        instructions,
        maintenanceId: issue.id,
        issuedById: req.user.id,
      },
      include: {
        machine: true,
        worker: true,
        issuedBy: { select: { id: true, name: true, role: true } },
        maintenance: true,
      },
    });

    await prisma.machine.update({
      where: { id: machineId },
      data: { status: "SERVIS" },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "WorkOrder",
        entityId: workOrder.id,
        action: "KREIRANJE",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Izdat servisni radni nalog ${workOrder.orderNumber} za mašinu "${machine.name}"`,
        newValues: workOrder,
      },
    });

    // Pošalji Web Push notifikaciju mehaničaru/radniku na telefon
    await sendWorkOrderPushNotification(workOrder.workerId, workOrder);

    res.status(201).json({
      message: `Radni nalog ${orderNumber} za remont je uspešno izdat.`,
      workOrder,
    });
  } catch (error) {
    console.error("Greška pri kreiranju servisnog radnog naloga:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 6. PROMENA STATUSA KVARA (PREUZMI U RAD, ČEKA DELOVE)
// ==========================================
const updateStatusSchema = z.object({
  status: z.enum(["OTVOREN", "U_RADU", "CEKA_DELOVE", "OTKAZAN"]),
});

router.put("/issues/:id/status", async (req, res) => {
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const { status } = parsed.data;
    const worker = await getOrCreateWorkerForUser(req.user);

    const issue = await prisma.maintenanceIssue.findUnique({
      where: { id: req.params.id },
      include: { machine: true, workOrder: true },
    });

    if (!issue) {
      return res.status(404).json({ error: "Zapis o kvaru nije pronađen." });
    }

    const updateData = { status };

    // Ako prelazi u rad, automatski dodeli trenutnog mehaničara
    if (status === "U_RADU" && !issue.mechanicId) {
      updateData.mechanicId = worker.id;
    }

    const [updatedIssue] = await prisma.$transaction([
      prisma.maintenanceIssue.update({
        where: { id: issue.id },
        data: updateData,
        include: {
          machine: true,
          mechanic: true,
          reportedBy: true,
        },
      }),
      // Ako je mašina bila slobodna a kvar preuzet, prebaci je u SERVIS
      prisma.machine.update({
        where: { id: issue.machineId },
        data: {
          status: status === "OTKAZAN" ? "SLOBODNA" : "SERVIS",
        },
      }),
    ]);

    // Ako je povezano sa radnim nalogom, sinhronizuj i radni nalog
    if (issue.workOrder) {
      await prisma.workOrder.update({
        where: { id: issue.workOrder.id },
        data: {
          status: status === "U_RADU" ? "U_TOKU" : status === "OTKAZAN" ? "OTKAZAN" : issue.workOrder.status,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        entityType: "MaintenanceIssue",
        entityId: issue.id,
        action: "IZMENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Promenjen status kvara za "${issue.machine.name}" na: ${status}`,
        newValues: { status },
      },
    });

    res.json({
      message: `Status kvara je uspešno ažuriran na ${status}.`,
      issue: updatedIssue,
    });
  } catch (error) {
    console.error("Greška pri promeni statusa kvara:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 7. ZAVRŠETAK POPRAVKE & OSLOBAĐANJE MAŠINE
// ==========================================
const resolveIssueSchema = z.object({
  repairNotes: z.string().min(3, "Opis popravke je obavezan"),
  partsReplaced: z.string().optional().nullable(),
  lubricantType: z.string().optional().nullable(),
  lubricantLiters: z.number().nonnegative().optional().nullable(),
  partsCost: z.number().nonnegative().optional().nullable(),
  laborCost: z.number().nonnegative().optional().nullable(),
  downtimeHours: z.number().nonnegative().optional().nullable(),
});

router.post("/issues/:id/resolve", async (req, res) => {
  try {
    const parsed = resolveIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const {
      repairNotes,
      partsReplaced,
      lubricantType,
      lubricantLiters,
      partsCost = 0,
      laborCost = 0,
      downtimeHours = 0,
    } = parsed.data;

    const worker = await getOrCreateWorkerForUser(req.user);

    let issue = await prisma.maintenanceIssue.findUnique({
      where: { id: req.params.id },
      include: { machine: true, workOrder: true },
    });

    if (!issue) {
      const wo = await prisma.workOrder.findUnique({
        where: { id: req.params.id },
        include: { maintenance: { include: { machine: true, workOrder: true } } },
      });
      if (wo && wo.maintenance) {
        issue = wo.maintenance;
      }
    }

    if (!issue) {
      return res.status(404).json({ error: "Zapis o kvaru nije pronađen." });
    }

    const totalCost = (partsCost || 0) + (laborCost || 0);

    // Atomska transakcija:
    // 1. Ažuriraj MaintenanceIssue na POPRAVLJENO i upiši troškove i zamenjene delove
    // 2. Automatski postavi status mašine na SLOBODNA!
    const [resolvedIssue, updatedMachine] = await prisma.$transaction([
      prisma.maintenanceIssue.update({
        where: { id: issue.id },
        data: {
          status: "POPRAVLJENO",
          repairedAt: new Date(),
          repairNotes,
          partsReplaced: partsReplaced || null,
          lubricantType: lubricantType || null,
          lubricantLiters: lubricantLiters || null,
          partsCost: partsCost || 0,
          laborCost: laborCost || 0,
          totalCost,
          downtimeHours: downtimeHours || 0,
          mechanicId: issue.mechanicId || worker.id,
        },
        include: {
          machine: true,
          mechanic: true,
          reportedBy: true,
        },
      }),
      prisma.machine.update({
        where: { id: issue.machineId },
        data: {
          status: "SLOBODNA",
        },
      }),
    ]);

    // Ako je postojao povezani radni nalog, označi ga kao ZAVRSEN
    if (issue.workOrder) {
      await prisma.workOrder.update({
        where: { id: issue.workOrder.id },
        data: { status: "ZAVRSEN" },
      });
    }

    await prisma.auditLog.create({
      data: {
        entityType: "MaintenanceIssue",
        entityId: issue.id,
        action: "POPRAVKA_ZAVRSENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Završena popravka za mašinu "${issue.machine.name}". Mašina je ponovo SLOBODNA za zaduživanje.`,
        newValues: {
          issueId: issue.id,
          repairNotes,
          partsReplaced,
          lubricantType,
          lubricantLiters,
          totalCost,
          machineStatus: "SLOBODNA",
        },
      },
    });

    res.json({
      message: `Mašina "${issue.machine.name}" je uspešno popravljena i vraćena u status SLOBODNA!`,
      issue: resolvedIssue,
      machine: updatedMachine,
    });
  } catch (error) {
    console.error("Greška pri evidentiranju popravke:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 7.1 PONIŠTAVANJE ZAVRŠETKA (VRATI U RAD) — DO KRAJA ISTOG DANA
// ==========================================
router.post("/issues/:id/reopen", async (req, res) => {
  try {
    let issue = await prisma.maintenanceIssue.findUnique({
      where: { id: req.params.id },
      include: { machine: true, workOrder: true },
    });

    if (!issue) {
      const wo = await prisma.workOrder.findUnique({
        where: { id: req.params.id },
        include: { maintenance: { include: { machine: true, workOrder: true } } },
      });
      if (wo && wo.maintenance) {
        issue = wo.maintenance;
      }
    }

    if (!issue) {
      return res.status(404).json({ error: "Zapis o servisu nije pronađen." });
    }

    // Provera da li je završeno danas
    const finishDate = new Date(issue.repairedAt || issue.updatedAt);
    const now = new Date();
    const isSameDay =
      now.getFullYear() === finishDate.getFullYear() &&
      now.getMonth() === finishDate.getMonth() &&
      now.getDate() === finishDate.getDate();

    if (!isSameDay && !["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
      return res.status(403).json({
        error: "Završeni remont možete vratiti u rad samo do kraja istog dana (do 23:59h). Nakon toga je zaključan.",
      });
    }

    const [updatedIssue, updatedMachine] = await prisma.$transaction([
      prisma.maintenanceIssue.update({
        where: { id: issue.id },
        data: {
          status: "U_RADU",
          repairedAt: null,
        },
        include: {
          machine: true,
          mechanic: true,
          reportedBy: true,
        },
      }),
      prisma.machine.update({
        where: { id: issue.machineId },
        data: { status: "SERVIS" },
      }),
    ]);

    if (issue.workOrder) {
      await prisma.workOrder.update({
        where: { id: issue.workOrder.id },
        data: { status: "U_TOKU" },
      });
    }

    await prisma.auditLog.create({
      data: {
        entityType: "MaintenanceIssue",
        entityId: issue.id,
        action: "IZMENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Mehaničar poništio završetak i vratio servis mašine "${issue.machine.name}" u rad. Mašina je ponovo u statusu SERVIS.`,
        newValues: { status: "U_RADU", machineStatus: "SERVIS" },
      },
    });

    res.json({
      message: `Nalog za mašinu "${issue.machine.name}" je uspešno vraćen u rad! Mašina je ponovo u servisu.`,
      issue: updatedIssue,
      machine: updatedMachine,
    });
  } catch (error) {
    console.error("Greška pri vraćanju naloga u rad:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 7.2 IZMENA IZVEŠTAJA ZAVRŠENE POPRAVKE — DO KRAJA ISTOG DANA
// ==========================================
router.put("/issues/:id/resolve", async (req, res) => {
  try {
    const parsed = resolveIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    let issue = await prisma.maintenanceIssue.findUnique({
      where: { id: req.params.id },
      include: { machine: true, workOrder: true },
    });

    if (!issue) {
      const wo = await prisma.workOrder.findUnique({
        where: { id: req.params.id },
        include: { maintenance: { include: { machine: true, workOrder: true } } },
      });
      if (wo && wo.maintenance) {
        issue = wo.maintenance;
      }
    }

    if (!issue) {
      return res.status(404).json({ error: "Zapis o servisu nije pronađen." });
    }

    const finishDate = new Date(issue.repairedAt || issue.updatedAt);
    const now = new Date();
    const isSameDay =
      now.getFullYear() === finishDate.getFullYear() &&
      now.getMonth() === finishDate.getMonth() &&
      now.getDate() === finishDate.getDate();

    if (!isSameDay && !["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
      return res.status(403).json({
        error: "Izveštaj o popravci možete menjati samo do kraja istog dana (do 23:59h).",
      });
    }

    const {
      repairNotes,
      partsReplaced,
      lubricantType,
      lubricantLiters,
      partsCost = 0,
      laborCost = 0,
    } = parsed.data;

    const totalCost = (partsCost || 0) + (laborCost || 0);

    const updatedIssue = await prisma.maintenanceIssue.update({
      where: { id: issue.id },
      data: {
        repairNotes,
        partsReplaced: partsReplaced || null,
        lubricantType: lubricantType || null,
        lubricantLiters: lubricantLiters || null,
        partsCost: partsCost || 0,
        laborCost: laborCost || 0,
        totalCost,
      },
      include: {
        machine: true,
        mechanic: true,
        reportedBy: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "MaintenanceIssue",
        entityId: issue.id,
        action: "IZMENA",
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        description: `Izmenjen izveštaj popravke za mašinu "${issue.machine.name}".`,
        newValues: { repairNotes, partsReplaced, lubricantType, lubricantLiters, totalCost },
      },
    });

    res.json({
      message: `Izveštaj popravke za mašinu "${issue.machine.name}" je uspešno ažuriran!`,
      issue: updatedIssue,
    });
  } catch (error) {
    console.error("Greška pri izmeni izveštaja popravke:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// ==========================================
// 8. SERVISNA KNJIŽICA / ISTORIJAT POPRAVKI (TAB 3)
// ==========================================
router.get("/history", async (req, res) => {
  try {
    const { machineId, dateFrom, dateTo } = req.query;

    const where = {
      status: "POPRAVLJENO",
    };

    if (machineId) where.machineId = String(machineId);

    if (dateFrom || dateTo) {
      where.repairedAt = {};
      if (dateFrom) where.repairedAt.gte = new Date(String(dateFrom));
      if (dateTo) {
        const end = new Date(String(dateTo));
        end.setHours(23, 59, 59, 999);
        where.repairedAt.lte = end;
      }
    }

    const history = await prisma.maintenanceIssue.findMany({
      where,
      include: {
        machine: true,
        mechanic: { select: { id: true, name: true, phone: true } },
        reportedBy: { select: { id: true, name: true } },
        servicePartner: { select: { id: true, name: true } },
        workOrder: { select: { id: true, orderNumber: true } },
      },
      orderBy: { repairedAt: "desc" },
    });

    res.json({ history });
  } catch (error) {
    console.error("Greška pri dohvatanju istorijata popravki:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

export default router;

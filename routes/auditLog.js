import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import { readStorageUsage } from "../lib/storageUsage.js";

const router = Router();
router.use(requireAuth);

// Samo DIREKTOR i RUKOVODILAC imaju pristup audit logovima
router.use((req, res, next) => {
  if (!["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) {
    return res.status(403).json({
      error: "Pristup odbijen. Samo direktor i rukovodilac mogu pregledati revizorski trag izmena.",
    });
  }
  next();
});

// ==========================================
// LISTA AUDIT LOGOVA (REVIZORSKI TRAG)
// ==========================================
router.get("/storage", async (req, res) => {
  try { res.json(await readStorageUsage(prisma)); }
  catch { res.status(503).json({ error: "Provera zauzeća baze trenutno nije dostupna." }); }
});

router.get("/:id", async (req, res) => {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
    if (!log) return res.status(404).json({ error: "Događaj nije pronađen." });
    res.json({ log });
  } catch { res.status(500).json({ error: "Detalji događaja nisu dostupni." }); }
});

router.get("/", async (req, res) => {
  try {
    const {
      entityType,
      action,
      userId,
      dateFrom,
      dateTo,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const where = {};
    if (entityType) where.entityType = String(entityType);
    if (action) where.action = String(action);
    if (userId) where.userId = String(userId);

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) {
        const end = new Date(String(dateTo));
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (search) {
      const s = String(search).trim();
      where.OR = [
        { userName: { contains: s, mode: "insensitive" } },
        { description: { contains: s, mode: "insensitive" } },
      ];
    }

    const take = Math.min(Number(limit) || 50, 100);
    const skip = ((Number(page) || 1) - 1) * take;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        select: { id: true, entityType: true, entityId: true, action: true, userId: true,
          userName: true, userRole: true, description: true, createdAt: true, formatVersion: true },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    // Actor identity is historical data, not a cascading user relation. Enrich
    // with the current account only when it still exists (one batched query).
    const users = logs.length ? await prisma.user.findMany({
      where: { id: { in: [...new Set(logs.map((log) => log.userId))] } },
      select: { id: true, name: true, email: true, role: true },
    }) : [];
    const userMap = new Map(users.map((user) => [user.id, user]));

    res.json({
      total,
      page: Number(page) || 1,
      totalPages: Math.ceil(total / take),
      logs: logs.map((log) => ({ ...log, user: userMap.get(log.userId) || null })),
    });
  } catch (error) {
    console.error("Greška pri dohvatanju audit logova:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

export default router;

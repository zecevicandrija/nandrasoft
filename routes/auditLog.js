import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";

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
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        skip,
        take,
      }),
    ]);

    res.json({
      total,
      page: Number(page) || 1,
      totalPages: Math.ceil(total / take),
      logs,
    });
  } catch (error) {
    console.error("Greška pri dohvatanju audit logova:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

export default router;

import { prisma } from "./prisma.js";

export const isManager = (user) => ["DIREKTOR", "RUKOVODILAC"].includes(user?.role);

export const canAccessWorkerRecord = (req, record) =>
  isManager(req.user) || Boolean(req.worker?.id && req.worker.id === record?.workerId);

// userId is a unique foreign key. Names are display data, never identity.
export async function resolveWorkerForUser(user) {
  if (!user?.id) return null;
  const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
  return worker?.isActive === true ? worker : null;
}

export async function requireWorkerIdentity(req, res, next) {
  if (isManager(req.user)) return next();
  try {
    req.worker = await resolveWorkerForUser(req.user);
    if (!req.worker) {
      return res.status(403).json({ error: "Nalog nije povezan sa aktivnim profilom radnika. Obratite se administratoru." });
    }
    next();
  } catch {
    res.status(500).json({ error: "Nije moguće proveriti profil radnika." });
  }
}

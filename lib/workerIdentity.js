import { prisma } from "./prisma.js";

export const isManager = (user) => ["DIREKTOR", "RUKOVODILAC"].includes(user?.role);

export const canAccessWorkerRecord = (req, record) =>
  isManager(req.user) || Boolean(req.worker?.id && req.worker.id === record?.workerId);

// userId is a unique foreign key. Names are display data, never identity.
// Inside a transaction ALWAYS pass the transaction client (`tx`) — using the
// global client there grabs a second pool connection and can starve the pool.
export async function resolveWorkerForUser(user, client = prisma) {
  if (!user?.id) return null;
  const worker = await client.worker.findUnique({ where: { userId: user.id } });
  return worker?.isActive === true ? worker : null;
}

/**
 * Returns the worker profile cached on the request by requireWorkerIdentity.
 * No DB query when the middleware already ran (the normal case), so it is safe
 * to call inside inventoryMutation/transactions. Falls back to `client` otherwise.
 */
export async function getRequestWorker(req, client = prisma) {
  if (req.workerResolved) return req.worker ?? null;
  req.worker = await resolveWorkerForUser(req.user, client);
  req.workerResolved = true;
  return req.worker;
}

export async function requireWorkerIdentity(req, res, next) {
  try {
    // Resolved once, before any transaction starts, for managers too (optional
    // for them) so handlers never need to query it again inside a transaction.
    req.worker = await resolveWorkerForUser(req.user);
    req.workerResolved = true;
    if (!req.worker && !isManager(req.user)) {
      return res.status(403).json({ error: "Nalog nije povezan sa aktivnim profilom radnika. Obratite se administratoru." });
    }
    next();
  } catch {
    res.status(500).json({ error: "Nije moguće proveriti profil radnika." });
  }
}

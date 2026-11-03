const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 30;

function cutoffAt(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid cleanup date");
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

export async function previewTechnicalCleanup(db, { now = new Date() } = {}) {
  const cutoff = cutoffAt(now);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    const [counts] = await tx.$queryRaw`SELECT
      (SELECT COUNT(*)::int FROM "session" WHERE "expiresAt" < ${cutoff}) AS sessions,
      (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'SENT' AND "completedAt" < ${cutoff}) AS "sentPush"`;
    return { dryRun: true, cutoff: cutoff.toISOString(), ...counts };
  }, { isolationLevel: "RepeatableRead", timeout: 10000 });
}

export async function cleanupTechnicalRecords(db, {
  now = new Date(), batchSize = 500, maxBatches = 10, shouldStop = () => false,
} = {}) {
  const cutoff = cutoffAt(now);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 ||
      !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10) throw new Error("Invalid cleanup batch limits");
  const result = { cutoff: cutoff.toISOString(), sessionsDeleted: 0, sentPushDeleted: 0, batches: 0, busy: false };
  for (let index = 0; index < maxBatches && !shouldStop(); index++) {
    const batch = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      const [lock] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(1312902727, 1) AS acquired`;
      if (!lock.acquired) return null;
      const sessions = await tx.$executeRaw`DELETE FROM "session" WHERE id IN (
        SELECT id FROM "session" WHERE "expiresAt" < ${cutoff}
        ORDER BY "expiresAt", id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      ) AND "expiresAt" < ${cutoff}`;
      const push = await tx.$executeRaw`DELETE FROM push_outbox WHERE id IN (
        SELECT id FROM push_outbox WHERE status = 'SENT' AND "completedAt" < ${cutoff}
        ORDER BY "completedAt", id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      ) AND status = 'SENT' AND "completedAt" < ${cutoff}`;
      return { sessions, push };
    }, { timeout: 10000, maxWait: 5000 });
    if (!batch) { result.busy = true; break; }
    result.batches++;
    result.sessionsDeleted += batch.sessions;
    result.sentPushDeleted += batch.push;
    if (batch.sessions < batchSize && batch.push < batchSize) break;
  }
  return result;
}

export function startTechnicalCleanup(db, { intervalMs = DAY_MS, logger = console, enabled = true } = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error("Invalid cleanup interval");
  let stopped = false, active = null;
  const tick = () => {
    if (!enabled || stopped || active) return;
    active = cleanupTechnicalRecords(db, { shouldStop: () => stopped })
      .then((result) => { if (result.sessionsDeleted || result.sentPushDeleted) logger.info("TECHNICAL_CLEANUP_COMPLETED", result); })
      .catch(() => { logger.error("TECHNICAL_CLEANUP_UNAVAILABLE"); })
      .finally(() => { active = null; });
  };
  const timer = enabled ? setInterval(tick, intervalMs) : null;
  timer?.unref?.();
  tick();
  return async () => { stopped = true; if (timer) clearInterval(timer); await active; };
}

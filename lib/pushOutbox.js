import { randomUUID } from "node:crypto";

// Called inside the same transaction as the work order. Each device has its
// own retry record, so a failed device never causes successful devices to resend.
export async function enqueueWorkOrderPush(tx, order) {
  await tx.$executeRaw`UPDATE push_outbox SET status = 'SKIPPED', "completedAt" = NOW(),
    "lastError" = 'superseded' WHERE "workOrderId" = ${order.id} AND status IN ('PENDING', 'PROCESSING')`;
  if (!["PLANIRAN", "DODELJEN"].includes(order.status)) return;
  const eventId = randomUUID();
  await tx.$executeRaw`INSERT INTO push_outbox
    (id, "workOrderId", "workerId", "userId", "subscriptionId")
    SELECT ${eventId} || ':' || s.id, ${order.id}, w.id, w."userId", s.id
    FROM worker w JOIN "user" u ON u.id = w."userId"
    JOIN push_subscription s ON s."userId" = u.id
    WHERE w.id = ${order.workerId} AND w."isActive" = true AND u."isActive" = true`;
}

export async function claimPushJobs(db, now = new Date()) {
  const token = randomUUID();
  const until = new Date(now.getTime() + 60_000);
  return db.$queryRaw`WITH candidates AS (
    SELECT id FROM push_outbox WHERE
      (status = 'PENDING' AND "nextAttemptAt" <= ${now}) OR
      (status = 'PROCESSING' AND "lockedUntil" <= ${now})
    ORDER BY "nextAttemptAt", id LIMIT 2 FOR UPDATE SKIP LOCKED
  ) UPDATE push_outbox j SET status = 'PROCESSING', attempts = attempts + 1,
    "leaseToken" = ${token}, "lockedUntil" = ${until}
    FROM candidates c WHERE j.id = c.id RETURNING j.*`;
}

const delays = [30_000, 120_000, 600_000];
export async function processPushJob(db, job, send, { now = () => new Date(), logger = console } = {}) {
  const finish = (status, reason = null, nextAttemptAt = null) => db.pushOutbox.updateMany({
    where: { id: job.id, status: "PROCESSING", leaseToken: job.leaseToken },
    data: { status, lastError: reason, lockedUntil: null, leaseToken: null,
      ...(nextAttemptAt ? { nextAttemptAt } : { completedAt: now() }) },
  });
  try {
    if (now().getTime() - new Date(job.createdAt).getTime() >= 86400_000) return await finish("SKIPPED", "expired");
    const order = await db.workOrder.findUnique({ where: { id: job.workOrderId }, include: {
      machine: { select: { name: true } }, parcel: { select: { name: true } }, workType: { select: { name: true } },
      worker: { select: { userId: true, isActive: true, user: { select: { isActive: true } } } },
    } });
    // Accepting an order sets U_TOKU. Merely opening the web app is not acceptance.
    if (!order || !["PLANIRAN", "DODELJEN"].includes(order.status) || order.workerId !== job.workerId ||
      order.worker?.userId !== job.userId || !order.worker?.isActive || !order.worker?.user?.isActive) {
      return await finish("SKIPPED", "order_no_longer_pending_for_recipient");
    }
    const subscription = await db.pushSubscription.findUnique({ where: { id: job.subscriptionId } });
    if (!subscription || subscription.userId !== job.userId) return await finish("SKIPPED", "subscription_removed");
    // Enqueueing a newer assignment may have superseded this claimed job.
    const owned = await db.pushOutbox.findFirst({ where: { id: job.id, status: "PROCESSING", leaseToken: job.leaseToken }, select: { id: true } });
    if (!owned) return;
    const details = [order.orderNumber, order.machine?.name, order.parcel?.name, order.workType?.name].filter(Boolean).join(" • ");
    await send(subscription, { title: "Novi radni nalog je izdat.", body: `Novi radni nalog je izdat. (${details})`,
      url: "/nalozi", orderId: order.id, orderNumber: order.orderNumber });
    await finish("SENT");
  } catch (error) {
    const code = Number(error.statusCode);
    if ([404, 410].includes(code)) {
      await db.pushSubscription.deleteMany({ where: { id: job.subscriptionId, userId: job.userId } });
      return await finish("SKIPPED", "subscription_expired");
    }
    const retry = (!code || code === 408 || code === 429 || code >= 500) && error.retryable !== false && job.attempts <= delays.length;
    // Store only a safe classification, never endpoints, auth keys or response bodies.
    const reason = code ? `HTTP_${code}` : "transport_or_database_error";
    if (retry) return await finish("PENDING", reason, new Date(now().getTime() + delays[job.attempts - 1]));
    logger.error("PUSH_OUTBOX_FAILED", { jobId: job.id, workOrderId: job.workOrderId, reason });
    await finish("FAILED", reason);
  }
}

export function startPushOutboxWorker(db, send, { intervalMs = 2000, logger = console, enabled = true } = {}) {
  let stopped = false, active = null, lastCleanup = 0;
  const tick = () => {
    if (stopped || active || !enabled) return;
    active = (async () => {
      try {
        const jobs = await claimPushJobs(db);
        const results = await Promise.allSettled(jobs.map((job) => stopped ? undefined : processPushJob(db, job, send, { logger })));
        if (results.some((result) => result.status === "rejected")) logger.error("PUSH_OUTBOX_JOB_UPDATE_FAILED");
        if (!stopped && Date.now() - lastCleanup > 3600_000) {
          await db.$executeRaw`DELETE FROM push_outbox WHERE id IN (
            SELECT id FROM push_outbox WHERE "completedAt" < NOW() - INTERVAL '7 days' LIMIT 500)`;
          lastCleanup = Date.now();
        }
      } catch { logger.error("PUSH_OUTBOX_WORKER_UNAVAILABLE"); }
    })().finally(() => { active = null; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await active; };
}

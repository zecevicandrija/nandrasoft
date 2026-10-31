CREATE TABLE "push_outbox" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMPTZ(3),
  "leaseToken" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "push_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "push_outbox_status_nextAttemptAt_idx" ON "push_outbox"("status", "nextAttemptAt");
CREATE INDEX "push_outbox_workOrderId_status_idx" ON "push_outbox"("workOrderId", "status");
CREATE INDEX "push_outbox_completedAt_idx" ON "push_outbox"("completedAt");

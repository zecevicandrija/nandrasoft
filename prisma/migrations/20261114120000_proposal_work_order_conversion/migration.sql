ALTER TABLE "work_order_proposal"
  ADD COLUMN "workOrderId" TEXT,
  ADD COLUMN "convertedById" TEXT,
  ADD COLUMN "convertedByName" TEXT,
  ADD COLUMN "convertedAt" TIMESTAMP(3),
  ADD COLUMN "convertedOrderNumber" TEXT;

CREATE UNIQUE INDEX "work_order_proposal_workOrderId_key" ON "work_order_proposal"("workOrderId");
CREATE INDEX "work_order_proposal_status_approvedAt_idx" ON "work_order_proposal"("status", "approvedAt" DESC);

ALTER TABLE "work_order_proposal"
  ADD CONSTRAINT "work_order_proposal_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

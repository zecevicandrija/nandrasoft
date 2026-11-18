-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "work_order_workerId_status_orderDate_createdAt_idx" ON "work_order"("workerId", "status", "orderDate" DESC, "createdAt" DESC);

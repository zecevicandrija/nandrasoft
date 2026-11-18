-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "work_order_orderType_orderDate_createdAt_idx" ON "work_order"("orderType", "orderDate" DESC, "createdAt" DESC);

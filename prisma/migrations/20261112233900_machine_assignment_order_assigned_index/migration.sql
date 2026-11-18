-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "machine_assignment_workOrderId_assignedAt_idx" ON "machine_assignment"("workOrderId", "assignedAt" DESC);

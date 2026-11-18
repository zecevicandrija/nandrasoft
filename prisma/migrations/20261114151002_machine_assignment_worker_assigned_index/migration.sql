-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "machine_assignment_workerId_assignedAt_idx" ON "machine_assignment"("workerId", "assignedAt" DESC);

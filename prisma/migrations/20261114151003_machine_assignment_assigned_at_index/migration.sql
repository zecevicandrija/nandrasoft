-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "machine_assignment_assignedAt_idx" ON "machine_assignment"("assignedAt" DESC);

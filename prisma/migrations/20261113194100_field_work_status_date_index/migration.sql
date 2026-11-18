-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "field_work_status_date_createdAt_idx" ON "field_work"("status", "date" DESC, "createdAt" DESC);

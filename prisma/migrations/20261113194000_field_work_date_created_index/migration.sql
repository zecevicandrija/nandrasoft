-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "field_work_date_createdAt_idx" ON "field_work"("date" DESC, "createdAt" DESC);

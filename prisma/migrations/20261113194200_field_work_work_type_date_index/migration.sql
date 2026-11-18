-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "field_work_workTypeId_date_idx" ON "field_work"("workTypeId", "date");

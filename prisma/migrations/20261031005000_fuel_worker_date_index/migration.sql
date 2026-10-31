-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "fuel_entry_workerId_date_idx" ON "fuel_entry"("workerId", "date");

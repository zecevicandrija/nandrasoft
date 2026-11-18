-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "fuel_entry_fieldWorkId_idx" ON "fuel_entry"("fieldWorkId");

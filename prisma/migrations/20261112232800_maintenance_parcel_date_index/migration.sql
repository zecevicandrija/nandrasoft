-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "maintenance_issue_parcelId_dateReported_idx" ON "maintenance_issue"("parcelId", "dateReported");

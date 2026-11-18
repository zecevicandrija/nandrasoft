-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "maintenance_issue_reportedById_dateReported_idx" ON "maintenance_issue"("reportedById", "dateReported");

-- Supports Tab 1 (GET /issues) status filtering ordered by dateReported DESC, createdAt DESC.
CREATE INDEX CONCURRENTLY "maintenance_issue_status_dateReported_createdAt_idx" ON "maintenance_issue"("status", "dateReported" DESC, "createdAt" DESC);

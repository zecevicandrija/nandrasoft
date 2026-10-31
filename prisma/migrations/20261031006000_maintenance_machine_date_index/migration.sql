-- Equality on machine first, followed by the date range used by analytics.
CREATE INDEX CONCURRENTLY "maintenance_issue_machineId_dateReported_idx" ON "maintenance_issue"("machineId", "dateReported");

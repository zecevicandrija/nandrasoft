-- Supports Tab 3 (GET /history) POPRAVLJENO queries ordered by repairedAt DESC.
CREATE INDEX CONCURRENTLY "maintenance_issue_status_repairedAt_idx" ON "maintenance_issue"("status", "repairedAt" DESC);

-- Keep one concurrent build per migration; PostgreSQL forbids transaction blocks.
CREATE INDEX CONCURRENTLY "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt" DESC);

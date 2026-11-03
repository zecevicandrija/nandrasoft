-- Bound expiry-ordered cleanup batches without scanning/sorting all sessions.
CREATE INDEX IF NOT EXISTS "session_expiresAt_id_idx" ON "session" ("expiresAt", "id");

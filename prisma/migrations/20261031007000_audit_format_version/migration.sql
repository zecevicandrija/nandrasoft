BEGIN;
SET LOCAL lock_timeout = '10s';
-- Original JSON and event metadata remain untouched. Old events retain version 1.
ALTER TABLE "audit_log" ADD COLUMN "formatVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "audit_log" ADD COLUMN "context" JSONB;
COMMIT;

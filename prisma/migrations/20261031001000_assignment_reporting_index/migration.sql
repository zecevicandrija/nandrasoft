BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE INDEX "machine_assignment_machineId_assignedAt_idx"
  ON "machine_assignment" ("machineId", "assignedAt");
COMMIT;

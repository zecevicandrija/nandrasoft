BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Block assignment writes until both the duplicate check and index are committed.
LOCK TABLE "machine_assignment" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT "machineId" FROM "machine_assignment"
    WHERE "status" = 'ZADUZENA'
    GROUP BY "machineId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active machine assignments exist; review them before retrying. No records were changed.';
  END IF;
END $$;

CREATE UNIQUE INDEX "machine_assignment_one_active_per_machine"
  ON "machine_assignment" ("machineId")
  WHERE "status" = 'ZADUZENA';
COMMIT;

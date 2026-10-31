BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "onion_chambers", "onion_storage_entry" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "onion_storage_entry" ADD COLUMN "chamberId" TEXT;

-- Do not guess when legacy names differ only in case/whitespace. Such data
-- must be resolved before attaching foreign keys to historical stock records.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "onion_chambers"
    GROUP BY lower(btrim("name")) HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ambiguous onion chamber names; resolve duplicate names before migration';
  END IF;
END $$;

UPDATE "onion_storage_entry" AS entry
SET "chamberId" = chamber."id"
FROM "onion_chambers" AS chamber
WHERE lower(btrim(entry."locationOrChamber")) = lower(btrim(chamber."name"));

-- Uncatalogued locations remain free-text legacy locations, not guessed links.
CREATE INDEX "onion_storage_entry_chamberId_idx" ON "onion_storage_entry"("chamberId");
ALTER TABLE "onion_storage_entry" ADD CONSTRAINT "onion_storage_entry_chamberId_fkey"
  FOREIGN KEY ("chamberId") REFERENCES "onion_chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;

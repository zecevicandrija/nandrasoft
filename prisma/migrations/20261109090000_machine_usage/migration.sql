ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'PONISTENA';
ALTER TABLE "machine_assignment"
  ADD COLUMN "fieldWorkId" TEXT,
  ADD COLUMN "usageGroupId" TEXT,
  ADD COLUMN "areaDoneHa" DOUBLE PRECISION,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "correctionReason" TEXT,
  ADD COLUMN "replacesId" TEXT,
  ADD COLUMN "machineStateBefore" JSONB;
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_fieldWorkId_fkey"
  FOREIGN KEY ("fieldWorkId") REFERENCES "field_work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "machine_assignment_fieldWorkId_status_idx" ON "machine_assignment"("fieldWorkId", status);
CREATE INDEX "machine_assignment_usageGroupId_idx" ON "machine_assignment"("usageGroupId");
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_area_nonnegative"
  CHECK ("areaDoneHa" IS NULL OR "areaDoneHa" >= 0);

-- Only an explicit order link with exactly one matching assignment is safe to backfill.
-- Ambiguous historical matches retain the legacy single-machine reporting fallback.
WITH candidates AS (
  SELECT a.id, w.id AS work_id, w."areaDoneHa", count(*) OVER (PARTITION BY w.id) AS n
  FROM "machine_assignment" a JOIN "work_order" o ON o.id = a."workOrderId"
  JOIN "field_work" w ON w.id = o."fieldWorkId"
  WHERE a."machineId" = w."machineId" AND a."workerId" = w."workerId"
    AND a.status IN ('RAZDUZENA', 'VRACENA_SA_KVAROM')
)
UPDATE "machine_assignment" a SET "fieldWorkId" = c.work_id, "areaDoneHa" = c."areaDoneHa"
FROM candidates c WHERE a.id = c.id AND c.n = 1;

-- Machine totals are separate from worker hours and the work's total area.
CREATE VIEW "field_work_machine_usage" AS
SELECT a.id AS id, w.id AS "fieldWorkId", w.date, w.status, w."workerId", w."parcelId", w."workTypeId",
  a."machineId", COALESCE(a."areaDoneHa", 0) AS "areaDoneHa",
  GREATEST(COALESCE(a."endHours" - a."startHours", 0), 0) AS "workHours", a.id AS "assignmentId"
FROM "field_work" w JOIN "machine_assignment" a ON a."fieldWorkId" = w.id
WHERE a."voidedAt" IS NULL
UNION ALL
SELECT w.id, w.id, w.date, w.status, w."workerId", w."parcelId", w."workTypeId", w."machineId",
  w."areaDoneHa", COALESCE(w."workHours", 0), NULL::text
FROM "field_work" w WHERE NOT EXISTS (
  SELECT 1 FROM "machine_assignment" a WHERE a."fieldWorkId" = w.id AND a."voidedAt" IS NULL
);

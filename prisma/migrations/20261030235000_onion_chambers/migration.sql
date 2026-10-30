BEGIN;
SET LOCAL lock_timeout = '10s';
-- CreateTable
CREATE TABLE IF NOT EXISTS "onion_chambers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storage_type" TEXT NOT NULL DEFAULT 'HLADNJACA',
    "has_equipment" BOOLEAN NOT NULL DEFAULT true,
    "max_boxes" INTEGER NOT NULL DEFAULT 720,
    "max_capacity_kg" DOUBLE PRECISION NOT NULL DEFAULT 792000,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_chambers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "onion_chambers_name_key" ON "onion_chambers"("name");

-- Seed an empty catalogue only; preserve all existing/custom chamber records.
INSERT INTO "onion_chambers" (id, name, storage_type, has_equipment, max_boxes, max_capacity_kg)
SELECT * FROM (VALUES
  ('ch_komora_1', 'Komora 1', 'HLADNJACA', true, 720, 792000::double precision),
  ('ch_komora_2', 'Komora 2', 'HLADNJACA', true, 720, 792000::double precision),
  ('ch_komora_3', 'Komora 3', 'HLADNJACA', true, 720, 792000::double precision),
  ('ch_komora_4', 'Komora 4', 'HLADNJACA', false, 720, 792000::double precision),
  ('ch_komora_5', 'Komora 5', 'HLADNJACA', false, 720, 792000::double precision),
  ('ch_komora_6', 'Komora 6', 'HLADNJACA', false, 720, 792000::double precision)
) AS defaults(id, name, storage_type, has_equipment, max_boxes, max_capacity_kg)
WHERE NOT EXISTS (SELECT 1 FROM "onion_chambers");
COMMIT;

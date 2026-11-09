-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('FERTILIZER', 'CHEMICAL', 'SEED');

-- AlterTable
ALTER TABLE "work_type" ADD COLUMN     "materialKind" "MaterialKind",
ADD COLUMN     "materialRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "chemical_product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeIngredient" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'L',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "crop" TEXT NOT NULL DEFAULT 'Luk',
    "variety" TEXT,
    "manufacturer" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'SEME',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seed_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_material" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT,
    "fieldWorkId" TEXT,
    "kind" "MaterialKind" NOT NULL,
    "productId" TEXT NOT NULL,
    "fertilizerId" TEXT,
    "chemicalId" TEXT,
    "seedId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "dosePerHa" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "work_material_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chemical_product_code_key" ON "chemical_product"("code");

-- CreateIndex
CREATE INDEX "chemical_product_isActive_code_id_idx" ON "chemical_product"("isActive", "code", "id");

-- CreateIndex
CREATE UNIQUE INDEX "seed_product_code_key" ON "seed_product"("code");

-- CreateIndex
CREATE INDEX "seed_product_isActive_code_id_idx" ON "seed_product"("isActive", "code", "id");

-- CreateIndex
CREATE INDEX "work_material_fertilizerId_idx" ON "work_material"("fertilizerId");

-- CreateIndex
CREATE INDEX "work_material_chemicalId_idx" ON "work_material"("chemicalId");

-- CreateIndex
CREATE INDEX "work_material_seedId_idx" ON "work_material"("seedId");

-- CreateIndex
CREATE UNIQUE INDEX "work_material_workOrderId_kind_productId_key" ON "work_material"("workOrderId", "kind", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "work_material_fieldWorkId_kind_productId_key" ON "work_material"("fieldWorkId", "kind", "productId");

-- AddForeignKey
ALTER TABLE "work_material" ADD CONSTRAINT "work_material_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_material" ADD CONSTRAINT "work_material_fieldWorkId_fkey" FOREIGN KEY ("fieldWorkId") REFERENCES "field_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_material" ADD CONSTRAINT "work_material_fertilizerId_fkey" FOREIGN KEY ("fertilizerId") REFERENCES "fertilizer_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_material" ADD CONSTRAINT "work_material_chemicalId_fkey" FOREIGN KEY ("chemicalId") REFERENCES "chemical_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_material" ADD CONSTRAINT "work_material_seedId_fkey" FOREIGN KEY ("seedId") REFERENCES "seed_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Independent of locale and extensions; use the same normalization in requests.
CREATE FUNCTION material_search_text(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT regexp_replace(translate(lower(value), 'čćšžđ', 'ccszd'), '[^a-z0-9]+', ' ', 'g')
$$;
CREATE FUNCTION material_search_vector(value TEXT) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT to_tsvector('simple'::regconfig,
    regexp_replace(translate(lower(value), 'čćšžđ', 'ccszd'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Prefix matching of individual words with GIN, including two-letter prefixes.
-- Archived rows never participate in picker/catalogue searches.
CREATE INDEX chemical_product_search_idx ON chemical_product USING GIN
  (material_search_vector(code || ' ' || name || ' ' || coalesce("activeIngredient", ''))) WHERE "isActive" = true;
CREATE INDEX seed_product_search_idx ON seed_product USING GIN
  (material_search_vector(code || ' ' || name || ' ' || crop || ' ' || coalesce(variety, '') || ' ' || coalesce(manufacturer, ''))) WHERE "isActive" = true;
CREATE INDEX fertilizer_product_search_idx ON fertilizer_product USING GIN
  (material_search_vector(name)) WHERE "isActive" = true;

ALTER TABLE work_material ADD CONSTRAINT work_material_owner_check
  CHECK (num_nonnulls("workOrderId", "fieldWorkId") = 1);
ALTER TABLE work_material ADD CONSTRAINT work_material_product_check CHECK (
  num_nonnulls("fertilizerId", "chemicalId", "seedId") = 1 AND
  ((kind = 'FERTILIZER' AND "fertilizerId" = "productId") OR
   (kind = 'CHEMICAL' AND "chemicalId" = "productId") OR
   (kind = 'SEED' AND "seedId" = "productId")) IS TRUE
);
ALTER TABLE work_material ADD CONSTRAINT work_material_dose_check
  CHECK ("dosePerHa" IS NULL OR ("dosePerHa" > 0 AND "dosePerHa" < 'Infinity'::float8));
ALTER TABLE work_type ADD CONSTRAINT work_type_material_required_check
  CHECK (NOT "materialRequired" OR "materialKind" IS NOT NULL);

-- Persist the association once. Renaming a work type cannot break it later.
UPDATE work_type SET "materialKind" = 'FERTILIZER'
 WHERE material_search_text(name) LIKE '%bacanje vestak%';
UPDATE work_type SET "materialKind" = 'SEED'
 WHERE material_search_text(name) LIKE '%precizna setva luka%';
UPDATE work_type SET "materialKind" = 'CHEMICAL'
 WHERE material_search_text(name) LIKE '%prskanje%';


ALTER TABLE "onion_sorting" ADD COLUMN "plevaKg" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "onion_packaging" ADD COLUMN "sortingId" TEXT;
CREATE UNIQUE INDEX "onion_packaging_sortingId_key" ON "onion_packaging"("sortingId");
ALTER TABLE "onion_packaging" ADD CONSTRAINT "onion_packaging_sortingId_fkey"
  FOREIGN KEY ("sortingId") REFERENCES "onion_sorting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

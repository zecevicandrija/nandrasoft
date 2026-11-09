-- AlterEnum
ALTER TYPE "FertilizerUnit" ADD VALUE IF NOT EXISTS 'KOM';

-- AlterTable
ALTER TABLE "fertilizer_product" ADD COLUMN IF NOT EXISTS "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fertilizer_product_code_key" ON "fertilizer_product"("code");


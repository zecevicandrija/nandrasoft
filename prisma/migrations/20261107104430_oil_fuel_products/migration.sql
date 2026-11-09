-- CreateTable
CREATE TABLE "oil_fuel_product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GORIVO',
    "unit" TEXT NOT NULL DEFAULT 'L',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oil_fuel_product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oil_fuel_product_code_key" ON "oil_fuel_product"("code");

-- CreateIndex
CREATE INDEX "oil_fuel_product_isActive_code_id_idx" ON "oil_fuel_product"("isActive", "code", "id");

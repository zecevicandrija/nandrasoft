CREATE TABLE "contractor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contractor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contractor_code_key" ON "contractor"("code");
ALTER TABLE "field_work" ADD COLUMN "contractorId" TEXT;
ALTER TABLE "work_order" ADD COLUMN "contractorId" TEXT;
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

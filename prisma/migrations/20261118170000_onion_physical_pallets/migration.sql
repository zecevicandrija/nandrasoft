ALTER TABLE "onion_packaging"
  ADD COLUMN "physicalPalletsCount" INTEGER CHECK ("physicalPalletsCount" > 0),
  ALTER COLUMN "packerCount" DROP NOT NULL,
  ALTER COLUMN "packerCount" DROP DEFAULT;

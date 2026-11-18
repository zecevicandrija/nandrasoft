-- The application schema already contains this optional field; older databases
-- adopted it through db push. Make clean migration deployments match the schema.
ALTER TABLE "machine" ADD COLUMN IF NOT EXISTS "fuelType" TEXT DEFAULT 'EURODIZEL';

BEGIN;
SET LOCAL lock_timeout = '10s';
-- Store monetary amounts in exact base-10 NUMERIC; quantities remain Float.
-- PostgreSQL round(numeric, scale) rounds ties away from zero.

ALTER TABLE "worker" ALTER COLUMN "dailyWage" TYPE DECIMAL(15, 2)
  USING round("dailyWage"::numeric, 2);
ALTER TABLE "worker" ADD CONSTRAINT "worker_dailyWage_finite" CHECK ("dailyWage" <> 'NaN'::numeric);
ALTER TABLE "worker" ALTER COLUMN "hourlyRate" TYPE DECIMAL(15, 4)
  USING round("hourlyRate"::numeric, 4);
ALTER TABLE "worker" ADD CONSTRAINT "worker_hourlyRate_finite" CHECK ("hourlyRate" <> 'NaN'::numeric);
ALTER TABLE "machine" ALTER COLUMN "enpTagBalance" TYPE DECIMAL(15, 2)
  USING round("enpTagBalance"::numeric, 2);
ALTER TABLE "machine" ADD CONSTRAINT "machine_enpTagBalance_finite" CHECK ("enpTagBalance" <> 'NaN'::numeric);
ALTER TABLE "work_type" ALTER COLUMN "laborPricePerHa" TYPE DECIMAL(15, 4)
  USING round("laborPricePerHa"::numeric, 4);
ALTER TABLE "work_type" ADD CONSTRAINT "work_type_laborPricePerHa_finite" CHECK ("laborPricePerHa" <> 'NaN'::numeric);
ALTER TABLE "work_type" ALTER COLUMN "totalPricePerHa" TYPE DECIMAL(15, 4)
  USING round("totalPricePerHa"::numeric, 4);
ALTER TABLE "work_type" ADD CONSTRAINT "work_type_totalPricePerHa_finite" CHECK ("totalPricePerHa" <> 'NaN'::numeric);
ALTER TABLE "work_type" ALTER COLUMN "referenceFuelPrice" TYPE DECIMAL(15, 4)
  USING round("referenceFuelPrice"::numeric, 4);
ALTER TABLE "work_type" ADD CONSTRAINT "work_type_referenceFuelPrice_finite" CHECK ("referenceFuelPrice" <> 'NaN'::numeric);
ALTER TABLE "fuel_entry" ALTER COLUMN "pricePerLiter" TYPE DECIMAL(15, 4)
  USING round("pricePerLiter"::numeric, 4);
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_pricePerLiter_finite" CHECK ("pricePerLiter" <> 'NaN'::numeric);
ALTER TABLE "fuel_entry" ALTER COLUMN "totalCost" TYPE DECIMAL(15, 2)
  USING round("totalCost"::numeric, 2);
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_totalCost_finite" CHECK ("totalCost" <> 'NaN'::numeric);
ALTER TABLE "fuel_supply" ALTER COLUMN "pricePerLiter" TYPE DECIMAL(15, 4)
  USING round("pricePerLiter"::numeric, 4);
ALTER TABLE "fuel_supply" ADD CONSTRAINT "fuel_supply_pricePerLiter_finite" CHECK ("pricePerLiter" <> 'NaN'::numeric);
ALTER TABLE "fuel_supply" ALTER COLUMN "totalCost" TYPE DECIMAL(15, 2)
  USING round("totalCost"::numeric, 2);
ALTER TABLE "fuel_supply" ADD CONSTRAINT "fuel_supply_totalCost_finite" CHECK ("totalCost" <> 'NaN'::numeric);
ALTER TABLE "maintenance_issue" ALTER COLUMN "partsCost" TYPE DECIMAL(15, 2)
  USING round("partsCost"::numeric, 2);
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_partsCost_finite" CHECK ("partsCost" <> 'NaN'::numeric);
ALTER TABLE "maintenance_issue" ALTER COLUMN "laborCost" TYPE DECIMAL(15, 2)
  USING round("laborCost"::numeric, 2);
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_laborCost_finite" CHECK ("laborCost" <> 'NaN'::numeric);
ALTER TABLE "maintenance_issue" ALTER COLUMN "totalCost" TYPE DECIMAL(15, 2)
  USING round("totalCost"::numeric, 2);
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_totalCost_finite" CHECK ("totalCost" <> 'NaN'::numeric);
ALTER TABLE "toll_entry" ALTER COLUMN "amount" TYPE DECIMAL(15, 2)
  USING round("amount"::numeric, 2);
ALTER TABLE "toll_entry" ADD CONSTRAINT "toll_entry_amount_finite" CHECK ("amount" <> 'NaN'::numeric);
ALTER TABLE "toll_top_up" ALTER COLUMN "amount" TYPE DECIMAL(15, 2)
  USING round("amount"::numeric, 2);
ALTER TABLE "toll_top_up" ADD CONSTRAINT "toll_top_up_amount_finite" CHECK ("amount" <> 'NaN'::numeric);
ALTER TABLE "fertilizer_product" ALTER COLUMN "defaultPricePerUnit" TYPE DECIMAL(15, 4)
  USING round("defaultPricePerUnit"::numeric, 4);
ALTER TABLE "fertilizer_product" ADD CONSTRAINT "fertilizer_product_defaultPricePerUnit_finite" CHECK ("defaultPricePerUnit" <> 'NaN'::numeric);
ALTER TABLE "fertilizer_movement" ALTER COLUMN "unitPrice" TYPE DECIMAL(15, 4)
  USING round("unitPrice"::numeric, 4);
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_unitPrice_finite" CHECK ("unitPrice" <> 'NaN'::numeric);
ALTER TABLE "fertilizer_movement" ALTER COLUMN "totalCost" TYPE DECIMAL(15, 2)
  USING round("totalCost"::numeric, 2);
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_totalCost_finite" CHECK ("totalCost" <> 'NaN'::numeric);
ALTER TABLE "seasonal_worker" ALTER COLUMN "dailyWage" TYPE DECIMAL(15, 2)
  USING round("dailyWage"::numeric, 2);
ALTER TABLE "seasonal_worker" ADD CONSTRAINT "seasonal_worker_dailyWage_finite" CHECK ("dailyWage" <> 'NaN'::numeric);
ALTER TABLE "seasonal_work_log" ALTER COLUMN "dailyWageApplied" TYPE DECIMAL(15, 2)
  USING round("dailyWageApplied"::numeric, 2);
ALTER TABLE "seasonal_work_log" ADD CONSTRAINT "seasonal_work_log_dailyWageApplied_finite" CHECK ("dailyWageApplied" <> 'NaN'::numeric);
ALTER TABLE "onion_shipment" ALTER COLUMN "pricePerKg" TYPE DECIMAL(15, 4)
  USING round("pricePerKg"::numeric, 4);
ALTER TABLE "onion_shipment" ADD CONSTRAINT "onion_shipment_pricePerKg_finite" CHECK ("pricePerKg" <> 'NaN'::numeric);
ALTER TABLE "onion_shipment" ALTER COLUMN "totalValue" TYPE DECIMAL(15, 2)
  USING round("totalValue"::numeric, 2);
ALTER TABLE "onion_shipment" ADD CONSTRAINT "onion_shipment_totalValue_finite" CHECK ("totalValue" <> 'NaN'::numeric);

-- Keep the original actor ID and denormalized name/role even after account deletion.
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_userId_fkey";
COMMIT;

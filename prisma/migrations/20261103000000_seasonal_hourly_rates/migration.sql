BEGIN;
ALTER TABLE "seasonal_worker" ADD COLUMN "hourlyRate" DECIMAL(15, 2);
ALTER TABLE "seasonal_work_log" ADD COLUMN "hourlyRateApplied" DECIMAL(15, 2);

-- Preserve historical daily earnings. Old default daily wages cannot safely be
-- converted without knowing the agreed length of a work day.
UPDATE "seasonal_work_log"
SET "hourlyRateApplied" = ROUND("dailyWageApplied" / "hoursWorked"::numeric, 2)
WHERE "dailyWageApplied" > 0 AND "hoursWorked" > 0
  AND "dailyWageApplied" / "hoursWorked"::numeric BETWEEN 0.005 AND 9999999999999.99;

ALTER TABLE "seasonal_worker" ADD CONSTRAINT "seasonal_worker_hourlyRate_valid"
  CHECK ("hourlyRate" > 0 AND "hourlyRate" <> 'NaN'::numeric);
ALTER TABLE "seasonal_work_log" ADD CONSTRAINT "seasonal_work_log_hourlyRateApplied_valid"
  CHECK ("hourlyRateApplied" > 0 AND "hourlyRateApplied" <> 'NaN'::numeric);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';

-- Prevent documents being inserted while the existing numeric maxima are read.
LOCK TABLE "work_order", "onion_shipment" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "document_counter" (
  "prefix" TEXT NOT NULL,
  "lastValue" BIGINT NOT NULL,
  CONSTRAINT "document_counter_pkey" PRIMARY KEY ("prefix")
);

-- Parse numeric suffixes rather than sorting strings (9999 sorts after 10000).
-- Custom numbers outside the automatic namespace are deliberately preserved.
INSERT INTO "document_counter" ("prefix", "lastValue")
SELECT parts[1], MAX(parts[2]::BIGINT)
FROM (
  SELECT regexp_match("orderNumber", '^(RN-[0-9]{4}-)([0-9]+)$') AS parts
  FROM "work_order"
  UNION ALL
  SELECT regexp_match("dispatchNumber", '^(OTP-[0-9]{4}-)([0-9]+)$') AS parts
  FROM "onion_shipment"
) AS existing
WHERE parts IS NOT NULL
GROUP BY parts[1];

COMMIT;

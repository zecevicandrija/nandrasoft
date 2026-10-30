BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TABLE "mutation_receipt" (
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mutation_receipt_pkey" PRIMARY KEY ("userId", "key")
);
COMMIT;

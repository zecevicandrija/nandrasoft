// Always pass the transaction client used to create the document. PostgreSQL's
// upsert locks this prefix's counter row until commit (including first use).
async function nextNumber(db, prefix) {
  const [counter] = await db.$queryRaw`
    INSERT INTO "document_counter" ("prefix", "lastValue") VALUES (${prefix}, 1)
    ON CONFLICT ("prefix") DO UPDATE
      SET "lastValue" = "document_counter"."lastValue" + 1
    RETURNING "lastValue"
  `;
  return `${prefix}${String(counter.lastValue).padStart(4, "0")}`;
}

export function generateOrderNumber(db, date = new Date()) {
  return nextNumber(db, `RN-${date.getFullYear()}-`);
}

export function generateDispatchNumber(db, date = new Date()) {
  return nextNumber(db, `OTP-${date.getFullYear()}-`);
}

// Preserve custom dispatch numbers. Numbers in the automatic namespace advance
// its high-water mark, so a subsequent automatic allocation cannot collide.
export async function reserveDispatchNumber(db, number) {
  const match = /^(OTP-\d{4}-)(\d+)$/.exec(number);
  if (!match) return number;
  const value = BigInt(match[2]);
  if (value >= 9223372036854775807n) throw new Error("Broj otpremnice je prevelik.");
  await db.$queryRaw`
    INSERT INTO "document_counter" ("prefix", "lastValue") VALUES (${match[1]}, ${value})
    ON CONFLICT ("prefix") DO UPDATE
      SET "lastValue" = GREATEST("document_counter"."lastValue", EXCLUDED."lastValue")
    RETURNING "lastValue"
  `;
  return number;
}

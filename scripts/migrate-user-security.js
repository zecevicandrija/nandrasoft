import { pathToFileURL } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../lib/prisma.js";

// Default is a read-only preview. Never print PIN values or hashes.
export async function migrateUserSecurity(db, { apply = false } = {}) {
  const users = await db.user.findMany({
    where: { pin: { not: null } },
    select: { id: true, pin: true },
  });
  const legacy = users.filter((user) => /^\d{4}$/.test(user.pin));
  const inactiveSessions = await db.session.count({ where: { user: { isActive: false } } });
  let pinsHashed = 0;
  let sessionsRevoked = 0;
  if (apply) {
    for (const user of legacy) {
      const pin = await hashPassword(user.pin);
      // Do not overwrite a PIN changed concurrently by an administrator.
      const result = await db.user.updateMany({
        where: { id: user.id, pin: user.pin },
        data: { pin },
      });
      pinsHashed += result.count;
    }
    const result = await db.session.deleteMany({ where: { user: { isActive: false } } });
    sessionsRevoked = result.count;
  }
  return { apply, legacyPins: legacy.length, inactiveSessions, pinsHashed, sessionsRevoked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some((flag) => flag !== "--apply")) throw new Error("Supported option: --apply");
    console.log(JSON.stringify(await migrateUserSecurity(prisma, { apply: flags.includes("--apply") })));
  } catch {
    console.error("Security migration failed. Check the database connection and rerun; completed PIN updates are safe to repeat.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

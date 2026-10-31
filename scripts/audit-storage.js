// Read-only. Run using the DATABASE_URL of the database being measured.
import { prisma } from "../lib/prisma.js";
import { readStorageUsage } from "../lib/storageUsage.js";

try {
  const usage = await readStorageUsage(prisma);
  console.log(JSON.stringify(usage, null, 2));
  process.exitCode = usage.level === "critical" ? 2 : usage.level === "warning" ? 1 : 0;
} catch {
  console.error("Provera zauzeca baze nije uspela. Proverite konekciju i DB_STORAGE_QUOTA_BYTES.");
  process.exitCode = 3;
} finally { await prisma.$disconnect(); }

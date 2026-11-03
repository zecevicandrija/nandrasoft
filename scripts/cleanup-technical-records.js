import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.js";
import { cleanupTechnicalRecords, previewTechnicalCleanup } from "../lib/technicalCleanup.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && args[0] !== "--apply")) throw new Error("Use no options for preview, or --apply to clean eligible records");
    console.log(JSON.stringify(await (args[0] === "--apply" ? cleanupTechnicalRecords(prisma) : previewTechnicalCleanup(prisma))));
  } catch {
    console.error("TECHNICAL_CLEANUP_FAILED"); process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}

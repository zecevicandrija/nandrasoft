import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.js";
import {
  backfillLegacyRemontOrders,
  previewLegacyRemontBackfill,
} from "../lib/remontBackfill.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && args[0] !== "--apply")) {
      throw new Error("Use no options for preview, or --apply to backfill legacy REMONT_SERVIS orders");
    }
    const result =
      args[0] === "--apply"
        ? await backfillLegacyRemontOrders(prisma)
        : await previewLegacyRemontBackfill(prisma);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("REMONT_BACKFILL_FAILED", error?.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

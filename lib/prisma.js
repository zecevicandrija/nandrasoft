import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolConfig } from "./databaseConfig.js";

// The adapter owns this single pool; prisma.$disconnect() closes it.
// Auth and every application route import the same client from this module.
const adapter = new PrismaPg(databasePoolConfig(), {
  onPoolError(error) {
    console.error("Database idle connection failed.", { code: error.code || "UNKNOWN" });
  },
});
export const prisma = new PrismaClient({ adapter, transactionOptions: { maxWait: 5000 } });

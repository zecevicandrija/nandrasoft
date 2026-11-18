import { prisma } from "../lib/prisma.js";
import { usageInclude } from "../lib/machineUsageService.js";
import { fieldWorkStats, reportingQuery } from "../lib/fieldWorkReporting.js";
import { usageGroupBy } from "../lib/machineUsageReporting.js";

// Read-only smoke checks, including the joins used by the live work diary.
try {
  await prisma.fieldWork.findMany({ take: 1, include: { machine: true, machineAssignments: usageInclude, workOrder: true } });
  console.log("OK: dnevnik radova i povezana zaduzivanja");
  await prisma.workOrder.findMany({ take: 1, include: { machineAssignments: { include: { machine: true } }, fieldWork: true } });
  console.log("OK: radni nalozi");
  await fieldWorkStats(prisma, reportingQuery.parse({}));
  console.log("OK: statistika radova");
  await usageGroupBy(prisma, { by: ["machineId"], _sum: { areaDoneHa: true, workHours: true } });
  console.log("OK: izvestaj koriscenja masina");
} catch (error) {
  console.error("Provera baze nije uspela:", error.code || error.message);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

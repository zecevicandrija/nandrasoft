import { REMONT_PRIORITY_MAP } from "./workOrderCreate.js";
import { activeOrderStatuses, syncMachineStatus } from "./machineAvailability.js";
import { resolveWorkerForUser } from "./workerIdentity.js";

const MACHINES_LOCK_NAMESPACE = 1312902724;
const MACHINES_LOCK_KEY = 5;

function mapLegacyOrderStatusToIssueStatus(orderStatus) {
  if (orderStatus === "ZAVRSEN") return "POPRAVLJENO";
  if (orderStatus === "OTKAZAN") return "OTKAZAN";
  if (orderStatus === "U_TOKU") return "U_RADU";
  return "OTVOREN";
}

function summarizeUnlinkedOrders(orders) {
  const eligible = orders.filter((order) => Boolean(order.machineId));
  const withoutMachine = orders.filter((order) => !order.machineId);
  const byStatus = { active: 0, completed: 0, cancelled: 0 };

  for (const order of eligible) {
    if (order.status === "ZAVRSEN") byStatus.completed += 1;
    else if (order.status === "OTKAZAN") byStatus.cancelled += 1;
    else if (activeOrderStatuses.includes(order.status)) byStatus.active += 1;
  }

  return {
    totalUnlinked: orders.length,
    eligibleOrders: eligible.length,
    skippedWithoutMachine: withoutMachine.length,
    byStatus,
    sampleOrderNumbers: eligible.slice(0, 20).map((order) => order.orderNumber),
    withoutMachineOrderNumbers: withoutMachine.slice(0, 20).map((order) => order.orderNumber),
  };
}

/**
 * Read-only inspection of legacy REMONT_SERVIS orders missing a linked MaintenanceIssue.
 */
export async function previewLegacyRemontBackfill(db) {
  const unlinked = await db.workOrder.findMany({
    where: {
      orderType: "REMONT_SERVIS",
      maintenanceId: null,
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      machineId: true,
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
  });

  return {
    dryRun: true,
    ...summarizeUnlinkedOrders(unlinked),
  };
}

/**
 * One-off, idempotent backfill that creates and links MaintenanceIssue rows
 * for legacy REMONT_SERVIS work orders and synchronizes affected machine statuses.
 */
export async function backfillLegacyRemontOrders(db) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MACHINES_LOCK_NAMESPACE}::integer, ${MACHINES_LOCK_KEY}::integer)`;

      const unlinked = await tx.workOrder.findMany({
        where: {
          orderType: "REMONT_SERVIS",
          maintenanceId: null,
        },
        orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      });

      const summary = summarizeUnlinkedOrders(unlinked);
      const eligible = unlinked.filter((order) => Boolean(order.machineId));

      if (eligible.length === 0) {
        return {
          dryRun: false,
          ...summary,
          createdIssues: 0,
          machinesSynced: 0,
        };
      }

      const affectedMachineIds = [...new Set(eligible.map((order) => order.machineId))].sort();
      for (const machineId of affectedMachineIds) {
        await tx.$executeRaw`SELECT id FROM "machine" WHERE id = ${machineId} FOR UPDATE`;
      }

      const issuerWorkerCache = new Map();
      const linkedOrderNumbers = [];

      for (const order of eligible) {
        const issuePriority = REMONT_PRIORITY_MAP[order.priority] || "VISOKA";
        const issueStatus = mapLegacyOrderStatusToIssueStatus(order.status);

        let issuerWorker = null;
        if (order.issuedById) {
          if (!issuerWorkerCache.has(order.issuedById)) {
            issuerWorkerCache.set(
              order.issuedById,
              await resolveWorkerForUser({ id: order.issuedById }, tx)
            );
          }
          issuerWorker = issuerWorkerCache.get(order.issuedById);
        }

        const newIssue = await tx.maintenanceIssue.create({
          data: {
            machineId: order.machineId,
            serviceType: "REDOVAN_SERVIS",
            priority: issuePriority,
            status: issueStatus,
            ...(issueStatus === "POPRAVLJENO" && {
              repairedAt: order.updatedAt || order.orderDate || new Date(),
            }),
            reportedById: issuerWorker?.id || order.workerId,
            mechanicId: order.workerId,
            title: `Radni nalog ${order.orderNumber}: ${
              order.instructions ? order.instructions.slice(0, 50) : "Servis mašine"
            }`,
            description: order.instructions || "Planski remont i servis mehanizacije.",
            photoUrl: order.photoUrl || null,
            isMachineStopped: true,
            createdById: order.issuedById || null,
          },
        });

        await tx.workOrder.update({
          where: { id: order.id, maintenanceId: null },
          data: { maintenanceId: newIssue.id },
        });

        linkedOrderNumbers.push(order.orderNumber);
      }

      for (const machineId of affectedMachineIds) {
        await syncMachineStatus(tx, machineId);
      }

      await tx.auditLog.create({
        data: {
          entityType: "WorkOrder",
          entityId: "legacy-remont-backfill",
          action: "IZMENA",
          userId: "system:backfill-remont-orders",
          userName: "Sistem (dopuna naloga)",
          userRole: "SISTEM",
          description: `Dopunjeni stari servisni nalozi bez povezanog zapisa servisa (${linkedOrderNumbers.length}).`,
          newValues: {
            createdIssues: linkedOrderNumbers.length,
            machinesSynced: affectedMachineIds.length,
            orderNumbers: linkedOrderNumbers.slice(0, 50),
          },
        },
      });

      return {
        dryRun: false,
        ...summary,
        createdIssues: linkedOrderNumbers.length,
        machinesSynced: affectedMachineIds.length,
      };
    },
    { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 30000 }
  );
}

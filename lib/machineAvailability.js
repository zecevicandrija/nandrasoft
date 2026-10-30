import { inventoryMutation } from "./inventoryTransaction.js";

// All assignment, workshop and order mutations share a database transaction lock.
export const machineMutation = (handler) => inventoryMutation("machines", handler);
export const activeIssueStatuses = ["OTVOREN", "U_RADU", "CEKA_DELOVE"];
export const activeOrderStatuses = ["PLANIRAN", "DODELJEN", "U_TOKU"];

export async function hasOpenMaintenance(db, machineId) {
  const issue = await db.maintenanceIssue.findFirst({
    where: { machineId, status: { in: activeIssueStatuses } },
  });
  if (issue) return true;
  return Boolean(await db.workOrder.findFirst({
    where: { machineId, orderType: "REMONT_SERVIS", status: { in: activeOrderStatuses } },
  }));
}

// Call after changing the issue, order or assignment, in the same locked transaction.
export async function syncMachineStatus(db, machineId) {
  if (!machineId) return null;
  const issues = await db.maintenanceIssue.findMany({
    where: { machineId, status: { in: activeIssueStatuses } },
    select: { serviceType: true, status: true },
  });
  const openOrder = await db.workOrder.findFirst({
    where: { machineId, orderType: "REMONT_SERVIS", status: { in: activeOrderStatuses } },
  });
  let status;
  if (issues.some((issue) => issue.serviceType === "KVAR_NJIVA" && issue.status === "OTVOREN")) status = "U_KVARU";
  else if (issues.length || openOrder) status = "SERVIS";
  else status = await db.machineAssignment.findFirst({ where: { machineId, status: "ZADUZENA" } }) ? "ZADUZENA" : "SLOBODNA";
  return db.machine.update({ where: { id: machineId }, data: { status } });
}

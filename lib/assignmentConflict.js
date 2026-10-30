// PostgreSQL's partial unique index is the final guard against concurrent checkouts.
export function isActiveAssignmentConflict(error) {
  if (error?.code !== "P2002") return false;
  if (error.meta?.modelName && error.meta.modelName !== "MachineAssignment") return false;
  const target = error.meta?.target;
  return (Array.isArray(target) && target.length === 1 && target[0] === "machineId")
    || target === "machine_assignment_one_active_per_machine";
}

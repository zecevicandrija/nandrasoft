// Machine.updatedAt is the form's optimistic concurrency token. It is checked
// only for absolute measurements; refills are deltas applied under the row lock.
export function fuelSnapshotError(machine, expectedUpdatedAt) {
  const expected = typeof expectedUpdatedAt === "string" ? Date.parse(expectedUpdatedAt) : NaN;
  const current = machine?.updatedAt ? new Date(machine.updatedAt).getTime() : NaN;
  if (!Number.isFinite(expected) || expected !== current) return {
    error: "Stanje mašine je promenjeno ili nedostaje verzija podataka. Osvežite podatke, proverite poslednje sipanje i ponovo potvrdite izmereno gorivo.",
    code: "MACHINE_STATE_CHANGED",
  };
  return null;
}

export function nextMachineTimestamp(machine) {
  return new Date(Math.max(Date.now(), (new Date(machine.updatedAt).getTime() || 0) + 1));
}

export function measuredFuelData(machine, liters) {
  return { currentFuelLiters: liters, updatedAt: nextMachineTimestamp(machine) };
}

export function fuelDeltaData(machine, liters) {
  return {
    // SQL addition to NULL yields NULL, so initialize a legacy unknown level.
    currentFuelLiters: machine.currentFuelLiters == null ? liters : { increment: liters },
    updatedAt: nextMachineTimestamp(machine),
  };
}

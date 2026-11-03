// Legacy callers may still send a name, but persisted catalogue relationships
// always use the chamber ID. Unknown free-text locations are left unlinked.
export class StorageChamberError extends Error {}

// Called under the onion inventory lock; include other LOTs and legacy rows.
export async function validateStorageCapacity(db, proposed, existing = null) {
  if (!proposed.chamberId) return;
  const chamber = await db.onionChamber.findUnique({ where: { id: proposed.chamberId } });
  if (!chamber) throw new StorageChamberError("Izabrana komora više ne postoji.");
  const sameChamber = existing && (existing.chamberId === chamber.id ||
    (!existing.chamberId && existing.locationOrChamber?.trim().toLowerCase() === chamber.name.toLowerCase()));
  if (chamber.isActive === false && (!sameChamber || proposed.currentQuantityKg > existing.currentQuantityKg)) {
    throw new StorageChamberError("Komora je arhivirana i nije dostupna za novo skladištenje.");
  }
  const others = await db.onionStorageEntry.findMany({
    where: {
      ...(existing && { id: { not: existing.id } }),
      currentQuantityKg: { gt: 0 },
      OR: [
        { chamberId: chamber.id },
        { chamberId: null, locationOrChamber: { equals: chamber.name, mode: "insensitive" } },
      ],
    },
  });
  const boxes = (entry) => entry.currentQuantityKg > 0
    ? entry.boxCount ?? Math.ceil(entry.currentQuantityKg / 1100) : 0;
  const totalKg = others.reduce((sum, entry) => sum + entry.currentQuantityKg, 0) + proposed.currentQuantityKg;
  const totalBoxes = others.reduce((sum, entry) => sum + boxes(entry), 0) + boxes(proposed);
  // Existing excess may be reduced or annotated, but never increased or moved
  // into another full chamber. No historical data is silently rewritten.
  if (totalKg > chamber.maxCapacityKg && (!sameChamber || proposed.currentQuantityKg > existing.currentQuantityKg)) {
    throw new StorageChamberError(`Predloženo ukupno stanje od ${totalKg} kg prelazi kapacitet komore "${chamber.name}" od ${chamber.maxCapacityKg} kg za ${Number((totalKg - chamber.maxCapacityKg).toFixed(2))} kg. Rasporedite luk u drugu komoru ili proverite tačnost podešenog kapaciteta.`);
  }
  if (totalBoxes > chamber.maxBoxes && (!sameChamber || boxes(proposed) > boxes(existing))) {
    throw new StorageChamberError(`Predloženo ukupno stanje od ${totalBoxes} boksova prelazi kapacitet komore "${chamber.name}" od ${chamber.maxBoxes} boksova za ${totalBoxes - chamber.maxBoxes}. Rasporedite boksove u drugu komoru ili proverite tačnost podešenog kapaciteta.`);
  }
}

export async function resolveStorageChamber(db, { chamberId, locationOrChamber, storageType, hasEquipment }, { allowInactive = false } = {}) {
  let chamber = null;
  if (chamberId !== undefined && chamberId !== null) {
    if (typeof chamberId !== "string" || !chamberId.trim()) throw new StorageChamberError("Neispravan ID komore.");
    chamber = await db.onionChamber.findUnique({ where: { id: chamberId } });
    if (!chamber) throw new StorageChamberError("Izabrana komora više ne postoji. Osvežite spisak komora.");
  } else if (typeof locationOrChamber === "string" && locationOrChamber.trim()) {
    chamber = await db.onionChamber.findFirst({
      where: { name: { equals: locationOrChamber.trim(), mode: "insensitive" } },
    });
  }
  if (chamber?.isActive === false && !allowInactive) throw new StorageChamberError("Komora je arhivirana i nije dostupna za novo skladištenje.");
  const name = chamber?.name || (typeof locationOrChamber === "string" ? locationOrChamber.trim() : "");
  if (!name) throw new StorageChamberError("Izaberite komoru ili unesite lokaciju skladišta.");
  if (!chamber && storageType !== "MAGACIN") throw new StorageChamberError("Izabrana komora nije u šifarniku. Osvežite spisak komora.");
  return {
    chamberId: chamber?.id || null,
    locationOrChamber: name,
    storageType: chamber?.storageType || storageType || "HLADNJACA",
    hasEquipment: hasEquipment ?? chamber?.hasEquipment ?? true,
  };
}

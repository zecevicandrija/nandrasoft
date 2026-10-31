// Legacy callers may still send a name, but persisted catalogue relationships
// always use the chamber ID. Unknown free-text locations are left unlinked.
export class StorageChamberError extends Error {}

export async function resolveStorageChamber(db, { chamberId, locationOrChamber, storageType, hasEquipment }) {
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

const day = (date) => new Date(date).toLocaleDateString("sv-SE", { timeZone: "Europe/Belgrade" });

export async function validateFuelFieldWork(db, id, context) {
  if (!id) return null;
  const work = await db.fieldWork.findUnique({ where: { id } });
  if (!work || work.machineId !== context.machineId) {
    return "Izabrani rad na njivi ne postoji ili ne pripada ovoj masini.";
  }
  if (!context.isManager && (work.workerId !== context.workerId || day(work.date) !== day(context.date))) {
    return "Izabrani rad na njivi mora pripadati vasem profilu i datumu tocenja.";
  }
  return null;
}

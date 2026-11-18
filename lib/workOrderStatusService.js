export const statusError = (message, status = 409) => Object.assign(new Error(message), { status });

// A transition is authorized by its business operation, never by a target status alone.
export function assertOrderTransition(order, next, operation) {
  const rules = {
    accept: { PLANIRAN: ["U_TOKU"], DODELJEN: ["U_TOKU"] },
    complete: { U_TOKU: ["ZAVRSEN"] },
    cancel: { PLANIRAN: ["OTKAZAN"], DODELJEN: ["OTKAZAN"], U_TOKU: ["OTKAZAN"] },
    reactivate: { OTKAZAN: ["DODELJEN"] },
  };
  if (!rules[operation]?.[order.status]?.includes(next)) {
    throw statusError("Ova promena statusa nije dozvoljena. Koristite prihvatanje, završavanje ili otkazivanje naloga.");
  }
}

export function assertGenericOrderEdit(order, data, hasHistory = false) {
  if (data.status !== undefined && data.status !== order.status) {
    throw statusError("Status se menja kroz prihvatanje, završavanje ili otkazivanje naloga.");
  }
  if (hasHistory || !["PLANIRAN", "DODELJEN"].includes(order.status)) {
    for (const key of ["machineId", "workerId", "parcelId", "workTypeId", "attachmentId", "orderType"]) {
      if (data[key] !== undefined && (data[key] || null) !== (order[key] || null)) {
        throw statusError("Nalog već ima realizaciju. Za mašinu koristite korekciju/zamenu; radnika, parcelu i operaciju ne možete direktno promeniti.");
      }
    }
  }
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" });
export const sameWorkDay = (date, now = new Date()) => Boolean(date) && dayFormat.format(new Date(date)) === dayFormat.format(now);
export function assertCorrectionAccess(req, record, date) {
  if (["DIREKTOR", "RUKOVODILAC"].includes(req.user.role)) return;
  if (req.user.role !== "OPERATER" || req.worker?.id !== record.workerId || !sameWorkDay(date)) {
    throw statusError("Možete ispraviti samo svoje unose do kraja dana (Europe/Belgrade).", 403);
  }
}

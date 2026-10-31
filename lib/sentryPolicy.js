// Keep application payloads, credentials and database parameters out of reports.
export function sanitizeSentryEvent(event, hint = {}) {
  if (event.logger === "console" && !(hint.originalException instanceof Error)) return null;
  const status = Number(hint.originalException?.status || hint.originalException?.statusCode);
  if (status >= 400 && status < 500) return null;
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.contexts;
  const error = hint.originalException;
  const databaseError = error instanceof Error &&
    (/Prisma|Database/i.test(error.name) || /^[0-9A-Z]{5}$/.test(error.code || ""));
  for (const exception of event.exception?.values || []) {
    // Prisma/pg messages can contain SQL, parameters and user-entered values.
    if (databaseError) exception.value = `Database operation failed (${error.name})`;
  }
  return event;
}

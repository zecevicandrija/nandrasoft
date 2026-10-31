const OMIT = new Set(["updatedAt", "password", "passwordHash", "pin", "token", "accessToken", "refreshToken", "sessionToken"]);
const REFERENCES = ["worker", "machine", "attachment", "parcel", "workType", "issuedBy", "maintenance", "product", "supplier", "buyer", "lot", "seasonalWorker", "supervisor"];
const LABELS = ["name", "code", "orderNumber", "dispatchNumber", "lotNumber", "title"];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function scalar(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value.toJSON === "function") return value.toJSON();
  return value;
}

function snapshot(value, entityType) {
  if (value == null) return null;
  if (!object(value)) throw new Error("Audit values must be named fields");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (OMIT.has(key) || item === undefined) continue;
    const normalized = scalar(item);
    const arrayFields = entityType === "OnionShipment" && key === "items"
      ? ["id", "packagingId", "packageCount", "totalWeightKg"]
      : entityType === "SeasonalGroup" && key === "members" ? ["id", "name", "groupName"] : null;
    if (arrayFields && Array.isArray(item)) {
      result[key] = item.map((entry) => Object.fromEntries(arrayFields.filter((field) => entry[field] !== undefined).map((field) => [field, scalar(entry[field])])));
      continue;
    }
    // Arrays/relations are handled explicitly, never copied wholesale.
    if (normalized === null || ["string", "number", "boolean"].includes(typeof normalized)) result[key] = normalized;
  }
  return result;
}

function references(value) {
  const result = {};
  for (const key of REFERENCES) {
    const relation = value?.[key];
    if (!object(relation)) continue;
    const identity = {};
    for (const field of ["id", ...LABELS]) if (relation[field] != null) identity[field] = scalar(relation[field]);
    if (Object.keys(identity).length) result[key] = identity;
  }
  return result;
}

// Applies only to NEW inserts. Never rewrites existing historical snapshots.
// A partial newValues object means "provided changes", not removal of old keys.
export function compactAuditData(data) {
  const before = snapshot(data.oldValues, data.entityType), after = snapshot(data.newValues, data.entityType);
  const context = { ...(data.context || {}) };
  const labelSource = { ...data.oldValues, ...data.newValues };
  for (const field of ["id", ...LABELS]) if (labelSource?.[field] != null) context[field] = scalar(labelSource[field]);
  const beforeRefs = references(data.oldValues);
  const afterRefs = data.oldValues && data.newValues ? { ...beforeRefs, ...references(data.newValues) } : references(data.newValues);
  if (data.newValues) for (const key of REFERENCES) {
    const fk = `${key}Id`;
    if (Object.hasOwn(data.newValues, key) && data.newValues[key] === null) afterRefs[key] = null;
    if (Object.hasOwn(data.newValues, fk) && !object(data.newValues[key]) && data.newValues[fk] !== data.oldValues?.[fk]) {
      afterRefs[key] = data.newValues[fk] === null ? null : { id: data.newValues[fk] };
    }
  }
  if (Object.keys(beforeRefs).length || Object.keys(afterRefs).length) {
    context.references = { before: beforeRefs, after: equal(beforeRefs, afterRefs) ? undefined : afterRefs };
  }
  let oldValues = before, newValues = after;
  if (before && after) {
    oldValues = {}; newValues = {};
    for (const [field, value] of Object.entries(after)) {
      if (Object.hasOwn(before, field) && equal(before[field], value)) continue;
      if (Object.hasOwn(before, field)) oldValues[field] = before[field];
      newValues[field] = value;
    }
    // Relation-only changes are retained as small before/after identities above.
  }
  const result = { ...data, formatVersion: 2, context: JSON.parse(JSON.stringify(context)) };
  if (oldValues !== null) result.oldValues = oldValues;
  if (newValues !== null) result.newValues = newValues;
  return result;
}

export function prepareAuditInsert(model, operation, args) {
  if (model !== "AuditLog") return args;
  if (operation === "create") return { ...args, data: compactAuditData(args.data) };
  if (["createMany", "createManyAndReturn"].includes(operation)) return {
    ...args, data: (Array.isArray(args.data) ? args.data : [args.data]).map(compactAuditData),
  };
  // History is append-only through the application client, including legacy rows.
  if (["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert"].includes(operation)) {
    throw new Error("Audit history cannot be modified through the application");
  }
  return args;
}

export function auditEvent(req, event) {
  if (!req.user?.id) throw new Error("Audit requires an authenticated actor");
  // The shared Prisma client compacts once, including inside transactions.
  return {
    ...event, userId: req.user.id, userName: req.user.name || "Korisnik", userRole: req.user.role,
    context: { ...event.context, operationId: req.auditOperationId },
  };
}

export const writeAudit = (db, req, event) => db.auditLog.create({ data: auditEvent(req, event) });
export const writeAuditBatch = (db, req, events) => db.auditLog.createMany({ data: events.map((event) => auditEvent(req, event)) });

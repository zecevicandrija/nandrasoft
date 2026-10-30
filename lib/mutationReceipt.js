import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function mutationIdentity(req) {
  const key = req.headers?.["idempotency-key"];
  if (key === undefined) return null;
  if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(key) || !req.user?.id) {
    throw Object.assign(new Error("Neispravan ključ zahteva."), { response: { status: 400, body: { error: "Neispravan ključ zahteva." } } });
  }
  const route = `${req.method}:${req.baseUrl || ""}${req.path || (req.url || "").split("?")[0]}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical(req.body ?? {}))).digest("hex");
  return { userId: req.user.id, key, route, fingerprint };
}

export async function findReceipt(tx, identity) {
  const rows = await tx.$queryRaw`SELECT "route", "fingerprint", "statusCode", "response"
    FROM "mutation_receipt" WHERE "userId" = ${identity.userId} AND "key" = ${identity.key}`;
  const row = rows[0];
  if (!row) return null;
  if (row.route !== identity.route || row.fingerprint !== identity.fingerprint) {
    return { status: 409, body: { error: "Isti ključ je već korišćen za drugačiji zahtev.", code: "IDEMPOTENCY_MISMATCH" } };
  }
  return { status: row.statusCode, body: row.response };
}

export async function saveReceipt(tx, identity, response) {
  await tx.$executeRaw`INSERT INTO "mutation_receipt" ("userId", "key", "route", "fingerprint", "statusCode", "response")
    VALUES (${identity.userId}, ${identity.key}, ${identity.route}, ${identity.fingerprint}, ${response.status}, ${JSON.stringify(response.body)}::jsonb)`;
}

import { z } from "zod";
import { Prisma } from "@prisma/client";

export const materialKindSchema = z.enum(["FERTILIZER", "CHEMICAL", "SEED"]);
export const materialsSchema = z.array(z.object({
  kind: materialKindSchema,
  productId: z.string().min(1).max(100),
  dosePerHa: z.number().finite().positive().max(1e12).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})).max(20, "Na jednom nalogu možete izabrati najviše 20 materijala.");

// Snapshot fields are sufficient for lists, detail, and drafts: no product joins.
export const materialSelect = { kind: true, productId: true, code: true, name: true, unit: true, dosePerHa: true, notes: true };
export const materialsInclude = { select: materialSelect, orderBy: [{ name: "asc" }, { productId: "asc" }] };

export function materialText(items = []) {
  const units = { KG: "kg", L: "l", G: "g", ML: "ml", TONA: "t", SEME: "semena", PAKOVANJE: "pakovanja", KOM: "kom", SJ: "SJ" };
  return items.map(item => `${item.name}${item.dosePerHa != null ? ` (${item.dosePerHa} ${units[item.unit] || item.unit}/ha)` : ""}${item.notes ? ` — ${item.notes}` : ""}`).join("\n");
}

export function materialError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function materialPrefixQuery(value) {
  const words = value.toLowerCase().replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z").replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.join("").length < 2) return null;
  return [...new Set(words)].slice(0, 8).map(word => `${word}:*`).join(" & ");
}

const catalogues = {
  CHEMICAL: {
    table: "chemical_product", delegate: "chemicalProduct", foreignKey: "chemicalId",
    text: `code || ' ' || name || ' ' || coalesce("activeIngredient", '')`,
    fields: `id, code, name, unit, "activeIngredient", notes, "isActive"`,
  },
  SEED: {
    table: "seed_product", delegate: "seedProduct", foreignKey: "seedId",
    text: `code || ' ' || name || ' ' || crop || ' ' || coalesce(variety, '') || ' ' || coalesce(manufacturer, '')`,
    fields: `id, code, name, unit, crop, variety, manufacturer, notes, "isActive"`,
  },
  FERTILIZER: {
    table: "fertilizer_product", delegate: "fertilizerProduct", foreignKey: "fertilizerId",
    text: `coalesce(code, '') || ' ' || name`,
    fields: `id, code, name, unit::text, "isActive"`,
  },
};

export function materialCatalogue(kind) { return catalogues[kind]; }

export async function searchMaterials(db, kind, { q = "", limit = 10, page = null, after = null, catalogue = false } = {}) {
  const config = catalogues[kind];
  if (!config) throw materialError("Nepoznata vrsta materijala.");
  const query = materialPrefixQuery(q);
  if (!query && (!catalogue || q.trim())) {
    return { items: [], totalItems: 0, totalPages: 1, page: page || 1, pageSize: limit, hasMore: false, nextCursor: null };
  }
  const take = Math.max(1, Math.min(catalogue ? 50 : 10, limit));
  const sortField = kind === "FERTILIZER" ? "name" : "code";
  const filter = query ? Prisma.sql`AND material_search_vector(${Prisma.raw(config.text)}) @@ to_tsquery('simple'::regconfig, ${query})` : Prisma.empty;

  if (catalogue && page != null) {
    const pageNum = Math.max(1, page);
    const offset = (pageNum - 1) * take;
    const [countRows, rows] = await Promise.all([
      db.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS count FROM ${Prisma.raw(config.table)} WHERE "isActive" = true ${filter}`),
      db.$queryRaw(Prisma.sql`SELECT ${Prisma.raw(config.fields)} FROM ${Prisma.raw(config.table)}
        WHERE "isActive" = true ${filter}
        ORDER BY ${Prisma.raw(`"${sortField}"`)}, id LIMIT ${take} OFFSET ${offset}`)
    ]);
    const totalItems = Number(countRows[0]?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / take));
    return {
      items: rows,
      totalItems,
      totalPages,
      page: pageNum,
      pageSize: take,
      hasMore: pageNum < totalPages,
      nextCursor: null
    };
  }

  const cursor = after ? Prisma.sql`AND (${Prisma.raw(`"${sortField}"`)}, id) > (${after.key}, ${after.id})` : Prisma.empty;
  const rows = await db.$queryRaw(Prisma.sql`SELECT ${Prisma.raw(config.fields)} FROM ${Prisma.raw(config.table)}
    WHERE "isActive" = true ${filter} ${cursor}
    ORDER BY ${Prisma.raw(`"${sortField}"`)}, id LIMIT ${take + 1}`);
  const items = rows.slice(0, take);
  const last = items.at(-1);
  return {
    items,
    totalItems: items.length,
    totalPages: 1,
    page: 1,
    pageSize: take,
    hasMore: rows.length > take,
    nextCursor: rows.length > take && last ? Buffer.from(JSON.stringify({ key: last[sortField], id: last.id })).toString("base64url") : null
  };
}

// One work-type lookup and at most one IN query for all chosen products.
// Preserve snapshots for retained rows, including products archived meanwhile.
export async function prepareMaterials(db, workTypeId, submitted, previous = [], { enforceRequired = true } = {}) {
  const items = materialsSchema.parse(submitted ?? []);
  const workType = workTypeId ? await db.workType.findUnique({ where: { id: workTypeId }, select: { materialKind: true, materialRequired: true } }) : null;
  if (items.length && !workType?.materialKind) throw materialError("Izabrana operacija ne koristi materijale.");
  if (enforceRequired && workType?.materialRequired && !items.length) throw materialError("Izaberite materijal za ovu operaciju.");
  if (!items.length) return [];
  if (items.some(item => item.kind !== workType.materialKind)) throw materialError("Vrsta materijala ne odgovara radnoj operaciji.");
  if (new Set(items.map(item => item.productId)).size !== items.length) throw materialError("Isti artikal je izabran više puta.");
  const config = catalogues[workType.materialKind];
  const retained = new Map(previous.filter(item => item.kind === workType.materialKind).map(item => [item.productId, item]));
  const ids = items.filter(item => !retained.has(item.productId)).map(item => item.productId);
  const products = ids.length ? await db[config.delegate].findMany({ where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, unit: true, ...(workType.materialKind !== "FERTILIZER" && { code: true }) } }) : [];
  const found = new Map(products.map(product => [product.id, product]));
  return items.map(item => {
    const product = retained.get(item.productId) ?? found.get(item.productId);
    if (!product) throw materialError("Artikal ne postoji ili je arhiviran. Osvežite izbor materijala.");
    return { kind: item.kind, productId: item.productId, [config.foreignKey]: item.productId,
      name: product.name, code: product.code ?? null, unit: product.unit,
      dosePerHa: item.dosePerHa ?? null, notes: item.notes || null };
  });
}

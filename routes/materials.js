import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireManager } from "../middlewares/auth.js";
import { materialKindSchema, materialCatalogue, searchMaterials } from "../lib/workMaterials.js";

const router = Router();
router.use(requireAuth);
const optionalText = max => z.string().trim().max(max).nullable().optional();
const base = z.object({
  code: z.string().trim().min(1, "Šifra je obavezna.").max(40),
  name: z.string().trim().min(2, "Naziv mora imati bar 2 karaktera.").max(160),
  unit: z.enum(["KG", "L", "G", "ML", "SEME", "PAKOVANJE", "KOM", "SJ"]),
  notes: optionalText(500),
  isActive: z.boolean().optional(),
});
const schemas = {
  CHEMICAL: base.extend({ activeIngredient: optionalText(200) }),
  SEED: base.extend({ crop: z.string().trim().min(1).max(100).default("Luk"), variety: optionalText(100), manufacturer: optionalText(100) }),
};
const searchSchema = z.object({ q: z.string().trim().max(120).default(""), limit: z.coerce.number().int().min(1).max(25).default(10), cursor: z.string().max(1000).optional() });
const catalogueSchema = z.object({ q: z.string().trim().max(120).default(""), limit: z.coerce.number().int().min(1).max(50).default(10), page: z.coerce.number().int().min(1).default(1), cursor: z.string().max(1000).optional() });

function errorResponse(res, error) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join(" ") });
  if (error?.code === "P2002") return res.status(409).json({ error: "Artikal sa ovom šifrom već postoji." });
  if (error?.code === "P2025") return res.status(404).json({ error: "Artikal nije pronađen." });
  if (error?.status === 400) return res.status(400).json({ error: error.message });
  console.error("Material catalogue failed:", error);
  return res.status(500).json({ error: "Šifarnik materijala trenutno nije dostupan." });
}

async function readCatalogue(req, res, catalogue) {
  try {
    const kind = materialKindSchema.parse(req.params.kind);
    const params = (catalogue ? catalogueSchema : searchSchema).parse(req.query);
    let after = null;
    if (params.cursor) {
      try { after = z.object({ key: z.string().max(160), id: z.string().min(1).max(100) }).parse(JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8"))); }
      catch { return res.status(400).json({ error: "Neispravna stranica šifarnika." }); }
    }
    const page = params.cursor ? null : (catalogue ? params.page : null);
    res.json(await searchMaterials(prisma, kind, { ...params, page, after, catalogue }));
  } catch (error) { errorResponse(res, error); }
}

router.get("/search/:kind", (req, res) => readCatalogue(req, res, false));
router.get("/catalogue/:kind", (req, res) => readCatalogue(req, res, true));

// The fertilizer catalogue and its stock remain owned by the fertilizer module.
router.post("/catalogue/:kind", requireManager, async (req, res) => {
  try {
    const schema = Object.hasOwn(schemas, req.params.kind) ? schemas[req.params.kind] : null;
    if (!schema) return res.status(400).json({ error: "Koristite šifarnik đubriva za unos đubriva." });
    const data = schema.parse(req.body);
    const model = materialCatalogue(req.params.kind).delegate;
    const product = await prisma[model].create({ data });
    res.status(201).json({ product });
  } catch (error) { errorResponse(res, error); }
});

router.put("/catalogue/:kind/:id", requireManager, async (req, res) => {
  try {
    const schema = Object.hasOwn(schemas, req.params.kind) ? schemas[req.params.kind] : null;
    if (!schema) return res.status(400).json({ error: "Koristite šifarnik đubriva za izmenu đubriva." });
    const data = schema.partial().parse(req.body);
    const model = materialCatalogue(req.params.kind).delegate;
    res.json({ product: await prisma[model].update({ where: { id: req.params.id }, data }) });
  } catch (error) { errorResponse(res, error); }
});

export default router;

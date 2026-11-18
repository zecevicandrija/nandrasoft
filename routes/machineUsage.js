import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireWorkerIdentity } from "../lib/workerIdentity.js";
import { machineMutation } from "../lib/machineAvailability.js";
import { changeMachineUsage, usageChangeSchema, usageContext } from "../lib/machineUsageService.js";
import { assertCorrectionAccess, statusError } from "../lib/workOrderStatusService.js";
import { z } from "zod";
const router = Router();
router.use(requireAuth, requireWorkerIdentity);
router.get("/:type/:id", async (req, res) => {
  try { res.json(await usageContext(prisma, req.params.type, req.params.id, req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "Pregled korišćenja nije učitan." }); }
});
router.post("/change", machineMutation(async (req, res, db) => {
  const parsed = usageChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(". ") });
  try { return res.json(await changeMachineUsage(db, req, parsed.data)); }
  catch (e) {
    if (!e.status) console.error("Machine usage correction failed", e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : "Promena nije sačuvana." });
  }
}));
router.post("/allocate", machineMutation(async (req, res, db) => {
  try {
    const input = z.object({ contextType: z.enum(["work", "order", "assignment"]), contextId: z.string(), version: z.string(),
      areaDoneHa: z.number().finite().positive(), reason: z.string().trim().min(3).max(500),
      allocations: z.array(z.object({ id: z.string(), areaDoneHa: z.number().finite().nonnegative() })).min(1),
    }).parse(req.body);
    const c = await usageContext(db, input.contextType, input.contextId, req);
    assertCorrectionAccess(req, c.record, c.editDate);
    if (c.version !== input.version) throw statusError("Podaci su promenjeni. Osvežite pregled.");
    if (!c.work || c.work.status === "STORNO") throw statusError("Raspodela se menja na evidentiranom, nestorniranom radu.");
    const segments = c.assignments.filter(a => !a.voidedAt);
    const ids = new Set(input.allocations.map(a => a.id));
    if (ids.size !== input.allocations.length || segments.length !== ids.size || segments.some(a => !ids.has(a.id)) ||
        Math.abs(input.allocations.reduce((n, a) => n + a.areaDoneHa, 0) - input.areaDoneHa) > 0.001) {
      throw statusError("Raspodela mora obuhvatiti svako korišćenje i odgovarati ukupnoj površini.", 400);
    }
    const parcel = await db.parcel.findUnique({ where: { id: c.work.parcelId } });
    if (input.areaDoneHa > Math.round(parcel.areaHa * 1.2 * 100) / 100) throw statusError("Površina prelazi veličinu parcele uz toleranciju 20%.", 400);
    for (const a of input.allocations) await db.machineAssignment.update({ where: { id: a.id }, data: { areaDoneHa: a.areaDoneHa, fieldWorkId: c.work.id } });
    await db.fieldWork.update({ where: { id: c.work.id }, data: { areaDoneHa: input.areaDoneHa } });
    await db.auditLog.create({ data: { entityType: "FieldWork", entityId: c.work.id, action: "IZMENA", userId: req.user.id,
      userName: req.user.name, userRole: req.user.role, description: `Korekcija raspodele hektara: ${input.reason}`,
      oldValues: { areaDoneHa: c.work.areaDoneHa, allocations: segments.map(a => ({ id: a.id, areaDoneHa: a.areaDoneHa })) },
      newValues: { areaDoneHa: input.areaDoneHa, allocations: input.allocations } } });
    return res.json({ message: "Raspodela hektara je sačuvana." });
  } catch (e) { return res.status(e instanceof z.ZodError ? 400 : e.status || 500).json({ error: e.status ? e.message : "Proverite raspodelu hektara." }); }
}));
export default router;

import { z } from "zod";
import { materialsSchema, materialsInclude, prepareMaterials } from "./workMaterials.js";
import { optionalContractorId, validateContractor } from "./contractors.js";
import { generateOrderNumber } from "./documentNumbers.js";
import { enqueueWorkOrderPush } from "./pushOutbox.js";
import { photoUrlSchema } from "./photoUrl.js";
import { resolveWorkerForUser } from "./workerIdentity.js";

export const orderTypeEnum = z.enum(["RAD_NJIVA", "REMONT_SERVIS", "OSTALO"]);
export const orderStatusEnum = z.enum(["PLANIRAN", "DODELJEN", "U_TOKU", "ZAVRSEN", "OTKAZAN"]);
export const shiftTypeEnum = z.enum(["PRVA", "DRUGA", "TRECA"]);
export const serviceTypeEnum = z.enum(["REDOVAN_SERVIS", "GENERALNI_REMONT", "KVAR_NJIVA"]);

export const REMONT_PRIORITY_MAP = {
  KRITICNO: "KRITICNA",
  HITNO: "VISOKA",
  NORMALNO: "SREDNJA",
  KRITICNA: "KRITICNA",
  VISOKA: "VISOKA",
  SREDNJA: "SREDNJA",
  NISKA: "NISKA",
};

export const createWorkOrderSchema = z.object({
  orderDate: z.string().or(z.date()),
  orderType: orderTypeEnum.default("RAD_NJIVA"),
  priority: z.string().default("NORMALNO"),
  serviceType: serviceTypeEnum.optional().nullable(),
  workerId: z.string().min(1, "Radnik je obavezan"),
  machineId: z.string().optional().nullable(),
  attachmentId: z.string().optional().nullable(),
  contractorId: optionalContractorId,
  materials: materialsSchema.optional(),
  parcelId: z.string().optional().nullable(),
  workTypeId: z.string().optional().nullable(),
  plannedAreaHa: z.number().positive("Površina mora biti pozitivna").optional().nullable(),
  shift: shiftTypeEnum.default("PRVA"),
  instructions: z.string().max(500).optional().nullable(),
  photoUrl: photoUrlSchema,
});

function createOrderError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Creates a WorkOrder record using the standard issuing workflow (order number,
 * materials, optional maintenance issue for REMONT_SERVIS, audit log, push outbox).
 */
export async function createWorkOrderRecord(db, user, data) {
  const worker = await db.worker.findUnique({ where: { id: data.workerId } });
  if (!worker) throw createOrderError(404, "Izabrani radnik nije pronađen.");
  if (worker.isActive === false) throw createOrderError(409, "Arhivirani radnik ne može dobiti novi radni nalog.");

  for (const id of [data.machineId, data.attachmentId].filter(Boolean)) {
    const selected = await db.machine.findUnique({ where: { id } });
    if (!selected) throw createOrderError(404, "Izabrana mašina ili priključak nije pronađen.");
    if (selected.isActive === false) {
      throw createOrderError(409, "Arhivirana mašina ili priključak ne može se koristiti na novom nalogu.");
    }
  }

  if (data.parcelId) {
    const parcel = await db.parcel.findUnique({ where: { id: data.parcelId } });
    if (!parcel || parcel.isActive === false) {
      throw createOrderError(400, "Izabrana parcela nije pronađena ili je arhivirana.");
    }
  }

  if (data.workTypeId) {
    const workType = await db.workType.findUnique({ where: { id: data.workTypeId } });
    if (!workType || workType.isActive === false) {
      throw createOrderError(400, "Izabrana radna operacija nije pronađena ili je arhivirana.");
    }
  }

  const materialRows = await prepareMaterials(
    db,
    data.orderType === "RAD_NJIVA" ? data.workTypeId : null,
    data.materials
  );
  const orderNumber = await generateOrderNumber(db);

  let maintenanceId = null;
  if (data.orderType === "REMONT_SERVIS" && data.machineId) {
    const issuePriority = REMONT_PRIORITY_MAP[data.priority] || "VISOKA";
    const serviceType = data.serviceType || "REDOVAN_SERVIS";
    const machineStatus = serviceType === "KVAR_NJIVA" ? "U_KVARU" : "SERVIS";
    const issuerWorker = await resolveWorkerForUser(user, db);

    const issue = await db.maintenanceIssue.create({
      data: {
        machineId: data.machineId,
        serviceType,
        priority: issuePriority,
        status: "OTVOREN",
        reportedById: issuerWorker?.id || data.workerId,
        mechanicId: data.workerId,
        title: `Radni nalog ${orderNumber}: ${
          data.instructions ? data.instructions.slice(0, 50) : "Servis mašine"
        }`,
        description: data.instructions || "Planski remont i servis mehanizacije.",
        photoUrl: data.photoUrl || null,
        isMachineStopped: true,
        createdById: user.id,
      },
    });
    maintenanceId = issue.id;

    await db.machine.update({
      where: { id: data.machineId },
      data: { status: machineStatus },
    });
  }

  const contractorId = data.orderType === "RAD_NJIVA" ? data.contractorId ?? null : null;
  await validateContractor(db, contractorId);

  const workOrder = await db.workOrder.create({
    data: {
      orderNumber,
      ...(materialRows.length && { materials: { createMany: { data: materialRows } } }),
      orderDate: new Date(data.orderDate),
      orderType: data.orderType,
      priority: data.priority,
      workerId: data.workerId,
      machineId: data.machineId || null,
      attachmentId: data.attachmentId || null,
      contractorId,
      parcelId: data.parcelId || null,
      workTypeId: data.workTypeId || null,
      plannedAreaHa: data.plannedAreaHa || null,
      shift: data.shift,
      instructions: data.instructions || null,
      photoUrl: data.photoUrl || null,
      status: "DODELJEN",
      maintenanceId,
      issuedById: user.id,
    },
    include: {
      worker: true,
      machine: true,
      attachment: true,
      parcel: true,
      contractor: true,
      workType: true,
      materials: materialsInclude,
      maintenance: {
        select: { id: true, serviceType: true, priority: true, status: true },
      },
    },
  });

  await db.auditLog.create({
    data: {
      entityType: "WorkOrder",
      entityId: workOrder.id,
      action: "KREIRANJE",
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      description: `Izdat radni nalog ${workOrder.orderNumber} za radnika ${workOrder.worker.name}`,
      newValues: workOrder,
    },
  });

  await enqueueWorkOrderPush(db, workOrder);

  return workOrder;
}

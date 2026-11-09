import { z } from "zod";

export const contractorSchema = z.object({
  code: z.string().trim().min(1, "Šifra kooperanta je obavezna").max(20),
  name: z.string().trim().min(2, "Naziv kooperanta mora imati barem 2 karaktera").max(100),
  phone: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const optionalContractorId = z.string().trim().min(1).nullable().optional();

export async function validateContractor(prisma, contractorId) {
  if (contractorId && !await prisma.contractor.findUnique({ where: { id: contractorId } })) {
    throw Object.assign(new Error("Izabrani kooperant ne postoji."), { status: 400 });
  }
}

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auth } from "./auth.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

// Svi endpointi zahtevaju DIREKTOR ulogu
router.use(requireAuth);
router.use(requireRole(["DIREKTOR"]));

// Zod validacione šeme
const roleEnum = z.enum(["DIREKTOR", "RUKOVODILAC", "MAGACIN", "MEHANICAR", "OPERATER"], {
  message: "Nevažeća uloga. Dozvoljene: DIREKTOR, RUKOVODILAC, MAGACIN, MEHANICAR, OPERATER",
});

const createUserSchema = z.object({
  name: z.string().min(2, "Ime mora imati najmanje 2 karaktera").max(100, "Ime je predugačko"),
  email: z.string().email("Unesite ispravnu email adresu"),
  password: z.string().min(6, "Lozinka mora imati najmanje 6 karaktera").max(128, "Lozinka je predugačka"),
  role: roleEnum.default("OPERATER"),
  phone: z.string().max(30, "Broj telefona je predugačak").optional().nullable(),
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN mora imati tačno 4 cifre")
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((val) => (val === "" ? null : val)),
});

const updateUserSchema = z.object({
  name: z.string().min(2, "Ime mora imati najmanje 2 karaktera").max(100).optional(),
  email: z.string().email("Unesite ispravnu email adresu").optional(),
  role: roleEnum.optional(),
  phone: z.string().max(30).optional().nullable(),
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN mora imati tačno 4 cifre")
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((val) => (val === "" ? null : val)),
  isActive: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  password: z.string().min(6, "Lozinka mora imati najmanje 6 karaktera").max(128, "Lozinka je predugačka"),
});

/**
 * GET /api/users — Lista svih korisnika
 */
router.get("/", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        pin: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        image: true,
      },
    });

    res.json({ users });
  } catch (error) {
    console.error("Greška pri dohvatanju korisnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

/**
 * GET /api/users/:id — Pojedinačni korisnik
 */
router.get("/:id", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        pin: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        image: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "Korisnik nije pronađen." });
    }

    res.json({ user });
  } catch (error) {
    console.error("Greška pri dohvatanju korisnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

/**
 * POST /api/users — Kreiranje novog korisnika (sa Zod validacijom)
 */
router.post("/", async (req, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join(". ");
      return res.status(400).json({ error: errorMsg });
    }

    const { name, email, password, role, phone, pin } = parsed.data;

    // Koristi Better Auth signUp da ispravno hashuje lozinku
    const result = await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
        role,
        phone: phone || undefined,
        pin: pin || undefined,
      },
    });

    res.status(201).json({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
      },
    });
  } catch (error) {
    console.error("Greška pri kreiranju korisnika:", error);

    if (error?.message?.includes("already") || error?.status === 422) {
      return res
        .status(409)
        .json({ error: "Korisnik sa ovim email-om već postoji." });
    }

    res.status(500).json({ error: "Greška na serveru." });
  }
});

/**
 * PUT /api/users/:id — Ažuriranje korisnika (sa Zod validacijom)
 */
router.put("/:id", async (req, res) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join(". ");
      return res.status(400).json({ error: errorMsg });
    }

    // Proveri da li korisnik postoji
    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Korisnik nije pronađen." });
    }

    const updateData = {};
    const { name, email, role, phone, pin, isActive } = parsed.data;
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone;
    if (pin !== undefined) updateData.pin = pin;
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        pin: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ user });
  } catch (error) {
    console.error("Greška pri ažuriranju korisnika:", error);

    if (error?.code === "P2002") {
      return res
        .status(409)
        .json({ error: "Email adresa je već zauzeta." });
    }

    res.status(500).json({ error: "Greška na serveru." });
  }
});

/**
 * PUT /api/users/:id/password — Promena lozinke korisnika (sa Zod validacijom)
 */
router.put("/:id/password", async (req, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join(". ");
      return res.status(400).json({ error: errorMsg });
    }

    const { password } = parsed.data;

    // Koristi Better Auth context za hashovanje lozinke
    const ctx = await auth.$context;
    const hashedPassword = await ctx.password.hash(password);

    // Ažuriraj lozinku u Account tabeli (credential provider)
    const account = await prisma.account.findFirst({
      where: {
        userId: req.params.id,
        providerId: "credential",
      },
    });

    if (!account) {
      return res
        .status(404)
        .json({ error: "Nalog korisnika nije pronađen." });
    }

    await prisma.account.update({
      where: { id: account.id },
      data: { password: hashedPassword },
    });

    res.json({ message: "Lozinka uspešno promenjena." });
  } catch (error) {
    console.error("Greška pri promeni lozinke:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

/**
 * DELETE /api/users/:id — Brisanje korisnika
 */
router.delete("/:id", async (req, res) => {
  try {
    // Ne dozvoli brisanje sopstvenog naloga
    if (req.params.id === req.user.id) {
      return res
        .status(400)
        .json({ error: "Ne možete obrisati sopstveni nalog." });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Korisnik nije pronađen." });
    }

    await prisma.user.delete({
      where: { id: req.params.id },
    });

    res.json({ message: "Korisnik uspešno obrisan." });
  } catch (error) {
    console.error("Greška pri brisanju korisnika:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

export default router;

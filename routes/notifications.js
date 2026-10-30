import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import {
  getVapidPublicKey,
  sendPushToUser,
} from "../lib/pushNotification.js";

const router = Router();

// Javni endpoint za dohvatanje VAPID public ključa
router.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// Ostali endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);

// Provera statusa pretplate za trenutnog korisnika
router.get("/status", async (req, res) => {
  try {
    const count = await prisma.pushSubscription.count({
      where: { userId: req.user.id },
    });
    res.json({ subscribed: count > 0, count });
  } catch (error) {
    console.error("Greška pri proveri statusa push pretplate:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

const subscribeSchema = z.object({
  endpoint: z.string().url("Neispravan endpoint za push pretplatu."),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// Čuvanje / ažuriranje Web Push pretplate uređaja za trenutnog korisnika
router.post("/subscribe", async (req, res) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(". "),
      });
    }

    const { endpoint, keys } = parsed.data;
    const userAgent = req.headers["user-agent"] || null;

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: req.user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
      create: {
        userId: req.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
    });

    res.status(201).json({
      message: "Uređaj je uspešno registrovan za Web Push notifikacije.",
      subscriptionId: subscription.id,
    });
  } catch (error) {
    console.error("Greška pri čuvanju push pretplate:", error);
    res.status(500).json({ error: "Greška pri registraciji notifikacija." });
  }
});

// Uklanjanje pretplate uređaja
router.post("/unsubscribe", async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint, userId: req.user.id },
      });
    } else {
      await prisma.pushSubscription.deleteMany({
        where: { userId: req.user.id },
      });
    }

    res.json({ message: "Notifikacije su isključene za ovaj uređaj." });
  } catch (error) {
    console.error("Greška pri brisanju push pretplate:", error);
    res.status(500).json({ error: "Greška na serveru." });
  }
});

// Slanje testne notifikacije na sopstveni uređaj
router.post("/test", async (req, res) => {
  try {
    const result = await sendPushToUser(req.user.id, {
      title: "Novi radni nalog je izdat.",
      body: "Novi radni nalog je izdat. (Test notifikacija — kliknite za otvaranje aplikacije)",
      url: "http://localhost:5173/",
    });

    res.json({
      message: "Test notifikacija je poslata.",
      ...result,
    });
  } catch (error) {
    console.error("Greška pri slanju test notifikacije:", error);
    res.status(500).json({ error: "Greška pri slanju test notifikacije." });
  }
});

export default router;

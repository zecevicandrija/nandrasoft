import webpush from "web-push";
import { prisma } from "./prisma.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@nandra.rs";

let isConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    isConfigured = true;
  } catch (err) {
    console.error("Greška pri inicijalizaciji VAPID ključeva za Web Push:", err);
  }
} else {
  console.warn("⚠️ VAPID_PUBLIC_KEY ili VAPID_PRIVATE_KEY nisu definisani u .env fajlu.");
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || "";
}

/**
 * Šalje Web Push notifikaciju svim registrovanim uređajima datog korisnika (User.id)
 */
export async function sendPushToUser(userId, payload) {
  if (!isConfigured || !userId) {
    return { sent: 0, failed: 0 };
  }

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (!subscriptions || subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const notificationPayload = JSON.stringify({
      title: payload.title || "Novi radni nalog je izdat.",
      body: payload.body || "Novi radni nalog je izdat.",
      url: payload.url || "http://localhost:5173/",
      orderId: payload.orderId || null,
      orderNumber: payload.orderNumber || null,
      timestamp: Date.now(),
    });

    let sent = 0;
    let failed = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        const pushConfig = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushConfig, notificationPayload, {
            urgency: "high",
            TTL: 86400,
          });
          sent++;
        } catch (err) {
          failed++;
          // Ako je pretplata istekla ili obrisana na uređaju (HTTP 404 ili 410), obriši je iz baze
          if (err.statusCode === 404 || err.statusCode === 410) {
            await prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => {});
          } else {
            console.error(
              `Greška pri slanju Web Push notifikacije za user ${userId}:`,
              err.statusCode || err.message
            );
          }
        }
      })
    );

    return { sent, failed };
  } catch (error) {
    console.error("Greška u sendPushToUser:", error);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Pronalazi User nalog za datog radnika (Worker.id) i šalje mu Web Push notifikaciju
 */
export async function sendWorkOrderPushNotification(workerId, workOrder = null) {
  if (!workerId) return { sent: 0, failed: 0 };

  try {
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { id: true, name: true, userId: true },
    });

    if (!worker) {
      return { sent: 0, failed: 0 };
    }

    let targetUserId = worker.userId;

    // Ako radnik u tabeli Worker još uvek nema upisan userId, pokušaj automatsko povezivanje po imenu
    if (!targetUserId && worker.name) {
      const matchedUser = await prisma.user.findFirst({
        where: {
          name: { equals: worker.name.trim(), mode: "insensitive" },
          isActive: true,
        },
        select: { id: true },
      });

      if (matchedUser) {
        targetUserId = matchedUser.id;
        await prisma.worker
          .update({
            where: { id: worker.id },
            data: { userId: matchedUser.id },
          })
          .catch(() => {});
      }
    }

    if (!targetUserId) {
      return { sent: 0, failed: 0 };
    }

    const detailsParts = [];
    if (workOrder?.orderNumber) detailsParts.push(`Nalog: ${workOrder.orderNumber}`);
    if (workOrder?.machine?.name) detailsParts.push(`Mašina: ${workOrder.machine.name}`);
    if (workOrder?.parcel?.name) detailsParts.push(`Parcela: ${workOrder.parcel.name}`);
    if (workOrder?.workType?.name) detailsParts.push(`Posao: ${workOrder.workType.name}`);

    const bodyText =
      detailsParts.length > 0
        ? `Novi radni nalog je izdat. (${detailsParts.join(" • ")})`
        : "Novi radni nalog je izdat.";

    return await sendPushToUser(targetUserId, {
      title: "Novi radni nalog je izdat.",
      body: bodyText,
      url: "http://localhost:5173/",
      orderId: workOrder?.id || null,
      orderNumber: workOrder?.orderNumber || null,
    });
  } catch (error) {
    console.error("Greška u sendWorkOrderPushNotification:", error);
    return { sent: 0, failed: 0 };
  }
}

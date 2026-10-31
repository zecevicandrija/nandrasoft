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

export function isPushConfigured() { return isConfigured; }

export async function sendPushSubscription(subscription, payload) {
  if (!isConfigured) throw Object.assign(new Error("Web Push is not configured."), { retryable: false });
  const request = webpush.generateRequestDetails({ endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
  JSON.stringify({ ...payload, timestamp: Date.now() }), { urgency: "high", TTL: 86400 });
  // A wall-clock deadline covers DNS, connection setup and response headers,
  // unlike web-push's socket inactivity timeout alone.
  const response = await fetch(request.endpoint, {
    method: request.method, headers: request.headers, body: request.body,
    redirect: "error", signal: AbortSignal.timeout(3000),
  });
  void response.body?.cancel().catch(() => {});
  if (!response.ok) throw Object.assign(new Error("Push provider rejected request."), { statusCode: response.status });
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

    for (let offset = 0; offset < subscriptions.length; offset += 2) {
      await Promise.all(
      subscriptions.slice(offset, offset + 2).map(async (sub) => {
        try {
          await sendPushSubscription(sub, JSON.parse(notificationPayload));
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
    }

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
      select: { userId: true },
    });

    // Recipient identity must come only from the explicit Worker -> User link.
    // Never infer or modify that link while delivering notifications.
    const targetUserId = worker?.userId;
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

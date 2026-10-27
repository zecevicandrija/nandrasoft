const API = '/api';
const SYNC_STORAGE_KEY = 'nandra_push_synced_user';

let syncedUserInSession: string | null = null;
let cachedVapidPublicKey: string | null = null;
let inFlightSyncPromise: Promise<{
  subscribed: boolean;
  permission: NotificationPermission | 'unsupported';
  mode?: 'web-push' | 'direct-sw';
}> | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Prikazuje nativnu sistemsku notifikaciju preko Service Worker-a (ili Notification API-ja)
 */
export async function showLocalSystemNotification(
  title = 'Novi radni nalog je izdat.',
  body = 'Novi radni nalog je izdat.',
  url = 'http://localhost:5173/',
  orderId?: string | null
): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const tag = orderId ? `work-order-${orderId}` : `work-order-${Date.now()}`;

  try {
    if ('serviceWorker' in navigator) {
      const registration =
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.register('/sw.js'));
      if (registration && 'showNotification' in registration) {
        await registration.showNotification(title, {
          body,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag,
          requireInteraction: true,
          data: { url, orderId: orderId || null },
        } as NotificationOptions);
        return true;
      }
    }
  } catch {
    // Fallback na direktan Notification objekat
  }

  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      tag,
    });
    n.onclick = () => {
      window.focus();
      window.location.href = url;
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

async function fetchVapidPublicKey(): Promise<string | null> {
  if (cachedVapidPublicKey) {
    return cachedVapidPublicKey;
  }

  const keyRes = await fetch(`${API}/notifications/vapid-public-key`, {
    credentials: 'include',
  });

  if (!keyRes.ok) return null;
  const { publicKey } = await keyRes.json();
  if (publicKey) {
    cachedVapidPublicKey = publicKey;
  }
  return publicKey || null;
}

/**
 * Registruje Service Worker i pretplaćuje uređaj na Web Push notifikacije.
 */
export async function subscribeUserToPush(userId?: string): Promise<{
  success: boolean;
  permission: NotificationPermission | 'unsupported';
  mode?: 'web-push' | 'direct-sw';
  error?: string;
}> {
  if (!isPushSupported()) {
    return {
      success: false,
      permission: 'unsupported',
      error: 'Pretraživač ne podržava sistemske notifikacije.',
    };
  }

  try {
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    if (permission !== 'granted') {
      return {
        success: false,
        permission,
        error:
          permission === 'denied'
            ? 'Notifikacije su blokirane u podešavanjima pretraživača.'
            : 'Dozvola za notifikacije nije potvrđena.',
      };
    }

    let registration: ServiceWorkerRegistration | null = null;
    if ('serviceWorker' in navigator) {
      registration =
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
    }

    // Pokušaj Web Push (VAPID / FCM) registraciju ako je dostupna
    if (registration && 'PushManager' in window) {
      try {
        const publicKey = await fetchVapidPublicKey();
        if (publicKey) {
          const applicationServerKey = urlBase64ToUint8Array(publicKey);

          let subscription = await registration.pushManager.getSubscription();
          if (!subscription) {
            try {
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey as unknown as BufferSource,
              });
            } catch {
              const oldSub = await registration.pushManager.getSubscription();
              if (oldSub) {
                await oldSub.unsubscribe().catch(() => {});
              }
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey as unknown as BufferSource,
              });
            }
          }

          if (subscription) {
            const subJson = subscription.toJSON();
            const subRes = await fetch(`${API}/notifications/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                endpoint: subJson.endpoint,
                keys: {
                  p256dh: subJson.keys?.p256dh || '',
                  auth: subJson.keys?.auth || '',
                },
              }),
            });

            if (subRes.ok && userId) {
              syncedUserInSession = userId;
              try {
                sessionStorage.setItem(SYNC_STORAGE_KEY, userId);
              } catch {
                // ignore storage errors
              }
            }

            return {
              success: true,
              permission: 'granted',
              mode: 'web-push',
            };
          }
        }
      } catch {
        // Ako pretraživač na računaru blokira Push servis (npr. Brave sa ugašenim Google servisima)
      }
    }

    return {
      success: true,
      permission: 'granted',
      mode: 'direct-sw',
    };
  } catch (err: any) {
    return {
      success: Notification.permission === 'granted',
      permission: Notification.permission,
      mode: 'direct-sw',
      error: err?.message,
    };
  }
}

/**
 * Automatski sinhronizuje pretplatu u pozadini SAMO JEDNOM po sesiji (bez ponovnih poziva pri promeni stranice).
 */
export async function autoSyncPushSubscription(userId?: string): Promise<{
  subscribed: boolean;
  permission: NotificationPermission | 'unsupported';
  mode?: 'web-push' | 'direct-sw';
}> {
  if (!isPushSupported()) {
    return { subscribed: false, permission: 'unsupported' };
  }

  if (Notification.permission !== 'granted') {
    return {
      subscribed: false,
      permission: Notification.permission,
    };
  }

  // Ako smo u ovoj sesiji već sinhronizovali ovog korisnika, ne šaljemo nikakve mrežene zahteve pri promeni stranice!
  let alreadySyncedForUser = false;
  if (userId) {
    if (syncedUserInSession === userId) {
      alreadySyncedForUser = true;
    } else {
      try {
        if (sessionStorage.getItem(SYNC_STORAGE_KEY) === userId) {
          syncedUserInSession = userId;
          alreadySyncedForUser = true;
        }
      } catch {
        // ignore
      }
    }
  }

  if (alreadySyncedForUser) {
    return {
      subscribed: true,
      permission: 'granted',
      mode: 'web-push',
    };
  }

  // Ako je sinhronizacija već u toku (npr. 2 komponente montirane istovremeno), podeli isti Promise
  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  inFlightSyncPromise = (async () => {
    try {
      const res = await subscribeUserToPush(userId);
      return {
        subscribed: res.success,
        permission: 'granted' as const,
        mode: res.mode,
      };
    } catch {
      return {
        subscribed: Notification.permission === 'granted',
        permission: Notification.permission,
      };
    } finally {
      inFlightSyncPromise = null;
    }
  })();

  return inFlightSyncPromise;
}

async function hasActiveWebPushSubscription(): Promise<boolean> {
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        return Boolean(sub);
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Šalje testnu notifikaciju trenutnom korisniku preko Web Push-a
 */
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported() || Notification.permission !== 'granted') {
    return { ok: false, error: 'Dozvola za notifikacije nije uključena.' };
  }

  const hasWebPush = await hasActiveWebPushSubscription();

  try {
    const res = await fetch(`${API}/notifications/test`, {
      method: 'POST',
      credentials: 'include',
    });

    if (res.ok && hasWebPush) {
      return { ok: true };
    }
  } catch {
    // Fallback ispod ako je na desktop pretraživaču bez FCM-a
  }

  const shown = await showLocalSystemNotification(
    'Novi radni nalog je izdat.',
    'Novi radni nalog je izdat. (Test notifikacija — kliknite za otvaranje aplikacije)',
    'http://localhost:5173/',
    `test-${Date.now()}`
  );

  return shown
    ? { ok: true }
    : { ok: false, error: 'Nije moguće prikazati sistemsku notifikaciju.' };
}

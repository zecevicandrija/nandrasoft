/* ========================================================
   NANDRA SOFTWARE - SERVICE WORKER ZA WEB PUSH NOTIFIKACIJE
   ======================================================== */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {
    title: 'Novi radni nalog je izdat.',
    body: 'Novi radni nalog je izdat.',
    url: 'http://localhost:5173/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = {
        ...data,
        ...parsed,
      };
    } catch (e) {
      const text = event.data.text();
      if (text) {
        data.body = text;
      }
    }
  }

  const title = data.title || 'Novi radni nalog je izdat.';
  const options = {
    body: data.body || 'Novi radni nalog je izdat.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    vibrate: [200, 100, 200, 100, 300],
    requireInteraction: true,
    renotify: true,
    tag: data.orderId ? `work-order-${data.orderId}` : `work-order-${Date.now()}`,
    data: {
      url: data.url || 'http://localhost:5173/',
      orderId: data.orderId || null,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Obavesti otvorene tabove da osveže prikaz radnog naloga u realnom vremenu
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((windowClients) => {
          windowClients.forEach((client) => {
            client.postMessage({
              type: 'WORK_ORDER_PUSH_RECEIVED',
              payload: data,
            });
          });
        }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Ako se pristupa lokalno otvara http://localhost:5173/, a na telefonu preko tunela/domena otvara koren aplikacije
  const originUrl = self.location.origin ? `${self.location.origin}/` : 'http://localhost:5173/';
  const targetUrl =
    self.location.hostname === 'localhost' ? 'http://localhost:5173/' : originUrl;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'WORK_ORDER_PUSH_CLICKED' });
            if ('navigate' in client) {
              return client.navigate(targetUrl).then((c) => (c ? c.focus() : null));
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});


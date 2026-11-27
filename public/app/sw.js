// Owner app service worker. It keeps the app's own files so the app opens
// without signal, and shows the owners' phone notifications. It never stores
// anything from /api/: bookings and customer details always come fresh.
const CACHE = 'owner-app-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/app/'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live
  const appFile = url.pathname === '/app/' || url.pathname.startsWith('/_astro/');
  if (!appFile) return;
  // Network first, fall back to the saved copy when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || Response.error())),
  );
});

// A ping from the server: a new lead, a booking, a reply. Show it on the lock screen.
self.addEventListener('push', (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(m.title || 'WeatherBlock owners', {
      body: m.body || '',
      tag: m.tag || undefined,
      renotify: Boolean(m.tag),
      icon: '/icons/mark-white-192.png',
      badge: '/icons/mark-white-192.png',
      data: { url: typeof m.url === 'string' && m.url.startsWith('/app/') ? m.url : '/app/' },
    }),
  );
});

// Tapping it opens that customer in the app: the open app if there is one, or a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/app/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const app = open.find((c) => new URL(c.url).pathname.startsWith('/app/'));
      if (app) {
        await app.focus();
        app.postMessage({ type: 'open', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

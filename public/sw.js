// public/sw.js
/* Improved Service Worker for Helalink push notifications */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      if (event.data) {
        try { data = event.data.json(); }
        catch (err) {
          try { const text = event.data.text(); data = { title: 'Helalink Update', body: text }; }
          catch (e) { console.warn('Push payload parse failed:', err); data = {}; }
        }
      } else {
        console.warn('Push received with no data.');
      }

      const title = data.title || 'Helalink Update';
      const iconUrl = data.icon ? new URL(data.icon, self.registration.scope).href : new URL('countdown-icon.png', self.registration.scope).href;
      const badgeUrl = data.badge ? new URL(data.badge, self.registration.scope).href : new URL('badge-icon.png', self.registration.scope).href;

      const options = {
        body: data.body || 'You have a new notification',
        icon: iconUrl,
        badge: badgeUrl,
        tag: data.tag || 'helalink-notification',
        requireInteraction: !!data.requireInteraction,
        data: { url: data.url || '/', customData: data.customData || {} }
      };

      await self.registration.showNotification(title, options);
    } catch (err) {
      console.error('Error handling push event:', err);
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpenRaw = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  let urlToOpen;
  try { urlToOpen = new URL(urlToOpenRaw, self.registration.scope).href; }
  catch (e) { urlToOpen = new URL('/', self.registration.scope).href; }

  event.waitUntil((async () => {
    try {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        try { if (client.url === urlToOpen && 'focus' in client) return client.focus(); } catch (err) {}
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    } catch (err) { console.warn('notificationclick handler error:', err); }
    return null;
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const existing = await self.registration.pushManager.getSubscription();
      if (existing) {
        try {
          await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(existing)
          });
        } catch (err) {
          console.warn('Failed to refresh subscription on server:', err);
        }
        return;
      }

      const resp = await fetch('/api/vapidPublicKey');
      if (!resp.ok) throw new Error('Failed to fetch VAPID public key during re-subscribe');
      const { publicKey } = await resp.json();
      if (!publicKey) throw new Error('No publicKey returned');

      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const newSub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSub)
      });

      console.log('Re-subscribed after pushsubscriptionchange.');
    } catch (err) {
      console.warn('Error during pushsubscriptionchange re-subscribe:', err);
    }
  })());
});

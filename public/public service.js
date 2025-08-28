// public/service-worker.js
// Service Worker to handle push notifications and clicks.

self.addEventListener('install', (event) => {
  // Immediately take control (optional)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (err) {
      try {
        data = { title: 'Helalink Update', body: event.data.text() };
      } catch (e) {
        console.warn('Push payload could not be parsed:', err);
        data = {};
      }
    }
  } else {
    console.warn('Push received with no data.');
  }

  const title = data.title || 'Helalink Update';
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || `${self.registration.scope}countdown-icon.png`,
    badge: data.badge || `${self.registration.scope}badge-icon.png`,
    tag: data.tag || 'helalink-notification',
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || '/',
      customData: data.customData || {}
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          if (client.url === new URL(urlToOpen, location.origin).href && 'focus' in client) {
            return client.focus();
          }
        } catch (e) {
          console.warn('Error comparing client URLs:', e);
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
      return null;
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Browsers may fire this when subscription expires.
  // Try to resubscribe with VAPID key.
  event.waitUntil((async () => {
    try {
      const registration = await self.registration;
      const response = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: '<YOUR_PUBLIC_VAPID_KEY_HERE>' // TODO: inject your public VAPID key
      });

      // Send new subscription to your server
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: response })
      });

      console.log('Re-subscribed after pushsubscriptionchange');
    } catch (err) {
      console.warn('Error during pushsubscriptionchange re-subscribe', err);
    }
  })());
});

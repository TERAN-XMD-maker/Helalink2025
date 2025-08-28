// public/service-worker.js
// Simple service worker to handle push notifications and clicks.

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
      // If it's not JSON, treat as text
      try { data = { title: 'Notification', body: event.data.text() }; } catch (e) { data = {}; }
    }
  }

  const title = data.title || 'Helalink';
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/countdown-icon.png',
    badge: data.badge || '/badge-icon.png',
    tag: data.tag || 'helalink-notification',
    requireInteraction: data.requireInteraction || false,
    data: {
      url: (data.url || '/'),
      customData: (data.customData || {})
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an open window with the same URL
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url, location.origin);
          if (clientUrl.pathname === new URL(urlToOpen, location.origin).pathname && 'focus' in client) {
            return client.focus();
          }
        } catch (e) {
          // ignore URL parse errors
        }
      }
      // If not found, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
      return null;
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Browsers may fire this when subscription expires.
  // Here we try to resubscribe and (optionally) post to server with new subscription.
  event.waitUntil((async () => {
    try {
      const registration = await self.registration;
      const response = await registration.pushManager.subscribe({ userVisibleOnly: true });
      // You would send the new subscription to your server here.
      // Example (uncomment and set your endpoint if you want automatic re-subscribe):
      // await fetch('/api/subscribe', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ subscription: response })
      // });
    } catch (err) {
      console.warn('Error during pushsubscriptionchange re-subscribe', err);
    }
  })());
});

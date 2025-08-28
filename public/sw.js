// public/sw.js
self.addEventListener('install', function(evt) {
  self.skipWaiting();
});

self.addEventListener('activate', function(evt) {
  evt.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  let payload = { title: 'Helalink', body: 'Reminder', url: '/', tag: 'helalink-reminder' };
  try {
    if (event.data) payload = event.data.json();
  } catch (e) { /* ignore and fallback */ }

  const title = payload.title || 'Helalink';
  const options = {
    body: payload.body || '',
    icon: '/icons/notification-192.png',
    badge: '/icons/badge-72.png',
    data: { url: payload.url || '/' },
    tag: payload.tag || 'helalink-reminder',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

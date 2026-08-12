/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCelLg2pqp1-lYi_IUgsv4FAoH4mN0WsAc',
  authDomain: 'carmagne-instal-2024.firebaseapp.com',
  projectId: 'carmagne-instal-2024',
  storageBucket: 'carmagne-instal-2024.firebasestorage.app',
  messagingSenderId: '318117443518',
  appId: '1:318117443518:web:d9f257212f153373046bef',
  measurementId: 'G-LGCXHWMQQC',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  const notification = payload?.notification || {};
  const title = notification.title || data.title || 'CARMAGNE INSTAL SL';
  const options = {
    body: notification.body || data.body || '',
    icon: data.icon || '/pwa-192.png',
    badge: data.badge || '/pwa-192.png',
    tag: data.tag || 'carmagne-notification',
    renotify: false,
    data: {
      url: data.url || '/',
      ...data,
    },
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification?.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          if ('navigate' in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

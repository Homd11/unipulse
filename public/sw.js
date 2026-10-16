// ============================================================================
// UniPulse Service Worker (public/sw.js)
// Supports iOS 16.4+ Standalone Home Screen Web Push & Action Deep-Linking
// ============================================================================

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for incoming server-side Web Push notifications (2-hour nagging engine)
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {
    title: "⏰ UniPulse Task Reminder",
    body: "You have an active 'On Me' task waiting to be completed!",
    taskId: null,
    tag: "unipulse-reminder",
    url: "/?tab=on-me",
  };

  try {
    const parsed = event.data.json();
    payload = { ...payload, ...parsed };
  } catch {
    payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    tag: payload.tag || `task-${payload.taskId || "general"}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || "/?tab=on-me",
      taskId: payload.taskId,
    },
    actions: [
      {
        action: "open",
        title: "View & Mark Done",
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Handle notification tap on iOS Lock Screen / Notification Center
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/?tab=on-me";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.postMessage({
              type: "NOTIFICATION_CLICKED",
              taskId: event.notification.data?.taskId,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

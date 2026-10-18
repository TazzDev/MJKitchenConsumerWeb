// Admin app service worker: shows order alerts (Web Push, see server/push.ts)
// and opens the order when one is tapped. It does no caching, so the app
// always loads fresh from the server.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let msg = { title: 'MJ Kitchen', body: 'Something needs a look in the admin app.', url: '/admin/', tag: 'mjk' }
  try {
    msg = { ...msg, ...event.data.json() }
  } catch {
    /* keep the fallback text */
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: '/admin/icon-192.png',
      badge: '/admin/badge-96.png',
      tag: msg.tag,
      renotify: true, // a "paid" alert replaces that order's "new order" alert, and still buzzes
      data: { url: msg.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/admin/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const app = open.find((c) => new URL(c.url).pathname.startsWith('/admin/'))
      if (app) {
        await app.focus()
        return app.navigate(url).catch(() => app.postMessage({ type: 'open', url }))
      }
      return self.clients.openWindow(url)
    })(),
  )
})

// The browser replaced the subscription (rare): tell the server about the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription
      const sub = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)))
      if (!sub) return
      await fetch('/api/admin/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mjk-admin' },
        body: JSON.stringify({ subscription: sub.toJSON(), replaces: old?.endpoint }),
      })
    })(),
  )
})

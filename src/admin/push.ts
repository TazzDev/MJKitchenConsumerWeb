// Order alerts on this phone: the service worker (public/admin/sw.js) and the
// browser's push subscription. The server side is server/push.ts.

export type PushSupport =
  | 'ok'
  | 'iphone-needs-home-screen' // iPhone Safari tab: push only works in the home-screen app (iOS 16.4+)
  | 'unsupported'

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (isIos() && !isStandalone()) return 'iphone-needs-home-screen'
  return ok ? 'ok' : 'unsupported'
}

/** Register the service worker (does no caching; only shows alerts). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch((e) => console.error('service worker', e))
  // Tapping an alert while the app is open: the worker asks us to show that order.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string') window.location.href = e.data.url
  })
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  const reg = await navigator.serviceWorker.getRegistration('/admin/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Ask permission and subscribe. Must run from a tap (iPhone requires it). */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(blockedHelp())
  const reg = await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' })
  await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const key = urlBase64ToBytes(publicKey)
  // A subscription made with a different key can't receive our alerts: replace it.
  if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe()
  return withTimeout(
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource }),
    30_000,
    'Couldn’t reach the phone’s alert service. Check your internet and try again.',
  )
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}

export function blockedHelp(): string {
  return isIos()
    ? 'Notifications are blocked. Open iPhone Settings → Notifications → MJ Admin and allow them, then try again.'
    : 'Notifications are blocked for this site. Tap the lock or ⋮ menu → Site settings → Notifications → Allow, then try again.'
}

/** A short name for this phone, so the list shows whose phone gets alerts. */
export function deviceName(): string {
  const ua = navigator.userAgent
  const os = isIos() ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Computer'
  const browser = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : 'Safari'
  return isStandalone() ? `${os} (home-screen app)` : `${os}, ${browser}`
}

function urlBase64ToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

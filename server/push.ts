// Order alerts on admins' phones through standard Web Push: payload encryption
// (RFC 8291) and VAPID signing (RFC 8292) with WebCrypto, sent straight to the
// browser's push service (Google for Chrome/Android, Apple for iPhone). Free, no
// third-party service and no secrets to set: the VAPID key pair is made on first
// use and kept in the settings table. Without migration 0004 alerts are skipped
// and orders still go through.

import { formatDate } from '../src/shared/dates'
import { rupees } from '../src/shared/money'
import { formatWhen, type MealWhen } from '../src/shared/orders'
import { slotLabel } from '../src/shared/quote'
import type { Env } from './db'
import type { CreatedOrder } from './orders'

type Row = Record<string, unknown>

export interface PushSubscriptionJson {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface Vapid {
  publicKey: string // base64url, 65-byte uncompressed P-256 point
  privateKey: string // base64url, 32-byte private scalar
}

/** What the admin app's service worker shows (public/admin/sw.js). */
export interface PushMessage {
  title: string
  body: string
  url: string
  tag: string
}

const enc = new TextEncoder()
const VAPID_SETTING = 'push_vapid'

// ---------------------------------------------------------------------------
// Encoding

export function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of u) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

/** A subscription from the browser, checked: https endpoint, 65-byte key, 16-byte auth secret. */
export function parseSubscription(raw: unknown): PushSubscriptionJson | null {
  if (!raw || typeof raw !== 'object') return null
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !/^https:\/\/[^/]+\//.test(endpoint)) return null
  const p256dh = keys?.p256dh
  const auth = keys?.auth
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 100 || auth.length > 40) return null
  try {
    const pub = b64urlDecode(p256dh)
    if (pub.length !== 65 || pub[0] !== 4 || b64urlDecode(auth).length !== 16) return null
  } catch {
    return null
  }
  return { endpoint, keys: { p256dh, auth } }
}

// ---------------------------------------------------------------------------
// Encryption and signing

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** Encrypt one payload for one subscription: the aes128gcm body of RFC 8291. */
export async function encryptPayload(sub: PushSubscriptionJson, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.keys.p256dh)
  const auth = b64urlDecode(sub.keys.auth)
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256))

  const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(enc.encode(payload), new Uint8Array([2])) // 0x02 marks the last (only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain))

  // Header: salt, record size (4096), key id length, key id (our public key).
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

/** Signs VAPID tokens, one per push service, reused for every phone in one send. */
export class VapidSigner {
  private key?: Promise<CryptoKey>
  private tokens = new Map<string, Promise<string>>()
  constructor(
    private vapid: Vapid,
    private subject: string,
  ) {}

  private signingKey(): Promise<CryptoKey> {
    if (!this.key) {
      const pub = b64urlDecode(this.vapid.publicKey)
      const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: this.vapid.privateKey }
      this.key = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    }
    return this.key
  }

  authorization(endpoint: string, now = Date.now()): Promise<string> {
    const aud = new URL(endpoint).origin
    let t = this.tokens.get(aud)
    if (!t) {
      t = (async () => {
        const head = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
        const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: this.subject })))
        const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await this.signingKey(), enc.encode(`${head}.${claims}`))
        return `vapid t=${head}.${claims}.${b64urlEncode(sig)}, k=${this.vapid.publicKey}`
      })()
      this.tokens.set(aud, t)
    }
    return t
  }
}

export async function pushRequest(sub: PushSubscriptionJson, message: PushMessage, signer: VapidSigner): Promise<Request> {
  const [body, authorization] = await Promise.all([encryptPayload(sub, JSON.stringify(message)), signer.authorization(sub.endpoint)])
  return new Request(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600), // undelivered after a day (phone off) = not worth showing
      Urgency: 'high',
      Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
    },
    body,
  })
}

// ---------------------------------------------------------------------------
// Keys and subscriptions

export async function generateVapid(): Promise<Vapid> {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const pub = (await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer
  const jwk = (await crypto.subtle.exportKey('jwk', k.privateKey)) as JsonWebKey
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! }
}

function readVapid(value: string | undefined | null): Vapid | null {
  if (!value) return null
  try {
    const v = JSON.parse(value) as Vapid
    return v.publicKey && v.privateKey ? v : null
  } catch {
    return null
  }
}

/** The VAPID key pair, made and saved the first time someone turns alerts on. */
export async function vapidKeys(db: D1Database): Promise<Vapid> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(VAPID_SETTING).first<{ value: string }>()
  const existing = readVapid(row?.value)
  if (existing) return existing
  // Two first visits at once: the first insert wins and both read it back.
  await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(VAPID_SETTING, JSON.stringify(await generateVapid())).run()
  const saved = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(VAPID_SETTING).first<{ value: string }>()
  return readVapid(saved?.value)!
}

/** Who the pushes say they're from; push services want a contact. */
function vapidSubject(settings: Record<string, string>, origin: string): string {
  const email = settings.alert_email?.split(',')[0]?.trim()
  return email ? `mailto:${email}` : origin
}

export interface SendResult {
  sent: number
  removed: number
  failed: number
}

/**
 * Send one alert to every phone that turned alerts on (or only to `endpoints`).
 * Phones whose subscription is gone are removed; other failures are logged.
 */
export async function sendPush(
  env: Env,
  settings: Record<string, string>,
  origin: string,
  message: PushMessage,
  endpoints?: string[],
): Promise<SendResult> {
  const vapid = readVapid(settings[VAPID_SETTING])
  const result: SendResult = { sent: 0, removed: 0, failed: 0 }
  if (!vapid) return result // nobody has turned alerts on yet
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all<Row>()
  const subs = results
    .map((r) => ({ endpoint: String(r.endpoint), keys: { p256dh: String(r.p256dh), auth: String(r.auth) } }))
    .filter((s) => !endpoints || endpoints.includes(s.endpoint))
  if (subs.length === 0) return result

  const signer = new VapidSigner(vapid, vapidSubject(settings, origin))
  const gone: string[] = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const res = await fetch(await pushRequest(sub, message, signer))
        if (res.ok) result.sent++
        else if (res.status === 404 || res.status === 410) gone.push(sub.endpoint)
        else {
          result.failed++
          console.error('push failed', res.status, new URL(sub.endpoint).host, await res.text().catch(() => ''))
        }
      } catch (e) {
        result.failed++
        console.error('push failed', new URL(sub.endpoint).host, e)
      }
    }),
  )
  if (gone.length) {
    await env.DB.batch(gone.map((e) => env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(e)))
    result.removed = gone.length
  }
  return result
}

// ---------------------------------------------------------------------------
// The alerts

const orderUrl = (code: string) => `/admin/#/order/${encodeURIComponent(code)}`

export function newOrderPush(o: CreatedOrder): PushMessage {
  const q = o.quote
  const items = q.lines.map((l) => `${l.qty} × ${l.productName}`).join(', ')
  const when = o.mealDate && o.mealSlot ? `${formatDate(o.mealDate)}, ${slotLabel(o.mealSlot)}` : 'Pickles, ship once paid'
  return {
    title: `New order · ${rupees(q.totalPaise)} · ${o.customer.name}`,
    body: `${items}\n${when} · waiting for payment · ${o.code}`,
    url: orderUrl(o.code),
    tag: o.code,
  }
}

export function paidPush(row: Row, utr: string): PushMessage {
  const code = String(row.public_code)
  return {
    title: `Check payment · ${rupees(Number(row.total_paise))} · ${row.customer_name}`,
    body: `${row.customer_name} says they've paid for ${code}. ${utr ? `UPI ref ${utr}.` : 'No reference: match by amount and time.'}`,
    url: orderUrl(code),
    tag: code,
  }
}

export function dateChangedPush(row: Row, from: MealWhen, to: MealWhen, user: string, reason: string): PushMessage {
  const code = String(row.public_code)
  return {
    title: `Date changed · ${code} · ${row.customer_name}`,
    body: `${formatWhen(from)} → ${formatWhen(to)}, by ${user}${reason ? `\n${reason}` : ''}`,
    url: orderUrl(code),
    tag: code,
  }
}

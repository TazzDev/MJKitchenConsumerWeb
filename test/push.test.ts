import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { b64urlEncode, encryptPayload, generateVapid, parseSubscription, pushRequest, VapidSigner, type PushSubscriptionJson } from '../server/push'

/** A browser's side of a subscription: its key pair and auth secret. */
function fakeBrowser(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const sub: PushSubscriptionJson = { endpoint, keys: { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(auth) } }
  return { sub, ecdh, auth: Buffer.from(auth) }
}

/** Decrypt an aes128gcm push body the way the phone does (RFC 8291), with Node's own crypto. */
function decrypt(body: Uint8Array, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const b = Buffer.from(body)
  const salt = b.subarray(0, 16)
  expect(b.readUInt32BE(16)).toBe(4096)
  const asPub = b.subarray(21, 21 + b[20])
  const ct = b.subarray(21 + b[20])
  const secret = ecdh.computeSecret(asPub)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub])
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const d = createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(ct.subarray(ct.length - 16))
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  expect(plain[plain.length - 1]).toBe(2)
  return plain.subarray(0, -1).toString()
}

describe('web push', () => {
  it('encrypts a payload the phone can decrypt', async () => {
    const { sub, ecdh, auth } = fakeBrowser()
    const text = JSON.stringify({ title: 'New order · ₹1,240 · Anu', body: '2 × Chicken Pickle' })
    expect(decrypt(await encryptPayload(sub, text), ecdh, auth)).toBe(text)
  })

  it('signs a VAPID token the push service can verify, one per push service', async () => {
    const vapid = await generateVapid()
    const signer = new VapidSigner(vapid, 'mailto:alerts@example.com')
    const { sub } = fakeBrowser()
    const req = await pushRequest(sub, { title: 't', body: 'b', url: '/admin/', tag: 'MJ-1018-0001' }, signer)
    expect(req.headers.get('Content-Encoding')).toBe('aes128gcm')
    expect(req.headers.get('Topic')).toBe('MJ-1018-0001')
    const [, token, k] = req.headers.get('Authorization')!.match(/^vapid t=([^,]+), k=(.+)$/)!
    expect(k).toBe(vapid.publicKey)
    const [h, p, s] = token.split('.')
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:alerts@example.com')
    const key = await crypto.subtle.importKey('raw', Buffer.from(vapid.publicKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(s, 'base64url'), Buffer.from(`${h}.${p}`))).toBe(true)
    // Same push service → same token; another one gets its own audience.
    expect(await signer.authorization(sub.endpoint)).toBe(await signer.authorization('https://fcm.googleapis.com/fcm/send/other'))
    expect(await signer.authorization('https://web.push.apple.com/xyz')).not.toBe(await signer.authorization(sub.endpoint))
  })

  it('accepts only real subscriptions', () => {
    const { sub } = fakeBrowser()
    expect(parseSubscription(sub)).toEqual(sub)
    expect(parseSubscription({ ...sub, endpoint: 'http://fcm.googleapis.com/x' })).toBeNull()
    expect(parseSubscription({ ...sub, keys: { ...sub.keys, auth: 'AAAA' } })).toBeNull()
    expect(parseSubscription({ ...sub, keys: { ...sub.keys, p256dh: b64urlEncode(new Uint8Array(65)) } })).toBeNull()
    expect(parseSubscription(null)).toBeNull()
  })
})

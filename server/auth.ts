// Admin logins. There is no user database: the people who can sign in, and
// their passwords, live in the ADMIN_USERS Worker secret (never in this public
// repo). See "Admin logins" in docs/cloudflare-setup.md.
//
// ADMIN_USERS is a comma- or newline-separated list of name:password pairs,
// e.g. "Thomson:long-password-1, Mary:another-password". Passwords need at
// least 8 characters and can't contain commas.
//
// A login sets an HttpOnly cookie holding the name, an expiry and an HMAC keyed
// by that person's password, so changing or removing one person's password
// signs out only them, and nothing about sessions is stored.

const COOKIE = 'mjk_admin'
const SESSION_DAYS = 30
export const MIN_PASSWORD = 8

export interface AdminUser {
  name: string
  password: string
}

export function parseUsers(raw: string | undefined): AdminUser[] {
  if (!raw) return []
  const out: AdminUser[] = []
  for (const entry of raw.split(/[,\n]/)) {
    const i = entry.indexOf(':')
    if (i < 0) continue
    const name = entry.slice(0, i).trim()
    const password = entry.slice(i + 1).trim()
    if (name && password.length >= MIN_PASSWORD) out.push({ name, password })
  }
  return out
}

export function findUser(users: AdminUser[], name: string): AdminUser | undefined {
  const n = name.trim().toLowerCase()
  return users.find((u) => u.name.toLowerCase() === n)
}

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

/** Compares hashes so the time taken doesn't reveal how much of a password matched. */
export async function passwordMatches(user: AdminUser, attempt: string): Promise<boolean> {
  return sameBytes(await sha256(user.password), await sha256(attempt))
}

async function sign(user: AdminUser, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', await sha256(`mjk-admin-session|${user.name}|${user.password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))
}

export async function createSession(user: AdminUser, now = new Date()): Promise<{ token: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 86_400
  const payload = b64url(enc.encode(JSON.stringify({ u: user.name, exp: Math.floor(now.getTime() / 1000) + maxAge })))
  return { token: `${payload}.${b64url(await sign(user, payload))}`, maxAge }
}

/** The signed-in admin for a session token, or null if it's missing, expired, forged or their login was removed. */
export async function verifySession(users: AdminUser[], token: string | undefined, now = new Date()): Promise<AdminUser | null> {
  if (!token || token.length > 1000) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  try {
    const { u, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u?: unknown; exp?: unknown }
    if (typeof u !== 'string' || typeof exp !== 'number' || exp * 1000 < now.getTime()) return null
    const user = findUser(users, u)
    if (!user) return null
    return sameBytes(await sign(user, payload), fromB64url(sig)) ? user : null
  } catch {
    return null
  }
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
}

export const clearCookie = `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return v.join('=')
  }
  return undefined
}

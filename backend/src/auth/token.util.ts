import { randomBytes, createHash, timingSafeEqual } from 'crypto'

// Session tokens: a random opaque value goes to the client as a cookie; only
// its SHA-256 hash is ever stored server-side, so a database read alone
// cannot be used to authenticate as a user (same principle as password
// hashing, applied to sessions).
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

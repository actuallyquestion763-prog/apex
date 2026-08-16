import { createHmac, timingSafeEqual } from 'crypto'

// Short-lived, stateless ticket proving "this request already presented a
// correct password for this user" so the /auth/2fa/login-verify step doesn't
// have to trust a bare client-supplied userId. Signed with SESSION_SECRET;
// not a session itself — no cookie is set, no Session row exists, until the
// TOTP code is also verified.
const TTL_MS = 5 * 60_000

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not configured.')
  return secret
}

export function issuePendingLoginToken(userId: string): string {
  const expires = Date.now() + TTL_MS
  const payload = `${userId}.${expires}`
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

export function verifyPendingLoginToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const [userId, expiresStr, sig] = decoded.split('.')
    if (!userId || !expiresStr || !sig) return null
    const payload = `${userId}.${expiresStr}`
    const expected = createHmac('sha256', getSecret()).update(payload).digest('hex')
    const sigBuf = Buffer.from(sig, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
    if (Date.now() > Number(expiresStr)) return null
    return userId
  } catch {
    return null
  }
}

import { createHmac, randomBytes } from 'crypto'

// Minimal RFC 6238 TOTP (30s step, 6 digits, SHA-1 per the standard
// Google-Authenticator-compatible default) implemented with Node's built-in
// crypto only — no extra dependency. This is real MFA verification logic
// (unlike the old frontend, which accepted any 6-digit string); it is not
// wired to force re-authentication on every sensitive admin action yet — see
// backend/README.md for what's enforced today vs. left as follow-up.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(): string {
  // 20 random bytes -> base32, the conventional TOTP secret length
  const bytes = randomBytes(20)
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  let secret = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  }
  return secret
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '')
  let bits = ''
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char)
    if (val === -1) continue
    bits += val.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 1_000_000).padStart(6, '0')
}

export function generateTotpCode(secret: string, timeMs: number = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / 30)
  return hotp(secret, counter)
}

// Accepts the current 30s window and one step before/after to tolerate clock
// drift, matching common authenticator-app behavior.
export function verifyTotpCode(secret: string, code: string, timeMs: number = Date.now()): boolean {
  const counter = Math.floor(timeMs / 1000 / 30)
  for (const delta of [-1, 0, 1]) {
    if (hotp(secret, counter + delta) === code) return true
  }
  return false
}

export function buildOtpAuthUrl(secret: string, email: string, issuer = 'TRUST'): string {
  const label = encodeURIComponent(`${issuer}:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

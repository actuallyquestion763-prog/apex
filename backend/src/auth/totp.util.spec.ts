import { generateTotpSecret, generateTotpCode, verifyTotpCode } from './totp.util'

describe('TOTP (RFC 6238)', () => {
  it('generates a base32 secret', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(secret.length).toBeGreaterThan(16)
  })

  it('verifies a code generated for the same secret and time', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    const code = generateTotpCode(secret, now)
    expect(verifyTotpCode(secret, code, now)).toBe(true)
  })

  it('rejects a code from a different secret', () => {
    const secretA = generateTotpSecret()
    const secretB = generateTotpSecret()
    const now = Date.now()
    const code = generateTotpCode(secretA, now)
    expect(verifyTotpCode(secretB, code, now)).toBe(false)
  })

  it('rejects an arbitrary/guessed code', () => {
    const secret = generateTotpSecret()
    expect(verifyTotpCode(secret, '000000', Date.now())).toBe(false)
  })

  it('tolerates one 30s step of clock drift', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    const code = generateTotpCode(secret, now)
    expect(verifyTotpCode(secret, code, now + 30_000)).toBe(true)
    expect(verifyTotpCode(secret, code, now - 30_000)).toBe(true)
  })

  it('rejects a code far outside the drift window', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    const code = generateTotpCode(secret, now)
    expect(verifyTotpCode(secret, code, now + 5 * 60_000)).toBe(false)
  })
})

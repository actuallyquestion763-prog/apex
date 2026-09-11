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

  // A real authenticator app's on-screen formatting (a middle space, stray
  // whitespace from copy/paste, etc.) must not cause a genuinely correct
  // code to be rejected — see totp.util.ts's verifyTotpCode() comment.
  describe('normalizes non-digit formatting in the submitted code', () => {
    it('accepts a plain, unformatted 6-digit code', () => {
      const secret = generateTotpSecret()
      const now = Date.now()
      const code = generateTotpCode(secret, now)
      expect(code).toMatch(/^\d{6}$/)
      expect(verifyTotpCode(secret, code, now)).toBe(true)
    })

    it('accepts the code with a middle space, e.g. "123 456" (Google Authenticator\'s own display format)', () => {
      const secret = generateTotpSecret()
      const now = Date.now()
      const code = generateTotpCode(secret, now)
      const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
      expect(verifyTotpCode(secret, spaced, now)).toBe(true)
    })

    it('accepts the code with leading and trailing whitespace', () => {
      const secret = generateTotpSecret()
      const now = Date.now()
      const code = generateTotpCode(secret, now)
      expect(verifyTotpCode(secret, `  ${code}  `, now)).toBe(true)
    })

    it('accepts the code with a dash separator, e.g. "123-456" — any non-digit is stripped, not just spaces', () => {
      const secret = generateTotpSecret()
      const now = Date.now()
      const code = generateTotpCode(secret, now)
      const dashed = `${code.slice(0, 3)}-${code.slice(3)}`
      expect(verifyTotpCode(secret, dashed, now)).toBe(true)
    })

    it('still rejects a value that has fewer than 6 digits once normalized', () => {
      const secret = generateTotpSecret()
      const now = Date.now()
      const code = generateTotpCode(secret, now)
      const truncated = code.slice(0, 5) // drop the last digit
      expect(verifyTotpCode(secret, truncated, now)).toBe(false)
    })

    it('still rejects non-numeric input entirely', () => {
      const secret = generateTotpSecret()
      expect(verifyTotpCode(secret, 'abcdef', Date.now())).toBe(false)
    })

    it('still rejects an incorrect 6-digit code, even with formatting applied', () => {
      const secret = generateTotpSecret()
      const now = Date.now()
      const code = generateTotpCode(secret, now)
      // Flip the code to guarantee a wrong value, then format it exactly
      // like a real display would — normalization must not turn a WRONG
      // code into an accepted one.
      const wrongDigits = code
        .split('')
        .map((d) => String((Number(d) + 1) % 10))
        .join('')
      const wrongFormatted = `${wrongDigits.slice(0, 3)} ${wrongDigits.slice(3)}`
      expect(verifyTotpCode(secret, wrongFormatted, now)).toBe(false)
    })
  })
})

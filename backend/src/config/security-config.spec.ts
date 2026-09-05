import { getCookieOptions, resolveCorsOrigin, resolveTrustProxy } from './security-config'

describe('getCookieOptions', () => {
  // Part 31, item 11: secure cookies are correctly configured for production mode.
  it('sets Secure in production', () => {
    expect(getCookieOptions('production').secure).toBe(true)
  })

  it('sets Secure in staging', () => {
    expect(getCookieOptions('staging').secure).toBe(true)
  })

  it('does not set Secure in development (cookies must still work over plain http://localhost)', () => {
    expect(getCookieOptions('development').secure).toBe(false)
  })

  it('always sets httpOnly and sameSite=lax regardless of environment', () => {
    for (const env of ['development', 'test', 'staging', 'production']) {
      const opts = getCookieOptions(env)
      expect(opts.httpOnly).toBe(true)
      expect(opts.sameSite).toBe('lax')
    }
  })
})

describe('resolveCorsOrigin', () => {
  // Part 31, item 12: CORS rejects untrusted origins in production mode —
  // proven here by showing the resolved origin is always the ONE
  // configured value, never a wildcard and never derived from caller input;
  // the `cors` package (wired in main.ts) then only ever allows an exact
  // match against this, so anything else is rejected by the browser.
  it('uses FRONTEND_ORIGIN when set, in any environment', () => {
    expect(resolveCorsOrigin('production', 'https://app.example.com')).toBe('https://app.example.com')
    expect(resolveCorsOrigin('development', 'http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('refuses to silently fall back to localhost in production/staging when FRONTEND_ORIGIN is unset', () => {
    expect(() => resolveCorsOrigin('production', undefined)).toThrow(/FRONTEND_ORIGIN must be set/)
    expect(() => resolveCorsOrigin('staging', undefined)).toThrow(/FRONTEND_ORIGIN must be set/)
  })

  it('falls back to localhost only in development/test when unset', () => {
    expect(resolveCorsOrigin('development', undefined)).toBe('http://localhost:5173')
    expect(resolveCorsOrigin('test', undefined)).toBe('http://localhost:5173')
  })
})

describe('resolveTrustProxy', () => {
  // Rate limiting and any IP-based logic read req.ip, which only reflects
  // the real client behind a reverse proxy if Express is told to trust it.
  it('trusts exactly one proxy hop in production and staging', () => {
    expect(resolveTrustProxy('production')).toBe(1)
    expect(resolveTrustProxy('staging')).toBe(1)
  })

  it('trusts nothing in development and test, where no reverse proxy sits in front', () => {
    expect(resolveTrustProxy('development')).toBe(false)
    expect(resolveTrustProxy('test')).toBe(false)
  })
})

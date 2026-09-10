// Pure, directly-testable security configuration (Phase 5, Part 16/18/31
// items 11-12) — extracted out of main.ts/auth.controller.ts specifically
// so this can be unit-tested without booting a full app. Booting a full app
// under NODE_ENV=production against this environment's only available
// database (a local disposable one) is now correctly IMPOSSIBLE — see
// env.validation.ts, which refuses exactly that combination — so testing
// "what does production mode actually configure" has to happen at this
// level, not via a live end-to-end production boot.

export interface CookieOptions {
  httpOnly: boolean
  sameSite: 'lax' | 'none'
  secure: boolean
  path: '/'
}

export function getCookieOptions(nodeEnv: string): CookieOptions {
  const secure = nodeEnv === 'production' || nodeEnv === 'staging'
  return {
    httpOnly: true,
    // 'none' is required whenever the frontend and backend can be on
    // different origins (e.g. a frontend on static hosting calling this
    // backend's own domain directly, with no same-origin proxy in front) —
    // browsers refuse to send a Lax cookie on a cross-site fetch/XHR at all.
    // 'none' still works perfectly fine for a same-origin deployment too
    // (it's a strict superset of what Lax allows), so this doesn't regress
    // the same-origin-proxy case this app was originally built around. The
    // real CSRF defense here isn't SameSite — it's that CORS only ever
    // allows the one exact configured FRONTEND_ORIGIN (resolveCorsOrigin
    // above), so a credentialed cross-origin request from anywhere else
    // never completes preflight, regardless of this cookie's SameSite value.
    // Browsers require Secure whenever SameSite=None; only used at all when
    // `secure` is already true (production/staging, which are HTTPS-only —
    // see env.validation.ts), so this pairing is always valid.
    sameSite: secure ? 'none' : 'lax',
    // Secure-flagged cookies are only ever sent over HTTPS — required in
    // production (env.validation.ts already requires FRONTEND_ORIGIN to be
    // https:// there), and deliberately off in development so cookies still
    // work over plain http://localhost.
    secure,
    path: '/',
  }
}

// A single fixed origin string (never a wildcard, never a function that
// reflects whatever Origin header the caller sent) — the `cors` package
// only ever allows exact matches against this value; every other Origin
// gets no CORS headers, which the browser then blocks. Development allows
// a localhost fallback for convenience; production/staging require
// FRONTEND_ORIGIN to be explicitly set (already enforced by
// env.validation.ts as a hard boot-time failure, not just here).
export function resolveCorsOrigin(nodeEnv: string, frontendOrigin: string | undefined): string {
  if (frontendOrigin) return frontendOrigin
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error(`FRONTEND_ORIGIN must be set in ${nodeEnv} — refusing to fall back to a localhost default.`)
  }
  return 'http://localhost:5173'
}

// Express's req.ip / X-Forwarded-For parsing is only trustworthy behind a
// reverse proxy that itself sets those headers correctly (a load balancer,
// nginx, Cloudflare, etc.) — without this, req.ip resolves to the proxy's
// own address for every request, which quietly breaks per-IP rate limiting
// (ThrottlerModule, see rate-limits.ts) by collapsing all real clients onto
// one bucket. `1` trusts exactly one hop (the immediate reverse proxy) —
// the standard, safest value for a single-proxy production topology; a
// deployment with an additional layer in front (e.g. Cloudflare -> nginx)
// would need this raised accordingly. Left at Express's own default
// (`false`, trust nothing) in development/test, where no reverse proxy
// exists and honoring a client-supplied X-Forwarded-For would let a local
// caller spoof its own IP for no benefit.
export function resolveTrustProxy(nodeEnv: string): number | boolean {
  return nodeEnv === 'production' || nodeEnv === 'staging' ? 1 : false
}

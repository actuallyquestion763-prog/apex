// Named, reusable @Throttle() presets (Phase 5, Part 15) — stricter than the
// app-wide default (120 req/min/IP, see app.module.ts) for the specific
// endpoint classes the spec calls out: auth/2FA, and creating a financial or
// support record. Ordinary reads (including the public CMS GET endpoints)
// are deliberately left on the global default only — over-throttling GET
// requests would make the app unusable, which Part 15 explicitly warns
// against.
//
// Limits are raised under NODE_ENV=test for the same reason the global
// config already is (see app.module.ts): a full e2e run legitimately logs
// in and creates records far more than 10-30 times per minute from one IP,
// and that's test traffic, not the abuse pattern these limits target.
const isTest = process.env.NODE_ENV === 'test'

function preset(limit: number) {
  return { default: { limit: isTest ? 10_000 : limit, ttl: 60_000 } }
}

// Login/register/2FA — the classic credential-stuffing and OTP-brute-force
// surface. Deliberately not so tight that a real user mistyping a password
// a few times gets locked out.
export const AUTH_THROTTLE = preset(10)
export const REGISTER_THROTTLE = preset(5)

// Creating a financial record (not reading them) — deposits/withdrawals/orders.
export const FINANCIAL_CREATE_THROTTLE = preset(15)

// Creating a support ticket or uploading media — cheap to spam, expensive to
// moderate/store.
export const SUPPORT_CREATE_THROTTLE = preset(10)
export const MEDIA_UPLOAD_THROTTLE = preset(10)

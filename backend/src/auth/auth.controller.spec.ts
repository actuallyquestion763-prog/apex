import 'reflect-metadata'
import { AuthController } from './auth.controller'
import { AUTH_THROTTLE, FORGOT_PASSWORD_THROTTLE } from '../common/rate-limits'

// The e2e suite (test/forgot-password.e2e-spec.ts) cannot exercise real
// throttling — NODE_ENV=test deliberately raises every preset's limit to
// 10,000/min (see rate-limits.ts) so the rest of that suite's own repeated
// requests don't trip it. This checks, directly and statically, that the
// @Throttle(...) decorator is actually present on both new endpoints with
// the intended preset — i.e. that rate limiting is really wired up, not
// just present in an e2e test that happens to never hit it.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT'
const THROTTLER_TTL = 'THROTTLER:TTL'

describe('AuthController — forgot/reset password rate limiting', () => {
  it('POST /auth/forgot-password is throttled with FORGOT_PASSWORD_THROTTLE', () => {
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', AuthController.prototype.forgotPassword)
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', AuthController.prototype.forgotPassword)
    expect(limit).toBe(FORGOT_PASSWORD_THROTTLE.default.limit)
    expect(ttl).toBe(FORGOT_PASSWORD_THROTTLE.default.ttl)
  })

  it('POST /auth/reset-password is throttled with AUTH_THROTTLE', () => {
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', AuthController.prototype.resetPassword)
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', AuthController.prototype.resetPassword)
    expect(limit).toBe(AUTH_THROTTLE.default.limit)
    expect(ttl).toBe(AUTH_THROTTLE.default.ttl)
  })
})

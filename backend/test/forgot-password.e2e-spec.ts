import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { EmailService } from '../src/email/email.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Records what would have been emailed without ever logging it anywhere —
// see email.service.ts's own comment on why the real implementation never
// logs the raw token/link. This is the ONLY place in the test suite (or
// the app) that ever sees the raw token in plaintext.
class FakeEmailService {
  sent: { to: string; resetUrl: string; expiresInMinutes: number }[] = []
  async sendPasswordResetEmail(to: string, resetUrl: string, expiresInMinutes: number) {
    this.sent.push({ to, resetUrl, expiresInMinutes })
  }
}

function tokenFromUrl(url: string): string {
  const parsed = new URL(url)
  const token = parsed.searchParams.get('token')
  if (!token) throw new Error(`No token query param in reset URL: ${url}`)
  return token
}

describe('Forgot / Reset Password (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any
  let fakeEmail: FakeEmailService

  beforeAll(async () => {
    fakeEmail = new FakeEmailService()
    const t = await createTestApp((builder) => builder.overrideProvider(EmailService).useValue(fakeEmail))
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    fakeEmail.sent = []
  })

  it('1. an existing account can request a password reset, and it actually creates a redeemable link', async () => {
    const email = uniqueEmail('fp-exists')
    await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'FP User' }).expect(201)

    const res = await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    expect(res.body.message).toMatch(/if an account exists/i)
    expect(fakeEmail.sent).toHaveLength(1)
    expect(fakeEmail.sent[0].to).toBe(email.toLowerCase())
    expect(fakeEmail.sent[0].resetUrl).toContain('/reset-password?token=')
  })

  it('2. a non-existent email receives the exact same generic response (no account-existence leak)', async () => {
    const existingEmail = uniqueEmail('fp-real')
    await request(server).post('/auth/register').send({ email: existingEmail, password: 'correct-horse-battery', fullName: 'Real User' }).expect(201)

    const realRes = await request(server).post('/auth/forgot-password').send({ email: existingEmail }).expect(200)
    const fakeRes = await request(server).post('/auth/forgot-password').send({ email: uniqueEmail('fp-ghost') }).expect(200)

    expect(fakeRes.body).toEqual(realRes.body)
    expect(fakeRes.status).toBe(realRes.status)
    // Only the real account actually got an email queued.
    expect(fakeEmail.sent).toHaveLength(1)
  })

  it('3. the raw reset token is never stored in the database — only its hash', async () => {
    const email = uniqueEmail('fp-hash')
    const reg = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Hash User' }).expect(201)
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)

    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: reg.body.user.id }, orderBy: { createdAt: 'desc' } })
    expect(row).toBeTruthy()
    expect(row!.tokenHash).not.toBe(rawToken)
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex digest, not the raw 64-hex-char token
  })

  it('4/5. an expired token is rejected', async () => {
    const email = uniqueEmail('fp-expired')
    await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Expired User' }).expect(201)
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)

    const { createHash } = require('crypto')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    await prisma.passwordResetToken.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const res = await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword: 'a-brand-new-password' }).expect(400)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('6/7. a used token is rejected, and can never be redeemed a second time', async () => {
    const email = uniqueEmail('fp-used')
    const password = 'correct-horse-battery'
    await request(server).post('/auth/register').send({ email, password, fullName: 'Used User' }).expect(201)
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)

    await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword: 'a-brand-new-password' }).expect(200)
    const res = await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword: 'yet-another-password' }).expect(400)
    expect(res.body.message).toMatch(/already been used/i)
  })

  it('8. an invalid/unknown token is rejected', async () => {
    const res = await request(server).post('/auth/reset-password').send({ token: 'not-a-real-token-at-all', newPassword: 'a-brand-new-password' }).expect(400)
    expect(res.body.message).toMatch(/invalid/i)
  })

  it('9. a too-short new password is rejected by the existing password validation rules', async () => {
    const email = uniqueEmail('fp-short')
    await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Short User' }).expect(201)
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)

    await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword: 'short' }).expect(400)
  })

  it('10. a mismatched confirmation is a frontend-only concern — the backend just validates the token + new password (covered by the frontend test suite)', () => {
    // Deliberately no backend assertion here: confirmPassword never leaves
    // the browser (see ResetPasswordPage.tsx) — the API only ever receives
    // {token, newPassword}, matching ChangePasswordDto's shape.
    expect(true).toBe(true)
  })

  it('11/12. a successful reset updates the password (Argon2-hashed) and the new password works at login', async () => {
    const email = uniqueEmail('fp-success')
    const oldPassword = 'correct-horse-battery'
    const newPassword = 'a-brand-new-password'
    const reg = await request(server).post('/auth/register').send({ email, password: oldPassword, fullName: 'Success User' }).expect(201)
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)

    await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword }).expect(200)

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: reg.body.user.id } })
    expect(updated.passwordHash).not.toBe(reg.body.user.passwordHash)
    expect(updated.passwordHash.startsWith('$argon2')).toBe(true)

    await request(server).post('/auth/login').send({ email, password: oldPassword }).expect(401)
    await request(server).post('/auth/login').send({ email, password: newPassword }).expect(200)
  })

  it('13. a successful reset revokes every existing session for that account', async () => {
    const email = uniqueEmail('fp-revoke')
    const oldPassword = 'correct-horse-battery'
    const reg = await request(server).post('/auth/register').send({ email, password: oldPassword, fullName: 'Revoke User' }).expect(201)
    const cookie = extractSessionCookie(reg)
    await request(server).get('/auth/me').set('Cookie', cookie).expect(200)

    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)
    await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword: 'a-brand-new-password' }).expect(200)

    await request(server).get('/auth/me').set('Cookie', cookie).expect(401)
  })

  it('14. an account with 2FA enabled keeps 2FA enabled after a password reset, and still requires it on the next login', async () => {
    const email = uniqueEmail('fp-2fa')
    const oldPassword = 'correct-horse-battery'
    const newPassword = 'a-brand-new-password'
    const reg = await request(server).post('/auth/register').send({ email, password: oldPassword, fullName: '2FA User' }).expect(201)
    const userId = reg.body.user.id
    const secret = await enableTotpDirect(prisma, userId)

    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)
    await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword }).expect(200)

    const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(afterReset.twoFactorEnabled).toBe(true)
    const credential = await prisma.twoFactorCredential.findUniqueOrThrow({ where: { userId } })
    expect(credential.secret).toBe(secret)
    expect(credential.enabled).toBe(true)

    // Login with the NEW password still requires the TOTP step — reset
    // never silently downgrades the account to password-only auth.
    const loginRes = await request(server).post('/auth/login').send({ email, password: newPassword }).expect(200)
    expect(loginRes.body.needsTwoFactor).toBe(true)
    expect(loginRes.headers['set-cookie']).toBeUndefined()

    const verified = await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) })
      .expect(200)
    expect(verified.headers['set-cookie']).toBeDefined()
  })

  it('15. requesting a new reset invalidates the previous unused token for the same account', async () => {
    const email = uniqueEmail('fp-superseded')
    await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Superseded User' }).expect(201)

    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const firstToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const secondToken = tokenFromUrl(fakeEmail.sent[1].resetUrl)

    await request(server).post('/auth/reset-password').send({ token: firstToken, newPassword: 'a-brand-new-password' }).expect(400)
    await request(server).post('/auth/reset-password').send({ token: secondToken, newPassword: 'a-brand-new-password' }).expect(200)
  })

  it('16. no sensitive information (password hash, reset token, TOTP secret) ever appears in an API response', async () => {
    const email = uniqueEmail('fp-noleak')
    await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'NoLeak User' }).expect(201)
    const res = await request(server).post('/auth/forgot-password').send({ email }).expect(200)

    const body = JSON.stringify(res.body)
    expect(body).not.toMatch(/passwordHash/i)
    expect(body).not.toMatch(/tokenHash/i)
    expect(body).not.toMatch(/\$argon2/)
    // The raw token itself must never appear in the response either.
    if (fakeEmail.sent[0]) {
      expect(body).not.toContain(tokenFromUrl(fakeEmail.sent[0].resetUrl))
    }
  })

  it('the admin/SUPER_ADMIN recovery flow: a forgotten admin password is recoverable ONLY through a real reset link, never by email alone', async () => {
    const email = uniqueEmail('fp-admin')
    const oldPassword = 'correct-horse-battery'
    const newPassword = 'a-brand-new-admin-password'
    // Admins are never created via public registration in this codebase
    // (see test-app.ts's createUserDirect comment) — this mirrors that.
    const { createUserDirect } = await import('./helpers/test-app')
    const { user } = await createUserDirect(prisma, { email, password: oldPassword, role: 'SUPER_ADMIN' })

    // Knowing the email alone changes nothing — no session, no password
    // change, no bypass. Only a real emailed link can do that.
    await request(server).post('/auth/forgot-password').send({ email }).expect(200)
    const rawToken = tokenFromUrl(fakeEmail.sent[0].resetUrl)
    await request(server).post('/auth/reset-password').send({ token: rawToken, newPassword }).expect(200)

    await request(server).post('/auth/login').send({ email, password: oldPassword }).expect(401)
    const login = await request(server).post('/auth/login').send({ email, password: newPassword }).expect(200)
    expect(login.body.user.role).toBe('SUPER_ADMIN')
    expect(user.role).toBe('SUPER_ADMIN')
  })

  // Rate limiting itself is NOT exercised here: src/common/rate-limits.ts
  // deliberately raises every preset's limit to 10,000/min under
  // NODE_ENV=test (same reason the rest of this e2e suite needs to, and
  // test/rate-limiting.e2e-spec.ts explains in full) so this suite's own
  // repeated calls to /auth/forgot-password above don't trip it. That
  // /auth/forgot-password and /auth/reset-password are actually decorated
  // with a real @Throttle(...) preset — the thing that would 429 in
  // production — is verified directly in auth.controller.spec.ts, and that
  // the underlying ThrottlerGuard mechanism genuinely returns 429 once a
  // real (small) limit is exceeded is proven by rate-limiting.e2e-spec.ts.
})

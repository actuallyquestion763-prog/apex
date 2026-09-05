import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

describe('Auth + Sessions (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  it('registers a new user, sets an httpOnly session cookie, and never returns the password hash', async () => {
    const email = uniqueEmail('register')
    const res = await request(server)
      .post('/auth/register')
      .send({ email, password: 'correct-horse-battery', fullName: 'Reg User' })
      .expect(201)

    expect(res.body.user.email).toBe(email.toLowerCase())
    expect(res.body.user.passwordHash).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/)

    const setCookie = res.headers['set-cookie'][0]
    expect(setCookie).toMatch(/trust_session=/)
    expect(setCookie.toLowerCase()).toMatch(/httponly/)
    expect(setCookie.toLowerCase()).toMatch(/samesite=lax/)
  })

  it('rejects duplicate email registration', async () => {
    const email = uniqueEmail('dup')
    await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'A' }).expect(201)
    await request(server).post('/auth/register').send({ email, password: 'another-password', fullName: 'B' }).expect(409)
  })

  it('logs in with correct credentials and rejects incorrect ones', async () => {
    const email = uniqueEmail('login')
    const password = 'correct-horse-battery'
    await request(server).post('/auth/register').send({ email, password, fullName: 'Login User' }).expect(201)

    await request(server).post('/auth/login').send({ email, password: 'wrong-password' }).expect(401)
    const ok = await request(server).post('/auth/login').send({ email, password }).expect(200)
    expect(ok.body.user.email).toBe(email.toLowerCase())
  })

  it('rejects /auth/me without a session cookie, accepts it with one', async () => {
    await request(server).get('/auth/me').expect(401)

    const email = uniqueEmail('me')
    const reg = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Me User' }).expect(201)
    const cookie = extractSessionCookie(reg)

    const me = await request(server).get('/auth/me').set('Cookie', cookie).expect(200)
    expect(me.body.user.email).toBe(email.toLowerCase())
  })

  it('logout revokes the session — the same cookie is rejected afterwards', async () => {
    const email = uniqueEmail('logout')
    const reg = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Logout User' }).expect(201)
    const cookie = extractSessionCookie(reg)

    await request(server).get('/auth/me').set('Cookie', cookie).expect(200)
    await request(server).post('/auth/logout').set('Cookie', cookie).expect(204)
    await request(server).get('/auth/me').set('Cookie', cookie).expect(401)
  })

  it('rejects an expired session', async () => {
    const email = uniqueEmail('expired')
    const reg = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Expired User' }).expect(201)
    const cookie = extractSessionCookie(reg)

    const token = cookie.split('=')[1]
    const { createHash } = require('crypto')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await prisma.session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await request(server).get('/auth/me').set('Cookie', cookie).expect(401)
  })

  it('rejects a revoked session even before its natural expiry', async () => {
    const email = uniqueEmail('revoked')
    const reg = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Revoked User' }).expect(201)
    const cookie = extractSessionCookie(reg)

    const token = cookie.split('=')[1]
    const { createHash } = require('crypto')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await prisma.session.update({ where: { tokenHash }, data: { revokedAt: new Date() } })

    await request(server).get('/auth/me').set('Cookie', cookie).expect(401)
  })

  it('full real TOTP 2FA login flow: password alone is not enough once 2FA is enabled', async () => {
    const email = uniqueEmail('twofa')
    const password = 'correct-horse-battery'
    const reg = await request(server).post('/auth/register').send({ email, password, fullName: '2FA User' }).expect(201)
    const userId = reg.body.user.id

    const secret = await enableTotpDirect(prisma, userId)

    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    expect(loginRes.body.needsTwoFactor).toBe(true)
    expect(loginRes.body.pendingToken).toBeDefined()
    expect(loginRes.headers['set-cookie']).toBeUndefined() // no session yet

    await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: '000000' })
      .expect(401) // wrong code

    const verified = await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) })
      .expect(200)
    expect(verified.headers['set-cookie']).toBeDefined()
  })

  it('rejects /auth/change-password with the wrong current password, and leaves the old password usable', async () => {
    const email = uniqueEmail('pwbad')
    const password = 'correct-horse-battery'
    const reg = await request(server).post('/auth/register').send({ email, password, fullName: 'PW Bad' }).expect(201)
    const cookie = extractSessionCookie(reg)

    await request(server).post('/auth/change-password').set('Cookie', cookie).send({ currentPassword: 'totally-wrong', newPassword: 'a-brand-new-password' }).expect(401)

    // old password still works — nothing was changed by the rejected attempt
    await request(server).post('/auth/login').send({ email, password }).expect(200)
  })

  it('/auth/change-password with the correct current password rotates the password and revokes every OTHER session, but not the current one', async () => {
    const email = uniqueEmail('pwok')
    const password = 'correct-horse-battery'
    const newPassword = 'a-brand-new-password'
    const reg = await request(server).post('/auth/register').send({ email, password, fullName: 'PW OK' }).expect(201)
    const primaryCookie = extractSessionCookie(reg)

    // a second, independent session for the same user — simulates a second device
    const secondLogin = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const secondCookie = extractSessionCookie(secondLogin)
    await request(server).get('/auth/me').set('Cookie', secondCookie).expect(200)

    await request(server).post('/auth/change-password').set('Cookie', primaryCookie).send({ currentPassword: password, newPassword }).expect(200)

    // the session that performed the change stays valid...
    await request(server).get('/auth/me').set('Cookie', primaryCookie).expect(200)
    // ...but the OTHER session is revoked
    await request(server).get('/auth/me').set('Cookie', secondCookie).expect(401)

    // the old password no longer works, the new one does
    await request(server).post('/auth/login').send({ email, password }).expect(401)
    await request(server).post('/auth/login').send({ email, password: newPassword }).expect(200)
  })

  it('rejects a too-short new password (400) without touching the existing password', async () => {
    const email = uniqueEmail('pwshort')
    const password = 'correct-horse-battery'
    const reg = await request(server).post('/auth/register').send({ email, password, fullName: 'PW Short' }).expect(201)
    const cookie = extractSessionCookie(reg)

    await request(server).post('/auth/change-password').set('Cookie', cookie).send({ currentPassword: password, newPassword: 'short' }).expect(400)
    await request(server).post('/auth/login').send({ email, password }).expect(200)
  })

  it('rejects /auth/change-password without a session cookie', async () => {
    await request(server).post('/auth/change-password').send({ currentPassword: 'x', newPassword: 'a-brand-new-password' }).expect(401)
  })
})

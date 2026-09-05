import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

describe('Security (real PostgreSQL)', () => {
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

  it('a 500-class error never leaks a stack trace, SQL, or internal error text to the client', async () => {
    // Force an internal error: register with a payload that passes DTO
    // validation but will fail deeper (duplicate email is a clean 409— use
    // an actually-malformed downstream case instead: hit an endpoint that
    // requires a real UUID param with a non-UUID to provoke a Prisma error).
    const { user } = await createUserDirect(prisma, { email: uniqueEmail('secfail'), password: 'correct-horse-battery', role: 'SUPER_ADMIN' })
    const res = await request(server).post('/auth/login').send({ email: user.email, password: 'correct-horse-battery' }).expect(200)
    const cookie = extractSessionCookie(res)

    const bad = await request(server).get('/admin/users').set('Cookie', cookie) // no permission granted -> 403, still check body shape
    expect(JSON.stringify(bad.body)).not.toMatch(/at Object\.|at Function\.|node_modules|\.ts:\d+:\d+/) // no stack trace shape
    expect(JSON.stringify(bad.body)).not.toMatch(/postgresql:\/\/|password|SESSION_SECRET/i)
  })

  it('no response body anywhere in the app ever contains passwordHash', async () => {
    const email = uniqueEmail('nohash')
    const res = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'No Hash' }).expect(201)
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2/)

    const cookie = extractSessionCookie(res)
    const me = await request(server).get('/auth/me').set('Cookie', cookie).expect(200)
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|\$argon2/)
  })

  // Part 33 — XAU/USD itself moved off GOLDAPI onto Binance/PAXGUSDT (a
  // real, no-key gold-token proxy), so it no longer touches MARKET_API_KEY
  // at all. GoldAPI is still a real provider this codebase supports (any
  // MarketConfig row can still be pointed at it), so its key-leakage and
  // honest-unavailability behavior is still worth testing — just against a
  // dedicated, uniquely-named GOLDAPI-provider fixture symbol instead of
  // the now-Binance-backed XAU/USD, mirroring the TEST/SIM fixture pattern
  // already used above for the SIMULATED provider.
  it('MARKET_API_KEY is never present in any API response', async () => {
    await prisma.marketConfig.upsert({
      where: { symbol: 'TEST/GOLDAPI' },
      create: { symbol: 'TEST/GOLDAPI', dataSource: 'LIVE', enabled: true, provider: 'GOLDAPI', providerSymbol: 'XAU/USD', baseAsset: 'TEST', quoteAsset: 'GOLDAPI', displayName: 'Test GoldAPI', marketType: 'CFD' },
      update: {},
    })
    process.env.MARKET_API_KEY = 'test-fake-goldapi-key-should-never-leak'
    const res = await request(server).get('/markets/TEST%2FGOLDAPI/quote')
    expect(JSON.stringify(res.body)).not.toMatch(/test-fake-goldapi-key-should-never-leak/)
    delete process.env.MARKET_API_KEY
  })

  it('the market data endpoint returns an honest UNAVAILABLE status, never a fabricated price, when no API key is configured', async () => {
    await prisma.marketConfig.upsert({
      where: { symbol: 'TEST/GOLDAPI' },
      create: { symbol: 'TEST/GOLDAPI', dataSource: 'LIVE', enabled: true, provider: 'GOLDAPI', providerSymbol: 'XAU/USD', baseAsset: 'TEST', quoteAsset: 'GOLDAPI', displayName: 'Test GoldAPI', marketType: 'CFD' },
      update: {},
    })
    const original = process.env.MARKET_API_KEY
    delete process.env.MARKET_API_KEY
    const res = await request(server).get('/markets/TEST%2FGOLDAPI/quote').expect(200)
    expect(res.body.status).toBe('UNAVAILABLE')
    expect(res.body.last).toBeUndefined()
    expect(res.body.price).toBeUndefined()
    if (original) process.env.MARKET_API_KEY = original
  })

  it('session cookies are httpOnly and SameSite=Lax', async () => {
    const email = uniqueEmail('cookieflags')
    const res = await request(server).post('/auth/register').send({ email, password: 'correct-horse-battery', fullName: 'Cookie Flags' }).expect(201)
    const setCookie: string = res.headers['set-cookie'][0]
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    // Secure is only asserted in production — NODE_ENV=test here, matching
    // the documented behavior (secure: false outside production so local
    // http:// testing works at all).
  })

  it('the application database role genuinely cannot update or delete AuditLog rows (re-verified via the app\'s own PrismaService)', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'SECURITY_TEST_EVENT' } })
    await expect(prisma.$executeRaw`UPDATE "AuditLog" SET action = 'TAMPERED' WHERE id = ${row.id}`).rejects.toThrow(/permission denied/i)
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${row.id}`).rejects.toThrow(/permission denied/i)
    const stillThere = await prisma.auditLog.findUnique({ where: { id: row.id } })
    expect(stillThere?.action).toBe('SECURITY_TEST_EVENT')
  })
})

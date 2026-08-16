import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

describe('Platform and market kill switches — server-enforced (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any
  let superCookie: string
  let superSecret: string
  let superPassword: string

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()

    const email = uniqueEmail('platformsuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superSecret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)
  })

  afterAll(async () => {
    // Always restore settings to enabled so later test files aren't affected.
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, depositsEnabled: true, withdrawalsEnabled: true, registrationsEnabled: true, reason: 'restore after tests', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
    await app.close()
  })

  async function newUserCookie(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  it('pausing trading via the admin API actually makes /orders reject new orders — not just a frontend flag', async () => {
    await prisma.marketConfig.upsert({
      where: { symbol: 'KILLSWITCH/TEST' },
      create: { symbol: 'KILLSWITCH/TEST', dataSource: 'SIMULATED', tradingEnabled: true },
      update: { tradingEnabled: true },
    })
    const { cookie } = await newUserCookie('tradepause')

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'test pause', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'KILLSWITCH/TEST', side: 'BUY', quantity: '10' })
    expect(res.status).toBe(503)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'test resume', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const res2 = await request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'KILLSWITCH/TEST', side: 'BUY', quantity: '10' })
    expect(res2.status).not.toBe(503)
  })

  it('pausing deposits actually rejects POST /deposits', async () => {
    const { cookie } = await newUserCookie('deppause')
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ depositsEnabled: false, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    await request(server).post('/deposits').set('Cookie', cookie).send({ amount: '100', method: 'test' }).expect(503)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ depositsEnabled: true, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  it('pausing withdrawals actually rejects POST /withdrawals', async () => {
    const { cookie } = await newUserCookie('wdpause')
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ withdrawalsEnabled: false, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    await request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '10', destination: 'x' }).expect(503)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ withdrawalsEnabled: true, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  it('pausing registrations actually rejects POST /auth/register', async () => {
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ registrationsEnabled: false, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    await request(server).post('/auth/register').send({ email: uniqueEmail('blocked'), password: 'correct-horse-battery', fullName: 'Blocked' }).expect(503)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ registrationsEnabled: true, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  it('market data source is correctly configured: XAU/USD LIVE, BTC/USDT and ETH/USDT SIMULATED', async () => {
    await prisma.marketConfig.upsert({ where: { symbol: 'XAU/USD' }, create: { symbol: 'XAU/USD', dataSource: 'LIVE', tradingEnabled: false }, update: { dataSource: 'LIVE' } })
    await prisma.marketConfig.upsert({ where: { symbol: 'BTC/USDT' }, create: { symbol: 'BTC/USDT', dataSource: 'SIMULATED', tradingEnabled: false }, update: { dataSource: 'SIMULATED' } })
    await prisma.marketConfig.upsert({ where: { symbol: 'ETH/USDT' }, create: { symbol: 'ETH/USDT', dataSource: 'SIMULATED', tradingEnabled: false }, update: { dataSource: 'SIMULATED' } })

    const res = await request(server).get('/markets/config').expect(200)
    const bySymbol = Object.fromEntries(res.body.map((m: any) => [m.symbol, m]))
    expect(bySymbol['XAU/USD'].dataSource).toBe('LIVE')
    expect(bySymbol['BTC/USDT'].dataSource).toBe('SIMULATED')
    expect(bySymbol['ETH/USDT'].dataSource).toBe('SIMULATED')
  })

  it('a market with trading disabled rejects order attempts directly through the API', async () => {
    await prisma.marketConfig.upsert({
      where: { symbol: 'DISABLED/TEST' },
      create: { symbol: 'DISABLED/TEST', dataSource: 'SIMULATED', tradingEnabled: false },
      update: { tradingEnabled: false },
    })
    const { cookie } = await newUserCookie('disabledmarket')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'DISABLED/TEST', side: 'BUY', quantity: '10' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toMatch(/not enabled/i)
  })

  it('a never-configured symbol defaults to SIMULATED + trading disabled (fails closed, not open)', async () => {
    const symbol = `NEVERSEEN/${Date.now()}`
    const { cookie } = await newUserCookie('neverseen')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '10' }).expect(201)
    expect(res.body.status).toBe('REJECTED')

    const config = await prisma.marketConfig.findUnique({ where: { symbol } })
    expect(config?.dataSource).toBe('SIMULATED')
    expect(config?.tradingEnabled).toBe(false)
  })
})

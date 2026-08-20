import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode, grantPermissionDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import type { PrismaService } from '../src/prisma/prisma.service'

// Checkpoint I.1, Part 4 — admin visibility into orders TRUST has already
// flagged unresolved (status SUBMITTED — the ambiguous-outcome marker set
// only by handleSubmissionFailure/flagUnresolved in orders.service.ts, see
// admin.service.ts's listUnresolvedOrders for why this status is the
// correct, and only, signal rather than a new enum value).
describe('Admin unresolved-order visibility (real PostgreSQL, FakeExecutionProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let fake: FakeExecutionProvider
  let server: any
  let superCookie: string

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    fake = app.get(FakeExecutionProvider)

    const email = uniqueEmail('unresolvedsuper')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'SUPER_ADMIN' })
    const secret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'test fixture asset grant',
      idempotencyKey: `unresolved-fixture-grant-${userId}-${currency}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
  }

  it('a plain USER cannot list unresolved orders; an ADMIN without trading.read permission cannot either', async () => {
    const { cookie } = await registerAndLogin('unresolveduser')
    await request(server).get('/admin/orders/unresolved').set('Cookie', cookie).expect(403)

    const email = uniqueEmail('unresolvedadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    await request(server).get('/admin/orders/unresolved').set('Cookie', extractSessionCookie(res)).expect(403)
  })

  it('an order that hits an ambiguous provider outcome (TIMEOUT) becomes SUBMITTED and appears in the admin unresolved-order list', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = `UNRES-DOGE/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: {
        symbol,
        dataSource: 'LIVE',
        tradingEnabled: true,
        maintenanceMode: false,
        baseAsset: 'DOGE',
        quoteAsset: 'USDT',
        displayName: symbol,
        marketType: 'CRYPTO_SPOT',
        enabled: true,
        provider: 'BINANCE',
        providerSymbol,
      },
    })
    fake.configureSymbol(providerSymbol, { status: 'TRADING', baseAsset: 'DOGE', quoteAsset: 'USDT' })

    const { userId, cookie } = await registerAndLogin('unresolvedtimeout')
    await grantAsset(userId, 'USDT', '1000')

    fake.queueScenario(providerSymbol, 'TIMEOUT')
    const orderRes = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(orderRes.body.status).toBe('SUBMITTED')
    expect(orderRes.body.rejectionReason).toMatch(/reconciliation|unknown/i)

    const listRes = await request(server).get('/admin/orders/unresolved').set('Cookie', superCookie).expect(200)
    expect(listRes.body.count).toBeGreaterThanOrEqual(1)
    const match = listRes.body.orders.find((o: any) => o.id === orderRes.body.id)
    expect(match).toBeTruthy()
    expect(match.symbol).toBe(symbol)
    // Never leaks anything beyond identifiers/amounts/status — no secrets.
    expect(JSON.stringify(listRes.body)).not.toMatch(/SESSION_SECRET|passwordHash|apiKey|apiSecret/i)
  })

  it('a normally FILLED order never appears in the unresolved-order list', async () => {
    const providerSymbol = 'SHIBUSDT'
    const symbol = `UNRES-SHIB/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: {
        symbol,
        dataSource: 'LIVE',
        tradingEnabled: true,
        maintenanceMode: false,
        baseAsset: 'SHIB',
        quoteAsset: 'USDT',
        displayName: symbol,
        marketType: 'CRYPTO_SPOT',
        enabled: true,
        provider: 'BINANCE',
        providerSymbol,
      },
    })
    fake.configureSymbol(providerSymbol, { status: 'TRADING', baseAsset: 'SHIB', quoteAsset: 'USDT' })

    const { userId, cookie } = await registerAndLogin('unresolvedfilled')
    await grantAsset(userId, 'USDT', '1000')

    const orderRes = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(orderRes.body.status).toBe('FILLED')

    const listRes = await request(server).get('/admin/orders/unresolved').set('Cookie', superCookie).expect(200)
    const match = listRes.body.orders.find((o: any) => o.id === orderRes.body.id)
    expect(match).toBeFalsy()
  })
})

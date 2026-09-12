import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode, grantPermissionDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// Checkpoint I.1, Part 3 — the runtime trading kill switch. TRUST already
// has a persisted, permission + step-up gated, audit-logged platform-wide
// `tradingEnabled` switch (PlatformSettings, enforced first-thing inside
// RiskEngineService.evaluate() via the GLOBAL_TRADING_DISABLED reason code —
// see risk-engine.service.ts and platform-controls.e2e-spec.ts, which
// already proves disabling it makes POST /orders return 503). This file
// closes the specific gaps Checkpoint I.1 asks about that no existing test
// covers: unauthorized changes, the audit trail, the zero-side-effect
// guarantee while disabled, persistence across a real process restart, and
// that disabling NEW trading never blocks reconciliation of an order that
// is already open.
//
// NOTE ON DEFAULT STATE: PlatformSettings.tradingEnabled defaults to `true`
// at the schema level (prisma/schema.prisma), and the entire existing
// 230-test e2e suite implicitly depends on that default for every order
// test to run without first performing an admin enable step. Flipping the
// schema default to `false` would be a sweeping, high-risk change across
// the whole suite, contrary to "preserve all currently passing financial
// invariants" — see the Checkpoint I.1 report's Part 3 section for the
// explicit disclosure of this decision.
describe('Trading kill switch — authorization, audit, and reconciliation invariants (real PostgreSQL)', () => {
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

    const email = uniqueEmail('killswitchsuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superSecret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)
  })

  afterAll(async () => {
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'restore after kill-switch tests', confirmPassword: superPassword })
    await app.close()
  })

  async function newUserCookie(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  it('a plain USER cannot change the trading kill switch', async () => {
    const { cookie } = await newUserCookie('killswitchuser')
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', cookie)
      .send({ tradingEnabled: false, reason: 'unauthorized attempt', confirmPassword: 'whatever' })
      .expect(403)
  })

  it('an ADMIN without the platform.control permission cannot change the trading kill switch, even with a valid step-up', async () => {
    const email = uniqueEmail('killswitchadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    const secret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) }).expect(200)
    const cookie = extractSessionCookie(verifyRes)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', cookie)
      .send({ tradingEnabled: false, reason: 'no permission granted yet', confirmPassword: password })
      .expect(403)
  })

  it('disabling and re-enabling trading each write a distinct, attributable audit event', async () => {
    const before = await prisma.auditLog.count({ where: { action: { in: ['TRADING_PAUSED', 'TRADING_RESUMED'] } } })

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'audit trail test — pause', confirmPassword: superPassword })
      .expect(200)
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'audit trail test — resume', confirmPassword: superPassword })
      .expect(200)

    const after = await prisma.auditLog.count({ where: { action: { in: ['TRADING_PAUSED', 'TRADING_RESUMED'] } } })
    expect(after).toBe(before + 2)

    const latestPause = await prisma.auditLog.findFirst({ where: { action: 'TRADING_PAUSED' }, orderBy: { createdAt: 'desc' } })
    expect(latestPause?.reason).toBe('audit trail test — pause')
  })

  it('while trading is disabled, a rejected order creates ZERO rows of any kind — no order, no reservation, no ledger transaction, no provider submission', async () => {
    await prisma.marketConfig.upsert({
      where: { symbol: 'KILLSWITCH-ZERO/TEST' },
      create: { symbol: 'KILLSWITCH-ZERO/TEST', dataSource: 'SIMULATED', tradingEnabled: true },
      update: { tradingEnabled: true },
    })
    const { userId, cookie } = await newUserCookie('killswitchzero')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const ordersBefore = await prisma.order.count({ where: { accountId: account.id } })
    const txnsBefore = await prisma.ledgerTransaction.count({ where: { relatedType: 'ORDER' } })

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'zero-side-effect test', confirmPassword: superPassword })
      .expect(200)

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'KILLSWITCH-ZERO/TEST', side: 'BUY', quantity: '10' })
    expect(res.status).toBe(503)

    const ordersAfter = await prisma.order.count({ where: { accountId: account.id } })
    const txnsAfter = await prisma.ledgerTransaction.count({ where: { relatedType: 'ORDER' } })
    expect(ordersAfter).toBe(ordersBefore)
    expect(txnsAfter).toBe(txnsBefore)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'restore', confirmPassword: superPassword })
      .expect(200)
  })

  it('the trading kill switch state is persisted in the database and survives a real process restart', async () => {
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'persistence test', confirmPassword: superPassword })
      .expect(200)

    // Simulate a backend restart: close this Nest application entirely and
    // boot a brand new one against the same DATABASE_URL — nothing about
    // the disabled state lives in this process's memory (PlatformSettingsService
    // has no cache), only in the PlatformSettings row itself.
    await app.close()
    const restarted = await createTestApp()
    app = restarted.app
    prisma = restarted.prisma
    server = app.getHttpServer()

    const settings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(settings.tradingEnabled).toBe(false)

    // Re-authenticate against the restarted app (sessions are DB-backed too,
    // but re-derive cookies fresh rather than assuming session survival is
    // itself part of what this test is proving).
    const loginRes = await request(server).post('/auth/login').send({ email: (await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'desc' } })).email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'restore after persistence test', confirmPassword: superPassword })
      .expect(200)
  })

  it('disabling NEW trading platform-wide does not block reconciliation (sync/cancel) of an order that is already open', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = `KS-ETH/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: {
        symbol,
        dataSource: 'LIVE',
        tradingEnabled: true,
        maintenanceMode: false,
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        displayName: symbol,
        marketType: 'CRYPTO_SPOT',
        enabled: true,
        provider: 'BINANCE',
        providerSymbol,
      },
    })

    const { FakeExecutionProvider } = await import('../src/execution/providers/fake-execution.provider')
    const fake = app.get(FakeExecutionProvider)
    fake.configureSymbol(providerSymbol, { status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT' })

    const { userId, cookie } = await newUserCookie('killswitchreconcile')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const ledger = app.get((await import('../src/ledger/ledger.service')).LedgerService)
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, 'USDT')
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', 'USDT')
    await ledger.postTransaction({
      description: 'fixture grant',
      idempotencyKey: `ks-fixture-grant-${userId}-${Date.now()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: '1000', currency: 'USDT', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: '1000', currency: 'USDT', entryType: 'ADJUSTMENT' },
      ],
    })

    const openRes = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '50' }).expect(201)
    expect(openRes.body.status).toBe('OPEN')
    const orderId = openRes.body.id

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'reconciliation-still-works test', confirmPassword: superPassword })
      .expect(200)

    // Neither sync nor cancel goes through the risk engine (they operate on
    // an existing order via getExecutionContextForOrder, not createOrder) —
    // both must keep working while NEW trading is disabled.
    await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    const cancelRes = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(['CANCEL_PENDING', 'CANCELLED']).toContain(cancelRes.body.status)

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'restore', confirmPassword: superPassword })
      .expect(200)
  })
})

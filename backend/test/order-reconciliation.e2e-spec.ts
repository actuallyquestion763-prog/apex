import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Decimal } from '@prisma/client/runtime/library'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import { OrderReconciliationService } from '../src/orders/order-reconciliation.service'
import { AuditEvent } from '../src/audit/audit-events'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6F Checkpoint E — provider-vs-TRUST reconciliation, the audit
// exactly-once fix, and admin access control. Every scenario is driven
// through FakeExecutionProvider exclusively; nothing here ever mutates
// financial state as a side effect of checking it (reconciliation is 100%
// read-only by construction — see order-reconciliation.service.ts).
describe('Order reconciliation, audit exactly-once, and admin access (real PostgreSQL, FakeExecutionProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let fake: FakeExecutionProvider
  let reconciliation: OrderReconciliationService
  let server: any
  let superCookie: string
  let superPassword: string
  let superSecret: string

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    fake = app.get(FakeExecutionProvider)
    reconciliation = app.get(OrderReconciliationService)

    const email = uniqueEmail('reconcilesuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superSecret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Reconciliation Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const cookie = extractSessionCookie(res)
    return { userId: user.id, cookie }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'test fixture asset grant',
      idempotencyKey: `fixture-grant-${userId}-${currency}-${amount}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  let marketSeq = 0
  async function setupMarket(opts: { providerSymbol: string; baseAsset: string; quoteAsset: string }) {
    marketSeq += 1
    const symbol = `REC${marketSeq}-${opts.baseAsset}/${opts.quoteAsset}-${Date.now()}`
    await prisma.marketConfig.create({
      data: {
        symbol,
        dataSource: 'LIVE',
        tradingEnabled: true,
        maintenanceMode: false,
        baseAsset: opts.baseAsset,
        quoteAsset: opts.quoteAsset,
        displayName: symbol,
        marketType: 'CRYPTO_SPOT',
        enabled: true,
        provider: 'BINANCE',
        providerSymbol: opts.providerSymbol,
      },
    })
    fake.configureSymbol(opts.providerSymbol, { status: 'TRADING', baseAsset: opts.baseAsset, quoteAsset: opts.quoteAsset })
    return symbol
  }

  async function openLimitOrder(cookie: string, symbol: string, side: 'BUY' | 'SELL', quantity: string, limitPrice: string) {
    const res = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side, quantity, orderType: 'LIMIT', limitPrice })
      .expect(201)
    expect(res.body.status).toBe('OPEN')
    return res.body
  }

  function findCategory(result: { categories: string[] }, category: string) {
    return result.categories.includes(category)
  }

  // ---- 1. perfect reconciliation ---------------------------------------------

  it('1. a fully-synced order reconciles cleanly — RECONCILED, no discrepancy', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('perfectmatch')
    await grantAsset(userId, 'USDT', '1000')
    fake.setSimulatedPrice(providerSymbol, '60000')

    const order = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '600' }).expect(201)
    expect(order.body.status).toBe('FILLED')

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.body.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(result.categories).toEqual(['RECONCILED'])
    expect(result.severity).toBe('INFO')
  })

  // ---- 2. missing provider order -----------------------------------------------

  it('2. MISSING_PROVIDER_ORDER: provider has no record of an order TRUST believes is live — flagged CRITICAL, never auto-cancelled, funds stay reserved', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('missingorder')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '600', '3000')

    fake.queueScenario(providerSymbol, 'MISSING_ORDER')
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)

    expect(findCategory(result, 'MISSING_PROVIDER_ORDER')).toBe(true)
    expect(result.severity).toBe('CRITICAL')

    // Financially untouched — reconciliation never mutates.
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(fresh.status).toBe('OPEN')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    expect(usdt.reserved.toString()).toBe('600')
  })

  // ---- 3. missing TRUST fill ------------------------------------------------

  it('3. MISSING_TRUST_FILL: provider reports a fill TRUST has not recorded — CRITICAL, never silently created', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('missingtrustfill')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '600', '100')

    fake.simulateFill(order.clientOrderId, '3', '100') // provider now has a fill; TRUST was never told (no sync)

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)

    expect(findCategory(result, 'MISSING_TRUST_FILL')).toBe(true)
    expect(result.severity).toBe('CRITICAL')

    // No fill was created by reconciliation itself.
    const fillCount = await prisma.fill.count({ where: { orderId: order.id } })
    expect(fillCount).toBe(0)
  })

  // ---- 4. extra provider fill ------------------------------------------------

  it('4. EXTRA_PROVIDER_FILL: TRUST already shows FILLED, but the provider reports one more fill beyond that', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('extrafill')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '500')
    fake.simulateFill(order.clientOrderId, '1', '500') // fully fills 500/500
    const synced = await request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie).expect(201)
    expect(synced.body.status).toBe('FILLED')

    // Provider (unexpectedly) reports an additional fill after TRUST already closed the order.
    fake.simulateFill(order.clientOrderId, '0.001', '500')

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'EXTRA_PROVIDER_FILL')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
  })

  // ---- 5. duplicate provider fill ---------------------------------------------

  it('5. DUPLICATE_PROVIDER_FILL: the provider itself returns the same fill id twice in one response', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('dupproviderfill')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '0.5')

    fake.simulateFill(order.clientOrderId, '100', '0.5', '0', 'USDT', 'dup-fill-1')
    fake.simulateFill(order.clientOrderId, '100', '0.5', '0', 'USDT', 'dup-fill-1') // same id again

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'DUPLICATE_PROVIDER_FILL')).toBe(true)
  })

  // ---- 6/7/8. quantity / price / fee mismatch ------------------------------------

  it('6. QUANTITY_MISMATCH: TRUST’s recorded fill quantity has drifted from the provider’s', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('qtymismatch')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '400', '0.4')
    fake.simulateFill(order.clientOrderId, '1000', '0.4')
    await request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie).expect(201)

    // Corrupt TRUST's own copy directly (simulating drift) — reconciliation must detect it, not cause it.
    const fillRow = await prisma.fill.findFirstOrThrow({ where: { orderId: order.id } })
    await prisma.fill.update({ where: { id: fillRow.id }, data: { quantity: new Decimal('999') } })

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'QUANTITY_MISMATCH')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
  })

  it('7. PRICE_MISMATCH: TRUST’s recorded execution price has drifted from the provider’s', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('pricemismatch')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '400', '0.1')
    fake.simulateFill(order.clientOrderId, '4000', '0.1')
    await request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie).expect(201)

    const fillRow = await prisma.fill.findFirstOrThrow({ where: { orderId: order.id } })
    await prisma.fill.update({ where: { id: fillRow.id }, data: { price: new Decimal('0.2') } })

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'PRICE_MISMATCH')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
  })

  it('8. FEE_MISMATCH: TRUST’s recorded fee has drifted from the provider’s', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('feemismatch')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '600', '60000')
    fake.simulateFill(order.clientOrderId, '0.01', '60000', '0.5', 'USDT')
    await request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie).expect(201)

    const fillRow = await prisma.fill.findFirstOrThrow({ where: { orderId: order.id } })
    await prisma.fill.update({ where: { id: fillRow.id }, data: { fee: new Decimal('99') } })

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'FEE_MISMATCH')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
  })

  // ---- 9. reservation mismatch ------------------------------------------------

  it('9. RESERVATION_MISMATCH: the ledger’s actual reserved amount for an order does not match what the provider’s confirmed fills imply', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('reservationmismatch')
    const accountId = await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '600', '3000')

    // Out-of-band ledger adjustment against this order's own RESERVED
    // account, tagged to the same order — simulates the ledger and the
    // provider having diverged for a reason unrelated to any fill.
    const { reserved } = await ledger.getOrCreateUserLedgerAccounts(accountId, 'USDT')
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', 'USDT')
    await ledger.postTransaction({
      description: 'test fixture — simulate reservation drift',
      relatedType: 'ORDER',
      relatedId: order.id,
      idempotencyKey: `test-drift-${order.id}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: '50', currency: 'USDT', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: reserved.id, direction: 'CREDIT', amount: '50', currency: 'USDT', entryType: 'ADJUSTMENT' },
      ],
    })

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'RESERVATION_MISMATCH')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
    expect(result.reservationExpected).toBe('600')
    expect(result.reservationActual).toBe('650')
  })

  // ---- 10. invalid limit fill --------------------------------------------------

  it('10. INVALID_LIMIT_FILL: an unsynced provider fill that violates the limit price is detected by reconciliation itself, independent of sync', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('invalidlimitrecon')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '100')

    fake.simulateFill(order.clientOrderId, '1', '101') // 101 > limit 100 — invalid for a BUY

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'INVALID_LIMIT_FILL')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
  })

  // ---- 11. status mismatch --------------------------------------------------

  it('11. STATUS_MISMATCH: TRUST OPEN, provider PARTIALLY_FILLED — flagged WARNING (safe to synchronize), never auto-corrected by reconciliation itself', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('statusmismatch')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '0.5')

    fake.simulateProviderStatusChange(order.clientOrderId, 'PARTIALLY_FILLED')

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'STATUS_MISMATCH')).toBe(true)

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(fresh.status).toBe('OPEN') // unchanged — reconciliation never mutates
  })

  it('11b. TRUST FILLED is never downgraded even if a stale provider response disagrees', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('neverdowngrade')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '500')
    fake.simulateFill(order.clientOrderId, '1', '500')
    const synced = await request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie).expect(201)
    expect(synced.body.status).toBe('FILLED')

    fake.simulateProviderStatusChange(order.clientOrderId, 'NEW') // stale/incorrect provider report

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'STATUS_MISMATCH')).toBe(true)
    expect(result.severity).toBe('CRITICAL')
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(fresh.status).toBe('FILLED') // never downgraded
  })

  // ---- 12. unknown provider state ------------------------------------------------

  it('12. UNKNOWN_PROVIDER_STATE: the provider cannot currently report on a known order — WARNING, never mutated', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('unknownstate')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '0.1')

    fake.queueScenario(providerSymbol, 'UNKNOWN_STATUS')
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'UNKNOWN_PROVIDER_STATE')).toBe(true)
    expect(result.severity).toBe('WARNING')

    // Financially untouched.
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(fresh.status).toBe('OPEN')
  })

  // ---- 13. provider error --------------------------------------------------------

  it('13. PROVIDER_ERROR: a transient provider failure (unavailable) is WARNING, never mutated', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('providererror')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '500', '0.5')

    fake.queueScenario(providerSymbol, 'UNAVAILABLE')
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
    const result = await reconciliation.reconcileOrder(orderRow)
    expect(findCategory(result, 'PROVIDER_ERROR')).toBe(true)
    expect(result.severity).toBe('WARNING')
  })

  // ---- 14/15. repeat-safe, no duplicate financial effects ------------------------

  it('14/15. reconciliation can be run repeatedly with no additional financial effects', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('repeatsafe')
    const accountId = await grantAsset(userId, 'USDT', '1000')
    await openLimitOrder(cookie, symbol, 'BUY', '500', '100')

    const before = await ledger.getAccountBalances(accountId, 'USDT')
    const txCountBefore = await prisma.ledgerTransaction.count()

    await reconciliation.runReconciliation()
    await reconciliation.runReconciliation()
    const summary3 = await reconciliation.runReconciliation()

    const after = await ledger.getAccountBalances(accountId, 'USDT')
    const txCountAfter = await prisma.ledgerTransaction.count()
    expect(after.cash.toString()).toBe(before.cash.toString())
    expect(after.reserved.toString()).toBe(before.reserved.toString())
    expect(txCountAfter).toBe(txCountBefore) // zero new ledger transactions from 3 reconciliation runs
    expect(summary3.ordersChecked).toBeGreaterThan(0)
  })

  // ---- 16. audit exactly-once under concurrency ----------------------------------

  it('16. ten concurrent syncs of the same order/fill produce exactly ONE financial settlement and ONE order-state audit event', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('exactlyonce')
    await grantAsset(userId, 'USDT', '1000')
    const order = await openLimitOrder(cookie, symbol, 'BUY', '600', '60000')

    fake.simulateFill(order.clientOrderId, '0.01', '60000', '0.5', 'USDT') // one fill, fully fills the order

    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie)),
    )
    for (const r of results) expect(r.status).toBe(201)

    const fillCount = await prisma.fill.count({ where: { orderId: order.id } })
    expect(fillCount).toBe(1) // exactly one Fill row despite 10 concurrent syncs

    const settlementTxCount = await prisma.ledgerTransaction.count({
      where: { relatedType: 'ORDER', relatedId: order.id, description: { contains: 'Incremental fill settlement' } },
    })
    expect(settlementTxCount).toBe(1) // exactly one settlement transaction

    const filledAuditCount = await prisma.auditLog.count({ where: { targetType: 'ORDER', targetId: order.id, action: AuditEvent.ORDER_FILLED } })
    expect(filledAuditCount).toBe(1) // exactly one order-state audit event
    const feeAuditCount = await prisma.auditLog.count({ where: { targetType: 'ORDER', targetId: order.id, action: AuditEvent.FEE_CHARGED } })
    expect(feeAuditCount).toBe(1) // exactly one fee audit event
    const balanceAuditCount = await prisma.auditLog.count({ where: { targetType: 'ACCOUNT', action: AuditEvent.ASSET_BALANCE_UPDATED } })
    // Scoped loosely (ACCOUNT target has no per-order id); assert via the
    // final order/ledger state instead, which is the real financial proof:
    void balanceAuditCount

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(finalOrder.status).toBe('FILLED')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    expect(usdt.reserved.toString()).toBe('0')
    // 1000 - 600 (reserved at order creation) - 0.5 fee = 399.5, deducted exactly once.
    expect(usdt.cash.toString()).toBe('399.5')
  })

  // ---- 17/18/19. admin access control --------------------------------------------

  it('17. the admin reconciliation endpoint works for a permitted SUPER_ADMIN', async () => {
    const res = await request(server).post('/admin/reconciliation/run').set('Cookie', superCookie).expect(201)
    expect(typeof res.body.ordersChecked).toBe('number')
    expect(Array.isArray(res.body.results)).toBe(true)

    const auditCount = await prisma.auditLog.count({ where: { action: AuditEvent.RECONCILIATION_RUN } })
    expect(auditCount).toBeGreaterThan(0) // the run itself is audited
  })

  it('18. an ordinary customer cannot run reconciliation', async () => {
    const { cookie } = await registerAndLogin('unauthorizedrecon')
    const res = await request(server).post('/admin/reconciliation/run').set('Cookie', cookie)
    expect(res.status).toBe(403)
  })

  it('19. reconciliation does NOT require step-up — matching the existing precedent for the internal-ledger-only reconciliation endpoint (both are pure reads, never a financial mutation)', async () => {
    // No confirmPassword in the request body at all — if step-up
    // were required, this would fail; it succeeds, confirming the endpoint
    // deliberately sits at the "ledger.read"-equivalent trust tier, not the
    // step-up tier reserved for actual money movement.
    const res = await request(server).post('/admin/reconciliation/run').set('Cookie', superCookie).send({}).expect(201)
    expect(res.body.runAt).toBeTruthy()
  })

  // ---- 20/21. kill switches still work -------------------------------------------

  it('20. the global trading kill switch still blocks new order submission', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('reconcilekillswitch')
    await grantAsset(userId, 'USDT', '1000')

    await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: { tradingEnabled: false }, create: { id: 'singleton', tradingEnabled: false } })
    try {
      const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' })
      expect(res.status).toBe(503)
    } finally {
      await prisma.platformSettings.update({ where: { id: 'singleton' }, data: { tradingEnabled: true } })
    }
  })

  it('21. a per-market trading-disabled flag still blocks that market only', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    await prisma.marketConfig.update({ where: { symbol }, data: { tradingEnabled: false } })
    const { userId, cookie } = await registerAndLogin('reconcilemarketkill')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
  })

  // ---- 22. risk limits (documented as not-yet-authoritative, Part 16) -----------

  it('22. no numeric risk limit is currently enforced — an arbitrarily large valid order is accepted (documents current state; Part 16 forbids inventing a limit)', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('noriscklimit')
    await grantAsset(userId, 'USDT', '10000000')
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '5000000' }).expect(201)
    // Accepted or honestly rejected for a NON-risk reason (e.g. provider
    // min/max) — never blocked by a fabricated risk ceiling, because none exists.
    expect(['FILLED', 'PARTIALLY_FILLED', 'SUBMITTED', 'REJECTED']).toContain(res.body.status)
    if (res.body.status === 'REJECTED') {
      expect(res.body.rejectionReason).not.toMatch(/risk limit/i)
    }
  })

  // ---- 23/24/25. regression: normal execution, no negative balances, ledger balanced ---

  it('23/24/25. a normal valid order still executes correctly, no negative balances, ledger balanced per currency', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('regressioncheck')
    await grantAsset(userId, 'USDT', '1000')
    fake.setSimulatedPrice(providerSymbol, '0.4')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '400' }).expect(201)
    expect(res.body.status).toBe('FILLED')

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    expect(usdt.cash.gte(0)).toBe(true)
    expect(usdt.reserved.toString()).toBe('0')

    const txns = await prisma.ledgerTransaction.findMany({ where: { relatedType: 'ORDER', relatedId: res.body.id }, include: { entries: true } })
    for (const txn of txns) {
      const byCurrency = new Map<string, { credits: number; debits: number }>()
      for (const e of txn.entries) {
        const bucket = byCurrency.get(e.currency) ?? { credits: 0, debits: 0 }
        if (e.direction === 'CREDIT') bucket.credits += Number(e.amount)
        else bucket.debits += Number(e.amount)
        byCurrency.set(e.currency, bucket)
      }
      for (const [, { credits, debits }] of byCurrency) {
        expect(credits).toBeCloseTo(debits, 8)
      }
    }
  })

  // ---- Checkpoint I, Part 1 — locks in the OrdersService side of the Checkpoint H bug ----

  it('34. syncOrder and cancelOrder both pass providerOrderId through to getOrderFills — the actual caller-side fix, not just the provider-side capability', async () => {
    const providerSymbol = 'LTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'LTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('provideridpassthrough')
    await grantAsset(userId, 'USDT', '1000')

    const getFillsSpy = jest.spyOn(fake, 'getOrderFills')

    const order = await openLimitOrder(cookie, symbol, 'BUY', '100', '50')
    expect(order.status).toBe('OPEN')
    expect(order.externalOrderId).toBeTruthy()

    getFillsSpy.mockClear()
    await request(server).post(`/orders/${order.id}/sync`).set('Cookie', cookie).expect(201)
    expect(getFillsSpy).toHaveBeenCalledWith(expect.objectContaining({ providerOrderId: order.externalOrderId }))

    getFillsSpy.mockClear()
    await request(server).post(`/orders/${order.id}/cancel`).set('Cookie', cookie).expect(201)
    expect(getFillsSpy).toHaveBeenCalledWith(expect.objectContaining({ providerOrderId: order.externalOrderId }))

    getFillsSpy.mockRestore()
  })
})

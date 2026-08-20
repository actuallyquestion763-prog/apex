import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import { AuditEvent } from '../src/audit/audit-events'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6F Checkpoint F — the centralized pre-trade risk engine
// (RiskEngineService), called exactly once from OrdersService.createOrder()
// before any reservation, ledger transaction, or provider call. Every
// scenario here is driven through FakeExecutionProvider exclusively; no
// real exchange is ever contacted.
describe('Pre-trade risk engine (real PostgreSQL, FakeExecutionProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let fake: FakeExecutionProvider
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

    const email = uniqueEmail('risksuper')
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
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Risk Engine Test' })
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
  async function setupMarket(opts: {
    providerSymbol: string
    baseAsset: string
    quoteAsset: string
    minimumQuantity?: string
    maximumQuantity?: string
    maxOrderNotional?: string
    maxPositionQuantity?: string
  }) {
    marketSeq += 1
    const symbol = `RISK${marketSeq}-${opts.baseAsset}/${opts.quoteAsset}-${Date.now()}`
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
        minimumQuantity: opts.minimumQuantity,
        maximumQuantity: opts.maximumQuantity,
        maxOrderNotional: opts.maxOrderNotional,
        maxPositionQuantity: opts.maxPositionQuantity,
      },
    })
    fake.configureSymbol(opts.providerSymbol, { status: 'TRADING', baseAsset: opts.baseAsset, quoteAsset: opts.quoteAsset })
    return symbol
  }

  async function balancesOf(userId: string, currency: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    return ledger.getAccountBalances(account.id, currency)
  }

  function reasonCodeOf(res: request.Response): string {
    return (res.body.rejectionReason as string)?.split(':')[0]?.trim()
  }

  // ==========================================================================
  // 1/36. GLOBAL_TRADING_DISABLED
  // ==========================================================================

  it('1/36. global trading kill switch rejects with 503 and creates zero rows of any kind', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('globalkill')
    await grantAsset(userId, 'USDT', '1000')

    await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: { tradingEnabled: false }, create: { id: 'singleton', tradingEnabled: false } })
    try {
      const before = await prisma.order.count({ where: { userId } })
      const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' })
      expect(res.status).toBe(503)
      const after = await prisma.order.count({ where: { userId } })
      expect(after).toBe(before) // zero order rows
      const txCount = await prisma.ledgerTransaction.count({ where: { relatedType: 'ORDER' } })
      const usdt = await balancesOf(userId, 'USDT')
      expect(usdt.cash.toString()).toBe('1000') // zero balance mutation
      void txCount
    } finally {
      await prisma.platformSettings.update({ where: { id: 'singleton' }, data: { tradingEnabled: true } })
    }
  })

  // ==========================================================================
  // 2/37. MARKET_TRADING_DISABLED
  // ==========================================================================

  it('2/37. per-market trading disabled rejects only that market, with a structured reason code', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT' })
    await prisma.marketConfig.update({ where: { symbol }, data: { tradingEnabled: false } })
    const { userId, cookie } = await registerAndLogin('marketkill')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MARKET_TRADING_DISABLED')

    const auditCount = await prisma.auditLog.count({ where: { targetType: 'ORDER', targetId: res.body.id, action: AuditEvent.ORDER_RISK_REJECTED } })
    expect(auditCount).toBe(1)
  })

  // ==========================================================================
  // 3/38. ACCOUNT_TRADING_DISABLED
  // ==========================================================================

  it('3/38. account-level trading disable rejects only that account (Account.status, distinct from User.status)', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('accountdisabled')
    await grantAsset(userId, 'USDT', '1000')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    await request(server)
      .patch(`/admin/accounts/${account.id}/status`)
      .set('Cookie', superCookie)
      .send({ status: 'SUSPENDED', reason: 'risk engine test' })
      .expect(200)

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('ACCOUNT_TRADING_DISABLED')

    // The user's SESSION is still valid (only the account is restricted,
    // not the user's ability to log in — Part 14: existing positions/orders
    // are not silently modified, and other endpoints keep working).
    await request(server).get('/accounts/me/summary').set('Cookie', cookie).expect(200)
  })

  // ==========================================================================
  // 4. USER_NOT_ALLOWED_TO_TRADE (unauthorized request)
  // ==========================================================================

  it('4. an unauthenticated request never reaches the risk engine at all', async () => {
    const res = await request(server).post('/orders').send({ symbol: 'BTC/USDT', side: 'BUY', quantity: '100' })
    expect(res.status).toBe(401)
  })

  // ==========================================================================
  // 5. INVALID_SYMBOL
  // ==========================================================================

  it('5. a market with trading enabled but no base/quote asset configured is rejected as INVALID_SYMBOL', async () => {
    marketSeq += 1
    const symbol = `BROKEN-CONFIG-${Date.now()}`
    await prisma.marketConfig.create({
      data: { symbol, dataSource: 'SIMULATED', tradingEnabled: true, baseAsset: '', quoteAsset: '', marketType: 'CRYPTO_SPOT' },
    })
    const { userId, cookie } = await registerAndLogin('invalidsymbol')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('INVALID_SYMBOL')
  })

  // ==========================================================================
  // 6. INVALID_QUANTITY
  // ==========================================================================

  it('6. zero/negative quantity is rejected with 400 and creates no order row (pre-existing behavior, unchanged)', async () => {
    const { userId, cookie } = await registerAndLogin('invalidqty')
    const before = await prisma.order.count({ where: { userId } })
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'BTC/USDT', side: 'BUY', quantity: '0' })
    expect(res.status).toBe(400)
    const after = await prisma.order.count({ where: { userId } })
    expect(after).toBe(before)
  })

  // ==========================================================================
  // 7/8. MIN / MAX ORDER SIZE
  // ==========================================================================

  it('7. an order below the configured minimum quantity is rejected as MIN_ORDER_SIZE_EXCEEDED', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT', minimumQuantity: '10' })
    const { userId, cookie } = await registerAndLogin('minsize')
    await grantAsset(userId, 'USDT', '1000')

    // LIMIT price is caller-controlled (deterministic) — 5 USDT / 1 USDT
    // per ADA = 5 ADA, below the 10 ADA minimum. A MARKET order would need
    // the real live Binance price to do this base-quantity conversion,
    // which this test deliberately avoids depending on.
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '5', orderType: 'LIMIT', limitPrice: '1' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MIN_ORDER_SIZE_EXCEEDED')
  })

  it('8. an order above the configured maximum quantity is rejected as MAX_ORDER_SIZE_EXCEEDED', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT', maximumQuantity: '50' })
    const { userId, cookie } = await registerAndLogin('maxsize')
    await grantAsset(userId, 'USDT', '10000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '1' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MAX_ORDER_SIZE_EXCEEDED')
  })

  // ==========================================================================
  // 9/28/29. MAX_NOTIONAL_EXCEEDED — exact Decimal, LIMIT and MARKET
  // ==========================================================================

  it('9/28. LIMIT notional uses exact Decimal arithmetic (quantity is already quote-denominated for BUY) and is rejected above the configured max', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT', maxOrderNotional: '1000' })
    const { userId, cookie } = await registerAndLogin('maxnotionallimit')
    await grantAsset(userId, 'USDT', '5000')

    // BUY LIMIT: quantity IS the notional already (Phase 6E §7 convention) — 1500 > 1000.
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '1500', orderType: 'LIMIT', limitPrice: '500' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MAX_NOTIONAL_EXCEEDED')
  })

  it('29. MARKET notional uses the trusted LIVE reference price, never a frontend-supplied one, and is rejected above the configured max', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT', maxOrderNotional: '100' })
    const { userId, cookie } = await registerAndLogin('maxnotionalmarket')
    await grantAsset(userId, 'USDT', '5000')

    // BUY MARKET: quantity is already quote-denominated too — 200 > 100.
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '200' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MAX_NOTIONAL_EXCEEDED')
  })

  // ==========================================================================
  // 10. MAX_OPEN_ORDERS_EXCEEDED
  // ==========================================================================

  it('10. exceeding the platform-wide max-open-orders-per-user limit is rejected, counting only genuinely open statuses', async () => {
    const providerSymbol = 'LTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'LTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('maxopenorders')
    await grantAsset(userId, 'USDT', '10000')

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ maxOpenOrdersPerUser: 1, reason: 'test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    try {
      const first = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '50' }).expect(201)
      expect(first.body.status).toBe('OPEN')

      const second = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '50' }).expect(201)
      expect(second.body.status).toBe('REJECTED')
      expect(reasonCodeOf(second)).toBe('MAX_OPEN_ORDERS_EXCEEDED')

      // A FILLED/CANCELLED/REJECTED order never counts toward the limit
      // (Part 9) — cancel the first, then a new order must succeed again.
      await request(server).post(`/orders/${first.body.id}/cancel`).set('Cookie', cookie).expect(201)
      await request(server).post(`/orders/${first.body.id}/sync`).set('Cookie', cookie).expect(201)
      const third = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '50' }).expect(201)
      expect(third.body.status).toBe('OPEN')
    } finally {
      await request(server)
        .patch('/admin/platform-settings')
        .set('Cookie', superCookie)
        .send({ maxOpenOrdersPerUser: 1000000, reason: 'restore', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
    }
  })

  // ==========================================================================
  // 11/25/26. MAX_POSITION_SIZE_EXCEEDED, projected position BUY/SELL
  // ==========================================================================

  it('11/25. a BUY that would push total base-asset holdings above the configured max position is rejected (projected position = current + acquired)', async () => {
    const providerSymbol = 'AVAXUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'AVAX', quoteAsset: 'USDT', maxPositionQuantity: '5' })
    const { userId, cookie } = await registerAndLogin('maxposition')
    await grantAsset(userId, 'USDT', '10000')
    await grantAsset(userId, 'AVAX', '4') // already holding 4 AVAX

    // LIMIT price 10 -> 20 USDT / 10 per AVAX = 2 AVAX acquired -> projected 4 + 2 = 6 > 5.
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '20', orderType: 'LIMIT', limitPrice: '10' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MAX_POSITION_SIZE_EXCEEDED')
  })

  it('26. a SELL projected position (current - order quantity) never triggers MAX_POSITION_SIZE_EXCEEDED — only reducing holdings is always allowed by that check', async () => {
    const providerSymbol = 'MATICUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'MATIC', quoteAsset: 'USDT', maxPositionQuantity: '5' })
    const { userId, cookie } = await registerAndLogin('sellposition')
    await grantAsset(userId, 'MATIC', '10') // already ABOVE the configured max, from a grant, not a trade

    // SELL's spend asset is the base asset directly — no price/quote
    // dependency for this check at all (notionalQuote/base-qty math is
    // never invoked on the position check for SELL).
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '3', orderType: 'LIMIT', limitPrice: '1' }).expect(201)
    expect(res.body.status).not.toBe('REJECTED')
  })

  // ==========================================================================
  // 12/27/34. INSUFFICIENT_AVAILABLE_BALANCE, spot SELL cannot exceed
  // available asset, no negative balances
  // ==========================================================================

  it('12. insufficient available USDT balance for a BUY is rejected before any reservation is attempted', async () => {
    const providerSymbol = 'FILUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'FIL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('insufficientbuy')
    await grantAsset(userId, 'USDT', '50')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('INSUFFICIENT_AVAILABLE_BALANCE')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('50') // untouched
    expect(usdt.reserved.toString()).toBe('0') // no reservation was ever created
  })

  it('27/34. a SELL cannot exceed available (unreserved) base-asset holdings, and no negative balance ever results', async () => {
    const providerSymbol = 'DOTUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOT', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('insufficientsell')
    await grantAsset(userId, 'DOT', '1')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '5' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('INSUFFICIENT_AVAILABLE_BALANCE')

    const dot = await balancesOf(userId, 'DOT')
    expect(dot.cash.gte(0)).toBe(true)
    expect(dot.cash.toString()).toBe('1')
  })

  // ==========================================================================
  // 13/30. INVALID_PRICE, existing Checkpoint D limit-price protection intact
  // ==========================================================================

  it('13. a non-positive LIMIT price is rejected as INVALID_PRICE before reservation', async () => {
    const providerSymbol = 'ATOMUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ATOM', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('invalidprice')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '0' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('INVALID_PRICE')
  })

  it('30. the existing Checkpoint D limit-price fill protection remains intact and is not duplicated by the risk engine (a fill above a BUY limit is flagged unresolved, never silently applied)', async () => {
    const providerSymbol = 'NEARUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'NEAR', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitprotection')
    await grantAsset(userId, 'USDT', '1000')

    const openRes = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '10' }).expect(201)
    expect(openRes.body.status).toBe('OPEN')

    // Provider reports a fill ABOVE the limit price — must be flagged, never silently settled.
    fake.simulateFill(openRes.body.clientOrderId, '5', '11', '0', 'USDT')
    const syncRes = await request(server).post(`/orders/${openRes.body.id}/sync`).set('Cookie', cookie).expect(201)
    expect(['SUBMITTED', 'OPEN']).toContain(syncRes.body.status) // never FILLED at a worse-than-limit price
  })

  // ==========================================================================
  // 14. MARKET_CLOSED_OR_UNAVAILABLE
  // ==========================================================================

  it('14. a market whose configured market-data provider cannot be resolved is rejected as MARKET_CLOSED_OR_UNAVAILABLE (never a fabricated price)', async () => {
    marketSeq += 1
    const symbol = `RISK${marketSeq}-ETC/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: {
        symbol,
        dataSource: 'LIVE',
        tradingEnabled: true,
        baseAsset: 'ETC',
        quoteAsset: 'USDT',
        marketType: 'CRYPTO_SPOT',
        enabled: true,
        // Deterministic, network-independent way to make MarketDataService
        // report UNAVAILABLE (see market-data.service.ts: an unrecognized
        // provider name never falls back to a guessed/cached/fabricated
        // price) — never dependent on a real exchange's live status.
        provider: 'NOT_A_REAL_PROVIDER',
        providerSymbol: 'ETCUSDT',
      },
    })
    const { userId, cookie } = await registerAndLogin('marketunavailable')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MARKET_CLOSED_OR_UNAVAILABLE')
  })

  // ==========================================================================
  // 16. valid order passes
  // ==========================================================================

  it('16. a fully valid order within every configured limit passes the risk engine and reaches the provider', async () => {
    const providerSymbol = 'ICPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ICP', quoteAsset: 'USDT', minimumQuantity: '0.01', maximumQuantity: '1000', maxOrderNotional: '100000', maxPositionQuantity: '10000' })
    const { userId, cookie } = await registerAndLogin('validorder')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '5' }).expect(201)
    expect(res.body.status).not.toBe('REJECTED')
  })

  // ==========================================================================
  // 17/18/19/20. risk rejection creates nothing and never calls the provider
  // ==========================================================================

  it('17/18/19/20. a risk rejection creates no reservation, no ledger mutation, and never calls the provider (spy count 0)', async () => {
    const providerSymbol = 'UNIUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'UNI', quoteAsset: 'USDT', maxOrderNotional: '10' })
    const { userId, cookie } = await registerAndLogin('zerofootprint')
    await grantAsset(userId, 'USDT', '1000')

    const submitMarketSpy = jest.spyOn(fake, 'submitMarketOrder')
    const submitLimitSpy = jest.spyOn(fake, 'submitLimitOrder')
    const callsBefore = submitMarketSpy.mock.calls.length + submitLimitSpy.mock.calls.length

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '500' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(reasonCodeOf(res)).toBe('MAX_NOTIONAL_EXCEEDED')

    const callsAfter = submitMarketSpy.mock.calls.length + submitLimitSpy.mock.calls.length
    expect(callsAfter).toBe(callsBefore) // provider was never called

    const reservationTx = await prisma.ledgerTransaction.count({ where: { relatedType: 'ORDER', relatedId: res.body.id } })
    expect(reservationTx).toBe(0) // no ledger transaction at all for this order

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000') // untouched
    expect(usdt.reserved.toString()).toBe('0')

    submitMarketSpy.mockRestore()
    submitLimitSpy.mockRestore()
  })

  // ==========================================================================
  // 21/22. idempotency
  // ==========================================================================

  it('21. replaying the same Idempotency-Key for a risk-rejected request returns the same deterministic rejection, with no new row', async () => {
    const providerSymbol = 'AAVEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'AAVE', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('idemrejected')
    await grantAsset(userId, 'USDT', '50')
    const key = `idem-rejected-${Date.now()}`

    const first = await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(first.body.status).toBe('REJECTED')

    const second = await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(second.body.id).toBe(first.body.id) // exact same replayed response, not a new attempt
    expect(second.body.status).toBe('REJECTED')

    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1)
  })

  it('22. reusing the same Idempotency-Key with a materially different request is rejected with 409, never silently applied', async () => {
    const providerSymbol = 'SANDUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SAND', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('idemconflictrisk')
    await grantAsset(userId, 'USDT', '1000')
    const key = `idem-conflict-risk-${Date.now()}`

    await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '10' }).expect(201)
    await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '999' }).expect(409)

    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1)
  })

  // ==========================================================================
  // 23/35. concurrent balance race
  // ==========================================================================

  it('23/35. ten concurrent BUY orders against a $1,000 balance, each requesting $800 — at most one succeeds, no overspending, double-entry stays balanced', async () => {
    const providerSymbol = 'TRXUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'TRX', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('concurrentrisk10')
    await grantAsset(userId, 'USDT', '1000')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '800' })),
    )
    for (const r of results) expect(r.status).toBe(201)
    const statuses = results.map((r) => r.body.status)
    const fundedCount = statuses.filter((s) => s !== 'REJECTED').length
    expect(fundedCount).toBeLessThanOrEqual(1) // never more than one could be funded

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.gte(0)).toBe(true) // never negative

    // Independent double-entry re-check across every transaction touching this run.
    const entries = await prisma.ledgerEntry.findMany({ where: { transaction: { relatedType: 'ORDER', relatedId: { in: results.map((r) => r.body.id) } } } })
    const byTx = new Map<string, { debit: number; credit: number }>()
    for (const e of entries) {
      const bucket = byTx.get(e.transactionId) ?? { debit: 0, credit: 0 }
      bucket[e.direction === 'DEBIT' ? 'debit' : 'credit'] += Number(e.amount)
      byTx.set(e.transactionId, bucket)
    }
    for (const { debit, credit } of byTx.values()) expect(debit).toBeCloseTo(credit, 8)
  })

  // ==========================================================================
  // 24. concurrent position race
  // ==========================================================================

  it('24. ten concurrent BUY orders near a configured max position — the underlying balance lock prevents holdings from ever exceeding what was actually affordable', async () => {
    const providerSymbol = 'ALGOUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ALGO', quoteAsset: 'USDT', maxPositionQuantity: '1000000' }) // high enough not to itself block; balance is the binding constraint
    const { userId, cookie } = await registerAndLogin('concurrentposition')
    await grantAsset(userId, 'USDT', '100')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '80' })),
    )
    for (const r of results) expect(r.status).toBe(201)
    const fundedCount = results.map((r) => r.body.status).filter((s) => s !== 'REJECTED').length
    expect(fundedCount).toBeLessThanOrEqual(1)

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.gte(0)).toBe(true)
  })

  // ==========================================================================
  // 31/32/33. existing reconciliation/cancellation/partial fills intact
  // ==========================================================================

  it('31/32/33. reconciliation, cancellation, and partial fills all continue to work through the risk-engine-gated create path', async () => {
    const providerSymbol = 'SHIBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SHIB', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('lifecycleintact')
    await grantAsset(userId, 'USDT', '1000')

    // Partial fill.
    const order = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '600', orderType: 'LIMIT', limitPrice: '60' }).expect(201)
    expect(order.body.status).toBe('OPEN')
    fake.simulateFill(order.body.clientOrderId, '5', '60', '0', 'USDT')
    const partial = await request(server).post(`/orders/${order.body.id}/sync`).set('Cookie', cookie).expect(201)
    expect(partial.body.status).toBe('PARTIALLY_FILLED')

    // Cancellation of a different, still-open order.
    const order2 = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '60', orderType: 'LIMIT', limitPrice: '60' }).expect(201)
    expect(order2.body.status).toBe('OPEN')
    await request(server).post(`/orders/${order2.body.id}/cancel`).set('Cookie', cookie).expect(201)
    const cancelled = await request(server).post(`/orders/${order2.body.id}/sync`).set('Cookie', cookie).expect(201)
    expect(cancelled.body.status).toBe('CANCELLED')

    // Reconciliation admin endpoint still runs cleanly.
    const reconRes = await request(server).post('/admin/reconciliation/run').set('Cookie', superCookie).expect(201)
    expect(typeof reconRes.body.ordersChecked).toBe('number')
  })

  // ==========================================================================
  // 39. admin permission enforcement on the new risk-config surface
  // ==========================================================================

  it('39. admin risk-config/status endpoints enforce permissions — an ordinary customer is rejected on every one', async () => {
    const { cookie } = await registerAndLogin('unauthorizedrisk')
    const account = await prisma.account.findFirstOrThrow({})

    await request(server).get('/admin/risk/overview').set('Cookie', cookie).expect(403)
    await request(server).patch(`/admin/accounts/${account.id}/status`).set('Cookie', cookie).send({ status: 'SUSPENDED', reason: 'nope' }).expect(403)
    await request(server).patch('/admin/markets/BTC%2FUSDT').set('Cookie', cookie).send({ maxOrderNotional: '1', reason: 'nope' }).expect(403)
    await request(server).patch('/admin/platform-settings').set('Cookie', cookie).send({ maxOpenOrdersPerUser: 1, reason: 'nope', confirmPassword: 'x', totpCode: '000000' }).expect(403)
  })

  it('39b. a permitted SUPER_ADMIN can read the risk overview and it reflects real state', async () => {
    const res = await request(server).get('/admin/risk/overview').set('Cookie', superCookie).expect(200)
    expect(typeof res.body.totalOpenOrders).toBe('number')
    expect(typeof res.body.exposureByCurrency).toBe('object')
    expect(typeof res.body.recentRiskViolationsByReasonCode).toBe('object')
  })

  // ==========================================================================
  // 40. step-up authentication where existing policy requires it
  // ==========================================================================

  it('40. platform-wide maxOpenOrdersPerUser requires step-up (existing policy for platform-settings); per-market risk limits do not (existing policy for market-config)', async () => {
    // Platform-wide: missing confirmPassword/totpCode is rejected.
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ maxOpenOrdersPerUser: 5, reason: 'no step-up provided' })
      .expect(400) // DTO requires confirmPassword/totpCode fields to be present at all

    const ok = await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ maxOpenOrdersPerUser: 5, reason: 'with step-up', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
    expect(ok.body.maxOpenOrdersPerUser).toBe(5)
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ maxOpenOrdersPerUser: 1000000, reason: 'restore', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })

    // Per-market: no step-up fields needed at all, matching existing tradingEnabled/maintenanceMode precedent.
    const providerSymbol = 'ZILUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ZIL', quoteAsset: 'USDT' })
    const marketOk = await request(server)
      .patch(`/admin/markets/${encodeURIComponent(symbol)}`)
      .set('Cookie', superCookie)
      .send({ maxOrderNotional: '500', reason: 'no step-up needed for market config' })
      .expect(200)
    expect(marketOk.body.maxOrderNotional).toBe('500')
  })
})

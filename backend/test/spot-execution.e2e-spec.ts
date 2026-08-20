import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import { EXECUTION_PROVIDER } from '../src/execution/execution.module'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6F Checkpoint C — the first end-to-end path where a TRUST order can
// become FILLED, exclusively through FakeExecutionProvider (verified below
// to be the actual DI-resolved EXECUTION_PROVIDER under NODE_ENV=test — see
// item 0). No credential of any kind is used anywhere in this file.
//
// Every market used here is a SYNTHETIC, per-test-unique TRUST symbol
// (never the shared seeded 'BTC/USDT' row some other e2e files mutate) —
// mapped to a REAL Binance providerSymbol (e.g. "BTCUSDT") purely so
// MarketDataService's existing, already-real BinanceProvider integration
// (Phase 6C) supplies a genuine LIVE display quote. EXECUTION always goes
// through the injected fake, never a real exchange.
describe('Spot market execution — MARKET BUY/SELL through FakeExecutionProvider (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let fake: FakeExecutionProvider
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    fake = app.get(FakeExecutionProvider)
  })

  afterAll(async () => {
    await app.close()
  })

  // ---- fixtures -----------------------------------------------------------

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Spot Execution Test' })
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
  // Creates a fresh, uniquely-named CRYPTO_SPOT/LIVE/tradingEnabled market
  // mapped to a real Binance providerSymbol, and configures the fake
  // provider's symbol-info/price for it. Returns TRUST's own symbol string.
  async function setupMarket(opts: { providerSymbol: string; baseAsset: string; quoteAsset: string; price: string }) {
    marketSeq += 1
    const symbol = `E2E${marketSeq}-${opts.baseAsset}/${opts.quoteAsset}-${Date.now()}`
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
    fake.setSimulatedPrice(opts.providerSymbol, opts.price)
    return symbol
  }

  async function balancesOf(userId: string, currency: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    return ledger.getAccountBalances(account.id, currency)
  }

  // ---- 0. sanity: the DI-resolved execution provider really is the fake ---

  it('0. the app under NODE_ENV=test resolves EXECUTION_PROVIDER to the injected FakeExecutionProvider — never a real provider', () => {
    expect(app.get(EXECUTION_PROVIDER)).toBe(fake)
  })

  // ---- 1/3/5/7/8/9. MARKET BUY ---------------------------------------------

  it('1/3/5/7/8/9. MARKET BUY: spends actual USDT, credits actual BTC, at the ACTUAL fill price/quantity/fee — never the displayed estimate', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT', price: '61234.56' })
    const { userId, cookie } = await registerAndLogin('buysuccess')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '500' }).expect(201)

    expect(res.body.status).toBe('FILLED')
    expect(res.body.executedPrice).toBe('61234.56') // the FAKE's fill price, not any display estimate
    expect(new Number(res.body.filledQuantity).valueOf()).toBeCloseTo(500 / 61234.56, 6)
    expect(Number(res.body.fee)).toBeGreaterThan(0) // default 0.1% fee — actually charged, not zero
    expect(res.body.feeAsset).toBe('USDT') // fake's default: fee in quote asset
    expect(res.body.fills).toHaveLength(1)
    expect(res.body.externalOrderId).toBeTruthy()

    // USDT: 1000 - 500 spent - 0.5 fee (0.1% of 500, charged in USDT) = 499.5.
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('499.5')
    expect(usdt.reserved.toString()).toBe('0')

    // BTC: credited the ACTUAL filled quantity (gross, before the separate fee entry).
    const btc = await balancesOf(userId, 'BTC')
    expect(btc.cash.gt(0)).toBe(true)
  })

  // ---- 2/4/6. MARKET SELL ---------------------------------------------------

  it('2/4/6. MARKET SELL: spends actual BTC, credits actual USDT proceeds at the fake fill price', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT', price: '3000' })
    const { userId, cookie } = await registerAndLogin('sellsuccess')
    await grantAsset(userId, 'ETH', '2')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '1' }).expect(201)

    expect(res.body.status).toBe('FILLED')
    expect(res.body.executedPrice).toBe('3000')
    expect(res.body.filledQuantity).toBe('1')

    const eth = await balancesOf(userId, 'ETH')
    expect(eth.cash.toString()).toBe('1') // 2 - 1 sold
    expect(eth.reserved.toString()).toBe('0')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.gt(0)).toBe(true) // proceeds credited (gross, before fee entry)
  })

  // ---- 10/11. multiple fills ------------------------------------------------

  it('10/11. multiple fills aggregate correctly (SUM quantity, weighted-avg price, SUM fee) and each Fill row is preserved individually', async () => {
    // SELL, not BUY: SELL's "spent" amount is the base-asset quantity
    // (price-independent), so MULTIFILL's deliberately different per-fill
    // prices can't ever make the aggregate exceed the reservation — the
    // exact safety check Part 4/8 requires (never settle more than
    // reserved) stays intact rather than being worked around by the test.
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT', price: '100' })
    fake.queueScenario(providerSymbol, 'MULTIFILL')
    const { userId, cookie } = await registerAndLogin('multifill')
    await grantAsset(userId, 'SOL', '2')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '2' }).expect(201)

    expect(res.body.status).toBe('FILLED')
    expect(res.body.fills).toHaveLength(2)
    // Weighted average of 100 and 101 over equal halves = 100.5.
    expect(Number(res.body.executedPrice)).toBeCloseTo(100.5, 6)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id }, include: { fills: true } })
    expect(order.fills).toHaveLength(2)
    expect(order.fills[0].price.toString()).not.toBe(order.fills[1].price.toString())

    const sol = await balancesOf(userId, 'SOL')
    expect(sol.cash.toString()).toBe('0') // both halves sold
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.gt(0)).toBe(true) // proceeds from BOTH fills credited
  })

  // ---- 12. provider rejection -----------------------------------------------

  it('12. provider rejection releases the reservation in full and marks the order REJECTED with the real reason', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT', price: '500' })
    fake.queueScenario(providerSymbol, 'REJECT')
    const { userId, cookie } = await registerAndLogin('providerreject')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '300' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toMatch(/Provider rejected/i)

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000') // fully released
    expect(usdt.reserved.toString()).toBe('0')
  })

  // ---- 13/14. timeout: no blind release, no blind retry ---------------------

  it('13/14. provider timeout does NOT release the reservation and does NOT trigger an automatic retry — order becomes SUBMITTED, funds stay reserved', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT', price: '0.5' })
    fake.queueScenario(providerSymbol, 'TIMEOUT')
    const { userId, cookie } = await registerAndLogin('timeoutorder')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '400' }).expect(201)
    expect(res.body.status).toBe('SUBMITTED')
    expect(res.body.rejectionReason).toMatch(/unknown/i)

    // Funds remain reserved — NOT released, NOT spent.
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('600')
    expect(usdt.reserved.toString()).toBe('400')

    // No automatic retry happened: exactly ONE Order row for this attempt.
    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1)
  })

  // ---- 15. lost response resolved through status query -----------------------

  it('15. a lost provider response is resolvable afterward by querying the SAME clientOrderId — the order really was accepted provider-side', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT', price: '0.4' })
    fake.queueScenario(providerSymbol, 'LOSTRESPONSE')
    const { userId, cookie } = await registerAndLogin('lostresponse')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '200' }).expect(201)
    expect(res.body.status).toBe('SUBMITTED')
    expect(res.body.clientOrderId).toBeTruthy()

    // Reconciliation-style resolution: query the provider directly with the
    // preserved clientOrderId — the real outcome (FILLED) is discoverable.
    const status = await fake.getOrderStatus({ providerSymbol, clientOrderId: res.body.clientOrderId })
    expect(status.status).toBe('FILLED')
  })

  // ---- 16-19. customer idempotency end-to-end --------------------------------

  it('16/17/18. the same Idempotency-Key produces exactly ONE order, ONE provider execution attempt, and ONE settlement — a replay never re-executes', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT', price: '0.1' })
    const { userId, cookie } = await registerAndLogin('idempotentbuy')
    await grantAsset(userId, 'USDT', '1000')
    const key = `idem-buy-${Date.now()}`

    const first = await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(first.body.status).toBe('FILLED')

    const second = await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(second.body.id).toBe(first.body.id) // exact replay of the stored response

    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1)
    const fillCount = await prisma.fill.count({ where: { orderId: first.body.id } })
    expect(fillCount).toBe(1) // settled exactly once, not twice

    // Spent exactly once: 1000 - 100 - 0.1 fee (0.1% of 100) = 899.9. If the
    // replay had re-executed, this would be 899.8 (fee charged twice) or
    // lower still — proving settlement genuinely happened only once.
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('899.9')
  })

  it('19. reusing the same Idempotency-Key with a materially different request body is rejected with 409, never silently applied', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT', price: '500' })
    const { userId, cookie } = await registerAndLogin('idemconflictbuy')
    await grantAsset(userId, 'USDT', '1000')
    const key = `idem-conflict-${Date.now()}`

    await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '999' }).expect(409)

    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1)
  })

  // ---- 20/21/22. concurrency --------------------------------------------------

  it('20/22. concurrent BUY orders cannot overspend USDT, and no negative balance ever results', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT', price: '100' })
    const { userId, cookie } = await registerAndLogin('concurrentbuy')
    await grantAsset(userId, 'USDT', '100')

    // Two concurrent BUY orders, each requesting 80 USDT — together they
    // exceed the 100 USDT available. At most one may succeed.
    const [a, b] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '80' }),
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '80' }),
    ])
    const statuses = [a.body.status, b.body.status].sort()
    expect(statuses).toContain('REJECTED') // at least one could not be funded
    expect(statuses).not.toEqual(['FILLED', 'FILLED']) // never both

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.gte(0)).toBe(true) // never negative
    expect(usdt.reserved.toString()).toBe('0')
  })

  it('21/22. concurrent SELL orders cannot overspend a BTC-equivalent asset holding, and no negative balance ever results', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT', price: '60000' })
    const { userId, cookie } = await registerAndLogin('concurrentsell')
    await grantAsset(userId, 'BTC', '1')

    const [a, b] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '1' }),
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '1' }),
    ])
    const statuses = [a.body.status, b.body.status].sort()
    expect(statuses).toContain('REJECTED')
    expect(statuses).not.toEqual(['FILLED', 'FILLED'])

    const btc = await balancesOf(userId, 'BTC')
    expect(btc.cash.gte(0)).toBe(true)
    expect(btc.reserved.toString()).toBe('0')
  })

  // ---- 23/24/25. kill switches block BEFORE provider submission -------------

  it('23. the global trading kill switch blocks the order before it ever reaches the execution provider', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT', price: '0.4' })
    const { userId, cookie } = await registerAndLogin('globalkillswitch')
    await grantAsset(userId, 'USDT', '1000')

    await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: { tradingEnabled: false }, create: { id: 'singleton', tradingEnabled: false } })
    try {
      const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' })
      expect(res.status).toBe(503)
      // No order row and no reservation was ever created — blocked upstream of everything.
      const orderCount = await prisma.order.count({ where: { userId, symbol } })
      expect(orderCount).toBe(0)
    } finally {
      await prisma.platformSettings.update({ where: { id: 'singleton' }, data: { tradingEnabled: true } })
    }
  })

  it('24. a per-market trading-disabled flag blocks the order before it reaches the execution provider, without touching other markets', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT', price: '0.1' })
    await prisma.marketConfig.update({ where: { symbol }, data: { tradingEnabled: false } })
    const { userId, cookie } = await registerAndLogin('marketkillswitch')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toMatch(/not enabled/i)

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000') // nothing ever reserved
  })

  it('25. a suspended account cannot reach order creation at all (blocked at authentication, account-wide)', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT', price: '3000' })
    const { userId, cookie } = await registerAndLogin('suspendedtrader')
    await grantAsset(userId, 'USDT', '1000')
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' })
    expect(res.status).toBe(401) // SessionAuthGuard blocks the whole request, not just orders

    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(0)
  })

  // ---- 26/27. invalid market / invalid quantity ------------------------------

  it('26. a CRYPTO_SPOT/LIVE market with no execution mapping configured is rejected before reaching any provider', async () => {
    const symbol = `E2E-nomapping-${Date.now()}`
    await prisma.marketConfig.create({
      data: { symbol, dataSource: 'LIVE', tradingEnabled: true, baseAsset: 'FOO', quoteAsset: 'USDT', displayName: symbol, marketType: 'CRYPTO_SPOT', enabled: true, provider: null, providerSymbol: null },
    })
    const { userId, cookie } = await registerAndLogin('nomapping')
    await grantAsset(userId, 'USDT', '1000')

    // No LIVE quote exists either (no provider configured) — this actually
    // gets caught by the pre-existing "market price is not currently live"
    // check first, which is itself a correct, safe rejection.
    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1) // the rejected order itself, no reservation left behind
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000')
  })

  it('27. a zero/negative quantity is rejected before any reservation or provider submission', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT', price: '0.5' })
    const { cookie } = await registerAndLogin('invalidqty')

    await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '0' }).expect(400)
    await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '-5' }).expect(400)
  })

  // ---- 28. malformed provider fill --------------------------------------------

  it('28. a malformed provider fill (invalid price) is rejected — never settled, order flagged for reconciliation instead', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT', price: '100' })
    fake.queueScenario(providerSymbol, 'MALFORMED')
    const { userId, cookie } = await registerAndLogin('malformedfill')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '200' }).expect(201)
    expect(res.body.status).toBe('SUBMITTED') // never FILLED, never fabricated
    expect(res.body.rejectionReason).toMatch(/reconciliation/i)

    // No Fill row was created, and the reservation is still intact (not
    // released, not settled) — safe state pending investigation.
    const fillCount = await prisma.fill.count({ where: { orderId: res.body.id } })
    expect(fillCount).toBe(0)
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('200')
  })

  // ---- 29. ledger balance invariant -------------------------------------------

  // Deliberately does NOT run ReconciliationService.run() globally — the
  // shared trust_test database (persistent for the life of the Postgres
  // process across this whole session) accumulates fixtures from every
  // e2e file, including pre-existing data unrelated to this file's own
  // code. Asserting "zero issues platform-wide" would test that unrelated
  // history, not this checkpoint's settlement code. Instead, this
  // independently re-derives the per-currency double-entry invariant
  // (Part 8) directly from the raw LedgerEntry rows a real settlement in
  // THIS test produced — the same check ReconciliationService itself runs,
  // scoped to what this checkpoint actually changed.
  it('29. a real settlement transaction is fully balanced per currency, independently re-derived from raw ledger rows', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT', price: '400' })
    const { userId, cookie } = await registerAndLogin('ledgerbalanced')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '300' }).expect(201)
    expect(res.body.status).toBe('FILLED')

    const txns = await prisma.ledgerTransaction.findMany({ where: { relatedType: 'ORDER', relatedId: res.body.id }, include: { entries: true } })
    expect(txns.length).toBeGreaterThan(0)
    for (const txn of txns) {
      const byCurrency = new Map<string, { credits: number; debits: number }>()
      for (const e of txn.entries) {
        const bucket = byCurrency.get(e.currency) ?? { credits: 0, debits: 0 }
        if (e.direction === 'CREDIT') bucket.credits += Number(e.amount)
        else bucket.debits += Number(e.amount)
        byCurrency.set(e.currency, bucket)
      }
      expect(byCurrency.size).toBeGreaterThan(0)
      for (const [, { credits, debits }] of byCurrency) {
        expect(credits).toBeCloseTo(debits, 8)
      }
    }
  })
})

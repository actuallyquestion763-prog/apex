import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Decimal } from '@prisma/client/runtime/library'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6F Checkpoint D — the complete LIMIT order lifecycle (OPEN,
// PARTIALLY_FILLED, FILLED, CANCEL_PENDING, CANCELLED) through
// FakeExecutionProvider exclusively. Every market here is a synthetic,
// per-test-unique TRUST symbol mapped to a real Binance providerSymbol for
// genuine live display-quote data (Phase 6C, unchanged) — execution always
// goes through the injected fake, never a real exchange, exactly as in
// Checkpoint C's spot-execution.e2e-spec.ts.
describe('LIMIT orders — resting, partial fills, cancellation (real PostgreSQL, FakeExecutionProvider)', () => {
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

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Limit Order Test' })
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
    const symbol = `LMT${marketSeq}-${opts.baseAsset}/${opts.quoteAsset}-${Date.now()}`
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

  async function balancesOf(userId: string, currency: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    return ledger.getAccountBalances(account.id, currency)
  }

  // ---- 1/3. LIMIT BUY accepted, stays OPEN, reserves quote --------------

  it('1/3. LIMIT BUY is accepted, remains OPEN, and reserves the full quote amount at the limit price', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitbuyopen')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '600', orderType: 'LIMIT', limitPrice: '60000' })
      .expect(201)

    expect(res.body.status).toBe('OPEN')
    expect(res.body.requestedPrice).toBe('60000')
    expect(res.body.filledQuantity).toBe('0')
    expect(res.body.externalOrderId).toBeTruthy()
    expect(res.body.clientOrderId).toBeTruthy()

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('400') // 1000 - 600 reserved
    expect(usdt.reserved.toString()).toBe('600')
  })

  // ---- 2/4. LIMIT SELL accepted, stays OPEN, reserves base --------------

  it('2/4. LIMIT SELL is accepted, remains OPEN, and reserves the base quantity', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitsellopen')
    await grantAsset(userId, 'ETH', '5')

    const res = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'SELL', quantity: '2', orderType: 'LIMIT', limitPrice: '3500' })
      .expect(201)

    expect(res.body.status).toBe('OPEN')

    const eth = await balancesOf(userId, 'ETH')
    expect(eth.cash.toString()).toBe('3') // 5 - 2 reserved
    expect(eth.reserved.toString()).toBe('2')
  })

  // ---- 5/6/8/9/10. partial fills, remaining reservation, final resolution ----

  it('5/8/9/10. LIMIT BUY: sequential partial fills settle incrementally, protect the remainder, and resolve fully on completion — actual fill prices drive settlement, never the limit price', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('partialfillbuy')
    await grantAsset(userId, 'USDT', '1000')

    // Reserve 600 USDT at limit 60000 -> max 0.01 BTC-equivalent (SOL here, values chosen for round numbers)
    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '600', orderType: 'LIMIT', limitPrice: '60000' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    // Fill 1: 0.0025 SOL @ 59900 = 149.75 USDT — a real price BELOW the
    // limit (allowed for a BUY: fill.price <= limitPrice).
    fake.simulateFill(clientOrderId, '0.0025', '59900')
    const afterFirst = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(afterFirst.body.status).toBe('PARTIALLY_FILLED')
    expect(afterFirst.body.filledQuantity).toBe('0.0025')
    expect(afterFirst.body.executedPrice).toBe('59900')

    let usdt = await balancesOf(userId, 'USDT')
    // Spent so far: 0.0025 * 59900 = 149.75. Remaining reservation: 600 - 149.75 = 450.25.
    expect(usdt.reserved.toString()).toBe('450.25')
    expect(usdt.cash.toString()).toBe('400') // untouched — only reserved shrinks

    // Fill 2: another partial, different price.
    fake.simulateFill(clientOrderId, '0.0025', '59800')
    const afterSecond = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(afterSecond.body.status).toBe('PARTIALLY_FILLED')
    expect(afterSecond.body.filledQuantity).toBe('0.005')
    // Weighted avg of 59900 and 59800 over equal quantities = 59850.
    expect(Number(afterSecond.body.executedPrice)).toBeCloseTo(59850, 6)

    usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('300.75') // 600 - 149.75 - 149.5

    // Fill 3: completes the order (0.005/0.01 SOL still owed at limit 60000 -> total base = 600/60000 = 0.01).
    fake.simulateFill(clientOrderId, '0.005', '59700')
    const final = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(final.body.status).toBe('FILLED')
    expect(final.body.filledQuantity).toBe('0.01')
    expect(final.body.fills).toHaveLength(3)

    // Reservation fully resolved: whatever wasn't spent is back in cash, nothing left reserved.
    usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('0')
    const totalSpent = new Decimal('0.0025').times('59900').plus(new Decimal('0.0025').times('59800')).plus(new Decimal('0.005').times('59700'))
    expect(usdt.cash.toString()).toBe(new Decimal('1000').minus(totalSpent).toString())
  })

  // ---- 6/7. LIMIT SELL partial fills over time ----------------------------

  it('6/7. LIMIT SELL: partial fills settle incrementally and aggregate correctly over multiple sync calls', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('partialfillsell')
    await grantAsset(userId, 'ADA', '10')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'SELL', quantity: '10', orderType: 'LIMIT', limitPrice: '0.40' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '4', '0.41') // above limit — fine for a SELL (>=)
    let synced = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(synced.body.status).toBe('PARTIALLY_FILLED')
    expect(synced.body.filledQuantity).toBe('4')

    let ada = await balancesOf(userId, 'ADA')
    expect(ada.reserved.toString()).toBe('6') // 10 - 4 filled

    fake.simulateFill(clientOrderId, '6', '0.42')
    synced = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(synced.body.status).toBe('FILLED')
    expect(synced.body.filledQuantity).toBe('10')

    ada = await balancesOf(userId, 'ADA')
    expect(ada.reserved.toString()).toBe('0')
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('4.16') // 4*0.41 + 6*0.42 = 1.64 + 2.52
  })

  // ---- 11/12. limit-price protection ---------------------------------------

  it('11. a provider fill priced ABOVE the limit on a BUY is never settled — flagged for reconciliation instead', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('invalidbuyfill')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '500', orderType: 'LIMIT', limitPrice: '500' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '1', '501') // 501 > limit 500 — invalid for a BUY
    const synced = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)

    expect(synced.body.status).toBe('OPEN') // status preserved, never advanced on a bad fill
    expect(synced.body.filledQuantity).toBe('0')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('500') // untouched — nothing settled
    const fillCount = await prisma.fill.count({ where: { orderId } })
    expect(fillCount).toBe(0)
  })

  it('12. a provider fill priced BELOW the limit on a SELL is never settled', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('invalidsellfill')
    await grantAsset(userId, 'XRP', '100')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'SELL', quantity: '100', orderType: 'LIMIT', limitPrice: '0.50' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '50', '0.49') // 0.49 < limit 0.50 — invalid for a SELL
    const synced = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)

    expect(synced.body.status).toBe('OPEN')
    const xrp = await balancesOf(userId, 'XRP')
    expect(xrp.reserved.toString()).toBe('100')
  })

  // ---- 13/14. fill deduplication -------------------------------------------

  it('13. the SAME provider fill returned again on a later sync is never applied twice', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('dupfillsync')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '0.10' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '500', '0.10') // fills the full 1000 DOGE... deliberately partial: 500/1000
    const first = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(first.body.status).toBe('PARTIALLY_FILLED')
    expect(first.body.filledQuantity).toBe('500')

    // Sync AGAIN with no new fill queued — getOrderFills returns the exact
    // same list (one fill) the fake already recorded. Must be a pure no-op.
    const second = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(second.body.filledQuantity).toBe('500') // unchanged, not doubled
    expect(second.body.fills).toHaveLength(1)

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('50') // 100 - (500*0.10=50) spent ONCE, not twice
  })

  it('14. concurrent synchronization of the same order cannot duplicate settlement', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('concurrentsync')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '400', orderType: 'LIMIT', limitPrice: '0.40' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '500', '0.40') // partial: 500 of 1000 max base qty
    const [a, b] = await Promise.all([
      request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie),
      request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie),
    ])
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    const fillCount = await prisma.fill.count({ where: { orderId } })
    expect(fillCount).toBe(1) // exactly one Fill row despite two concurrent syncs

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('200') // 400 - (500*0.40=200) spent ONCE
  })

  // ---- 15/16. cancellation releases remaining reservation --------------------

  it('15. cancelling a still-OPEN LIMIT order releases the full reservation', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('cancelfullopen')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '700', orderType: 'LIMIT', limitPrice: '100' })
      .expect(201)
    const orderId = created.body.id

    const cancelled = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(cancelled.body.status).toBe('CANCELLED')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000')
    expect(usdt.reserved.toString()).toBe('0')
  })

  it('16. cancelling after a partial fill releases only the remainder, never double-releasing the filled portion', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('cancelpartial')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '1000', orderType: 'LIMIT', limitPrice: '500' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '1.2', '500') // spends 600 of the 1000 reserved
    await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)

    let usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('400') // 1000 - 600

    const cancelled = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(cancelled.body.status).toBe('CANCELLED')
    expect(cancelled.body.filledQuantity).toBe('1.2') // the filled portion stays filled/settled

    usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('0')
    expect(usdt.cash.toString()).toBe('400') // exactly the unfilled remainder returned — no extra money created
  })

  // ---- 17. cancel-vs-fill race ------------------------------------------------

  it('17. cancel-vs-fill race: if the provider reports FILLED, the fill wins — the order is never left CANCELLED', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('cancelvsfill')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '900', orderType: 'LIMIT', limitPrice: '3000' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    // The order fills COMPLETELY before the cancel request is processed —
    // the fake's own cancelOrder() already refuses to overwrite FILLED
    // (Checkpoint B's proven cancel-vs-fill guarantee), so this proves the
    // guarantee holds through the FULL OrdersService cancellation flow too.
    fake.simulateFill(clientOrderId, '0.3', '3000')

    const cancelled = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(cancelled.body.status).toBe('FILLED')
    expect(cancelled.body.status).not.toBe('CANCELLED')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('0') // fully resolved via the fill path, not cancellation
  })

  // ---- 18/19. terminal-state protection ---------------------------------------

  it('18. a FILLED order cannot be cancelled — cancel is an idempotent no-op', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('cancelfilled')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '600', orderType: 'LIMIT', limitPrice: '60000' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId
    fake.simulateFill(clientOrderId, '0.01', '60000')
    const filled = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(filled.body.status).toBe('FILLED')

    const afterCancelAttempt = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(afterCancelAttempt.body.status).toBe('FILLED') // unchanged — no illegal transition
  })

  it('19. a CANCELLED order cannot be filled — a subsequent sync with new fills is ignored', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('fillcancelled')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '600', orderType: 'LIMIT', limitPrice: '100' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    const cancelled = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(cancelled.body.status).toBe('CANCELLED')

    // Provider (hypothetically) reports a fill after the fact — the ledger
    // was already fully released; a real exchange would not do this after
    // confirming CANCELED, but TRUST's own state machine must not regress
    // out of CANCELLED regardless.
    fake.simulateFill(clientOrderId, '1', '100')
    const afterSync = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(afterSync.body.status).toBe('CANCELLED') // terminal — syncOrder() no-ops on a terminal order
  })

  // ---- 20. repeated cancellation is idempotent --------------------------------

  it('20. repeated cancellation of the same order does not double-release or duplicate audit state', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('doublecancel')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '500', orderType: 'LIMIT', limitPrice: '1' })
      .expect(201)
    const orderId = created.body.id

    const first = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(first.body.status).toBe('CANCELLED')
    const second = await request(server).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).expect(201)
    expect(second.body.status).toBe('CANCELLED')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000') // released exactly once, not "twice" (would be impossible anyway, but confirms no error/side effect)
  })

  // ---- 21-24. customer idempotency -------------------------------------------

  it('21/22/23. the same Idempotency-Key produces exactly ONE LIMIT order, ONE reservation, ONE provider order', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('idempotentlimit')
    await grantAsset(userId, 'USDT', '1000')
    const key = `idem-limit-${Date.now()}`

    const first = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ symbol, side: 'BUY', quantity: '400', orderType: 'LIMIT', limitPrice: '400' })
      .expect(201)
    expect(first.body.status).toBe('OPEN')

    const second = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ symbol, side: 'BUY', quantity: '400', orderType: 'LIMIT', limitPrice: '400' })
      .expect(201)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.clientOrderId).toBe(first.body.clientOrderId)

    const orderCount = await prisma.order.count({ where: { userId, symbol } })
    expect(orderCount).toBe(1)
    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('400') // reserved exactly once
  })

  it('24. a different request body with the same Idempotency-Key returns 409', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    const { cookie } = await registerAndLogin('idemconflictlimit')
    const key = `idem-limit-conflict-${Date.now()}`

    await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '1' })
      .expect(201)

    await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ symbol, side: 'BUY', quantity: '999', orderType: 'LIMIT', limitPrice: '1' })
      .expect(409)
  })

  // ---- 25/26/34. concurrency ---------------------------------------------------

  it('25/34. concurrent LIMIT BUY orders cannot overspend USDT, and no negative balance ever results', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('concurrentlimitbuy')
    await grantAsset(userId, 'USDT', '1000')

    const [a, b] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '700', orderType: 'LIMIT', limitPrice: '100' }),
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '700', orderType: 'LIMIT', limitPrice: '100' }),
    ])
    const statuses = [a.body.status, b.body.status].sort()
    expect(statuses).toContain('REJECTED')
    expect(statuses).not.toEqual(['OPEN', 'OPEN'])

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.gte(0)).toBe(true)
  })

  it('26/34. concurrent LIMIT SELL orders cannot overspend a base-asset holding, and no negative balance ever results', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('concurrentlimitsell')
    await grantAsset(userId, 'BTC', '1')

    const [a, b] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '1', orderType: 'LIMIT', limitPrice: '60000' }),
      request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '1', orderType: 'LIMIT', limitPrice: '60000' }),
    ])
    const statuses = [a.body.status, b.body.status].sort()
    expect(statuses).toContain('REJECTED')
    expect(statuses).not.toEqual(['OPEN', 'OPEN'])

    const btc = await balancesOf(userId, 'BTC')
    expect(btc.cash.gte(0)).toBe(true)
  })

  // ---- 27/28. kill switches ------------------------------------------------------

  it('27. the global trading kill switch blocks LIMIT order submission before it reaches the provider', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitglobalkill')
    await grantAsset(userId, 'USDT', '1000')

    await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: { tradingEnabled: false }, create: { id: 'singleton', tradingEnabled: false } })
    try {
      const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '1' })
      expect(res.status).toBe(503)
      const orderCount = await prisma.order.count({ where: { userId, symbol } })
      expect(orderCount).toBe(0)
    } finally {
      await prisma.platformSettings.update({ where: { id: 'singleton' }, data: { tradingEnabled: true } })
    }
  })

  it('28. a suspended account cannot submit a LIMIT order at all (blocked at authentication)', async () => {
    const providerSymbol = 'XRPUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'XRP', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitsuspended')
    await grantAsset(userId, 'USDT', '1000')
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100', orderType: 'LIMIT', limitPrice: '1' })
    expect(res.status).toBe(401)
  })

  // ---- 29/30/31. provider rejection / timeout / unknown-state safety ---------

  it('29. provider rejection of a LIMIT submission releases the reservation and marks REJECTED', async () => {
    const providerSymbol = 'BNBUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BNB', quoteAsset: 'USDT' })
    fake.queueScenario(providerSymbol, 'REJECT')
    const { userId, cookie } = await registerAndLogin('limitreject')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '400', orderType: 'LIMIT', limitPrice: '500' }).expect(201)
    expect(res.body.status).toBe('REJECTED')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.cash.toString()).toBe('1000')
    expect(usdt.reserved.toString()).toBe('0')
  })

  it('30. provider timeout on LIMIT submission preserves the reservation — order becomes SUBMITTED, not OPEN or REJECTED', async () => {
    const providerSymbol = 'ADAUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ADA', quoteAsset: 'USDT' })
    fake.queueScenario(providerSymbol, 'TIMEOUT')
    const { userId, cookie } = await registerAndLogin('limittimeout')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '300', orderType: 'LIMIT', limitPrice: '1' }).expect(201)
    expect(res.body.status).toBe('SUBMITTED')

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('300') // preserved, not released
  })

  it('31. an unknown provider status during sync leaves the order in a safe, unchanged state', async () => {
    const providerSymbol = 'SOLUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'SOL', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitunknownstatus')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '500', orderType: 'LIMIT', limitPrice: '100' })
      .expect(201)
    const orderId = created.body.id

    fake.queueScenario(providerSymbol, 'UNKNOWN_STATUS')
    const synced = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(synced.body.status).toBe('OPEN') // unchanged — provider couldn't answer, nothing was fabricated

    const usdt = await balancesOf(userId, 'USDT')
    expect(usdt.reserved.toString()).toBe('500') // untouched
  })

  // ---- 32. multiple fees aggregate correctly -----------------------------------

  it('32. fees from multiple fills aggregate correctly, each preserved on its own Fill row', async () => {
    const providerSymbol = 'DOGEUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'DOGE', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('multifee')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '1000', orderType: 'LIMIT', limitPrice: '0.10' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '5000', '0.10', '0.30', 'USDT')
    await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    fake.simulateFill(clientOrderId, '5000', '0.10', '0.25', 'USDT')
    const final = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)

    expect(final.body.status).toBe('FILLED')
    expect(Number(final.body.fee)).toBeCloseTo(0.55, 8) // 0.30 + 0.25, preserved not overwritten
    const fills = await prisma.fill.findMany({ where: { orderId } })
    expect(fills).toHaveLength(2)
    expect(fills.map((f) => f.fee.toString()).sort()).toEqual(['0.25', '0.3'])
  })

  // ---- 33. ledger balance invariant -----------------------------------------

  it('33. a real LIMIT settlement transaction (with fee) is fully balanced per currency', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT' })
    const { userId, cookie } = await registerAndLogin('limitledgerbalance')
    await grantAsset(userId, 'USDT', '1000')

    const created = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol, side: 'BUY', quantity: '600', orderType: 'LIMIT', limitPrice: '60000' })
      .expect(201)
    const orderId = created.body.id
    const clientOrderId = created.body.clientOrderId

    fake.simulateFill(clientOrderId, '0.01', '60000', '0.5', 'USDT')
    const res = await request(server).post(`/orders/${orderId}/sync`).set('Cookie', cookie).expect(201)
    expect(res.body.status).toBe('FILLED')

    const txns = await prisma.ledgerTransaction.findMany({ where: { relatedType: 'ORDER', relatedId: orderId }, include: { entries: true } })
    expect(txns.length).toBeGreaterThan(0)
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
})

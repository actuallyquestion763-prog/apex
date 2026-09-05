import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Decimal } from '@prisma/client/runtime/library'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { OptionsService } from '../src/options/options.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Fixed-Time Options Trading — a separate product from spot Orders. Every
// test market here uses provider: 'SIMULATED' with a providerSymbol drawn
// from SimulatedProvider's own STARTING_PRICES map (see
// src/markets/providers/simulated.provider.ts) so MarketDataService.getQuote()
// always succeeds with a real, working (if randomly-walking) price — exactly
// the same technique existing e2e suites use for spot. Deterministic
// WIN/LOSS/DRAW outcomes are produced via the DEMO/TEST requestedResultMode
// override (Part 26), never by trying to predict the random walk.
//
// settleTrade() is called directly on the injected OptionsService rather
// than waiting for the background expiry sweep — the sweep is disabled
// entirely under NODE_ENV=test (see options.service.ts's onModuleInit) so
// tests are never timing-dependent.
describe('Fixed-Time Options Trading (real PostgreSQL, SimulatedProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let options: OptionsService
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
    options = app.get(OptionsService)

    const email = uniqueEmail('optionssuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superSecret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)

    // Platform-wide options kill switch: OFF by default (Part: new product
    // safe-by-default) — turn it ON once for this whole suite via the REAL
    // step-up-gated admin endpoint (not a direct Prisma write), so this also
    // proves the endpoint itself works before anything else runs.
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'enable for options e2e suite', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  afterAll(async () => {
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'restore after options e2e suite', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
    await app.close()
  })

  // Defaults to SUPER_ADMIN for historical reasons (options trading used to
  // require that role — Phase F production audit). Part 31 removed that
  // restriction: OptionsController now only requires SessionAuthGuard, so a
  // plain USER can reach every route here too (see W2). Kept as the default
  // here anyway since most tests in this file are testing the OPTIONS
  // FEATURE itself (settlement math, ledger correctness, idempotency, etc.),
  // not role access, and SUPER_ADMIN works equally well for that — no need
  // to touch every call site. Tests that specifically care about a
  // genuinely non-privileged account (W-W4, below) pass role: 'USER'
  // explicitly.
  async function registerAndLogin(prefix: string, role: 'USER' | 'SUPER_ADMIN' = 'SUPER_ADMIN') {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Options Test', role })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'options test fixture asset grant',
      idempotencyKey: `options-fixture-grant-${userId}-${currency}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  let marketSeq = 0
  // provider/providerSymbol default to a working SIMULATED feed
  // (BTCUSDT is always in SimulatedProvider's STARTING_PRICES map) so
  // MarketDataService.getQuote() succeeds — pass configured: false for the
  // "no provider mapping exists" price-failure scenarios.
  async function setupOptionMarket(opts: {
    currency?: string
    minInvestment?: string
    maxInvestment?: string
    durations?: { durationSeconds: number; payoutPercent: string; enabled?: boolean }[]
    configured?: boolean
    marketEnabled?: boolean
  } = {}) {
    marketSeq += 1
    const symbol = `OPT${marketSeq}-TEST/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: opts.configured === false
        ? { symbol, dataSource: 'SIMULATED', tradingEnabled: true, enabled: true, baseAsset: 'TEST', quoteAsset: 'USDT', marketType: 'CRYPTO_SPOT' }
        : { symbol, dataSource: 'SIMULATED', tradingEnabled: true, enabled: true, baseAsset: 'TEST', quoteAsset: 'USDT', marketType: 'CRYPTO_SPOT', provider: 'SIMULATED', providerSymbol: 'BTCUSDT' },
    })
    const market = await prisma.optionMarket.create({
      data: {
        symbol,
        enabled: opts.marketEnabled ?? true,
        currency: opts.currency ?? 'USDT',
        minInvestment: new Decimal(opts.minInvestment ?? '1'),
        maxInvestment: opts.maxInvestment ? new Decimal(opts.maxInvestment) : null,
      },
    })
    const durations = opts.durations ?? [{ durationSeconds: 30, payoutPercent: '5' }]
    for (const d of durations) {
      await prisma.optionDuration.create({
        data: { optionMarketId: market.id, durationSeconds: d.durationSeconds, payoutPercent: new Decimal(d.payoutPercent), enabled: d.enabled ?? true },
      })
    }
    return symbol
  }

  function createTrade(cookie: string, body: Record<string, unknown>) {
    return request(server).post('/options/trades').set('Cookie', cookie).send(body)
  }

  // ---- A. Option creation ---------------------------------------------------

  it('A. creates an ACTIVE option trade with an authoritative backend-sourced entry price, reserving the investment', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('create')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.entryPrice).toBeTruthy()
    expect(Number(res.body.entryPrice)).toBeGreaterThan(0)
    expect(res.body.payoutPercentSnapshot).toBe('5')
    expect(res.body.currency).toBe('USDT')

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.cash.toString()).toBe('900')
    expect(balances.reserved.toString()).toBe('100')
  })

  // ---- B/C/D. Amount validation ----------------------------------------------

  it('B. a non-positive investment is rejected with 400 and creates zero rows', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('badamount')
    await grantAsset(userId, 'USDT', '1000')
    const before = await prisma.optionTrade.count({ where: { userId } })

    await createTrade(cookie, { symbol, direction: 'BUY', investment: '0', durationSeconds: 30 }).expect(400)
    await createTrade(cookie, { symbol, direction: 'BUY', investment: '-10', durationSeconds: 30 }).expect(400)

    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(before)
  })

  it('C. an investment below the asset minimum is rejected, zero rows created', async () => {
    const symbol = await setupOptionMarket({ minInvestment: '50' })
    const { userId, cookie } = await registerAndLogin('minamount')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/MIN_INVESTMENT_NOT_MET/)
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(0)
  })

  it('D. an investment above the asset maximum is rejected, zero rows created', async () => {
    const symbol = await setupOptionMarket({ maxInvestment: '50' })
    const { userId, cookie } = await registerAndLogin('maxamount')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/MAX_INVESTMENT_EXCEEDED/)
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(0)
  })

  // ---- D2. Amount-tier gating (Part 29) — duration/payout are resolved
  // automatically from the amount on the trading UI (never manually
  // clicked/typed); this is the server-side enforcement that a submitted
  // (duration, investment) pair is a legitimate tier, never trusting
  // whatever the client resolved and sent. ------------------------------

  it('D2. an investment below a duration\'s configured tier minimum is rejected, zero rows created — even though the market-wide minimum is satisfied', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 90, payoutPercent: '15' }] })
    const market = await prisma.optionMarket.findUniqueOrThrow({ where: { symbol } })
    await prisma.optionDuration.update({
      where: { optionMarketId_durationSeconds: { optionMarketId: market.id, durationSeconds: 90 } },
      data: { minAmount: new Decimal('100') },
    })
    const { userId, cookie } = await registerAndLogin('tiertoolow')
    await grantAsset(userId, 'USDT', '1000')

    // $10 clears the market-wide minInvestment (default 1) but not the 90s
    // tier's own $100 threshold — must still be rejected.
    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 90 }).expect(400)
    expect(res.body.message).toMatch(/DURATION_MIN_AMOUNT_NOT_MET/)
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(0)
  })

  it('D3. an investment meeting a duration\'s configured tier minimum is accepted', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 90, payoutPercent: '15' }] })
    const market = await prisma.optionMarket.findUniqueOrThrow({ where: { symbol } })
    await prisma.optionDuration.update({
      where: { optionMarketId_durationSeconds: { optionMarketId: market.id, durationSeconds: 90 } },
      data: { minAmount: new Decimal('100') },
    })
    const { userId, cookie } = await registerAndLogin('tierok')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 90 }).expect(201)
    expect(res.body.status).toBe('ACTIVE')
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(1)
  })

  it('D4. a duration with no configured tier minimum (default 0) is never gated by amount', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('tierunset')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '1', durationSeconds: 30 }).expect(201)
    expect(res.body.status).toBe('ACTIVE')
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(1)
  })

  it('D5. GET /options/markets exposes each duration\'s configured tier minimum, so the trading UI can resolve duration/profit from the amount', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }, { durationSeconds: 90, payoutPercent: '15' }] })
    const market = await prisma.optionMarket.findUniqueOrThrow({ where: { symbol } })
    await prisma.optionDuration.update({
      where: { optionMarketId_durationSeconds: { optionMarketId: market.id, durationSeconds: 90 } },
      data: { minAmount: new Decimal('100') },
    })
    const { cookie } = await registerAndLogin('tiervisible')

    const res = await request(server).get('/options/markets').set('Cookie', cookie).expect(200)
    const found = res.body.find((m: any) => m.symbol === symbol)
    const d30 = found.durations.find((d: any) => d.durationSeconds === 30)
    const d90 = found.durations.find((d: any) => d.durationSeconds === 90)
    expect(d30.minAmount).toBe('0')
    expect(d90.minAmount).toBe('100')
  })

  // ---- E. Insufficient balance ------------------------------------------------

  it('E. insufficient balance is rejected by the BACKEND even though nothing prevents the raw API call — zero rows, zero ledger effect', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('insufficient')
    await grantAsset(userId, 'USDT', '80')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const txnsBefore = await prisma.ledgerTransaction.count({ where: { relatedType: 'OPTION_TRADE' } })

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/INSUFFICIENT_AVAILABLE_BALANCE/)

    expect(await prisma.optionTrade.count({ where: { accountId: account.id } })).toBe(0)
    expect(await prisma.ledgerTransaction.count({ where: { relatedType: 'OPTION_TRADE' } })).toBe(txnsBefore)
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.cash.toString()).toBe('80')
  })

  // ---- F/G. Asset / duration disabled -----------------------------------------

  it('F. a disabled asset rejects new option trades', async () => {
    const symbol = await setupOptionMarket({ marketEnabled: false })
    const { userId, cookie } = await registerAndLogin('assetdisabled')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/ASSET_DISABLED/)
  })

  it('G. a disabled duration rejects new option trades for that asset', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5', enabled: false }, { durationSeconds: 60, payoutPercent: '7' }] })
    const { userId, cookie } = await registerAndLogin('durationdisabled')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/DURATION_DISABLED/)
    // The still-enabled 60s duration on the SAME asset works fine.
    await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 60 }).expect(201)
  })

  // ---- H. Payout snapshot -----------------------------------------------------

  it('H. changing an asset\'s payout after a trade is placed never changes that trade\'s already-snapshotted payout', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('snapshot')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)
    expect(trade.body.payoutPercentSnapshot).toBe('5')

    await request(server)
      .patch(`/admin/options/markets/${encodeURIComponent(symbol)}/durations`)
      .set('Cookie', superCookie)
      .send({ durationSeconds: 30, payoutPercent: '25' })
      .expect(200)

    const refetched = await request(server).get(`/options/trades/${trade.body.id}`).set('Cookie', cookie).expect(200)
    expect(refetched.body.payoutPercentSnapshot).toBe('5')

    // A NEW trade placed after the change uses the NEW payout.
    const trade2 = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
    expect(trade2.body.payoutPercentSnapshot).toBe('25')
  })

  // ---- I/J/K/L/M. WIN/LOSS/DRAW settlement (DEMO/TEST forced) -----------------

  it('I. BUY + FORCE_WIN settles WIN — investment released plus profit paid from system revenue', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('buywin')
    await grantAsset(userId, 'USDT', '1000')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    const settled = await options.settleTrade(trade.body.id)

    expect(settled.status).toBe('SETTLED')
    expect(settled.result).toBe('WIN')
    expect(settled.profitAmount?.toString()).toBe('5')
    expect(settled.returnAmount?.toString()).toBe('105')

    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.reserved.toString()).toBe('0')
    expect(balances.cash.toString()).toBe('1005') // 1000 - 100 reserved + 100 released + 5 profit
  })

  it('J. BUY + FORCE_LOSS settles LOSS — investment moves from reserved to system revenue, nothing returned', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('buyloss')
    await grantAsset(userId, 'USDT', '1000')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_LOSS' }).expect(201)
    const settled = await options.settleTrade(trade.body.id)

    expect(settled.status).toBe('SETTLED')
    expect(settled.result).toBe('LOSS')
    expect(settled.profitAmount?.toString()).toBe('-100')
    expect(settled.returnAmount?.toString()).toBe('0')

    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.reserved.toString()).toBe('0')
    expect(balances.cash.toString()).toBe('900')
  })

  it('K. SELL + FORCE_WIN settles WIN with correct payout math', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '10' }] })
    const { userId, cookie } = await registerAndLogin('sellwin')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'SELL', investment: '200', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    const settled = await options.settleTrade(trade.body.id)
    expect(settled.result).toBe('WIN')
    expect(settled.profitAmount?.toString()).toBe('20')
    expect(settled.returnAmount?.toString()).toBe('220')
  })

  it('L. SELL + FORCE_LOSS settles LOSS', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('sellloss')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'SELL', investment: '50', durationSeconds: 30, requestedResultMode: 'FORCE_LOSS' }).expect(201)
    const settled = await options.settleTrade(trade.body.id)
    expect(settled.result).toBe('LOSS')
  })

  it('M. FORCE_DRAW refunds the exact investment — no profit paid, no loss charged', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('draw')
    await grantAsset(userId, 'USDT', '1000')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_DRAW' }).expect(201)
    const settled = await options.settleTrade(trade.body.id)

    expect(settled.result).toBe('DRAW')
    expect(settled.profitAmount?.toString()).toBe('0')
    expect(settled.returnAmount?.toString()).toBe('100')

    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.cash.toString()).toBe('1000')
    expect(balances.reserved.toString()).toBe('0')
  })

  // ---- N/O/P. Settlement idempotency & concurrency ----------------------------

  it('N/O. calling settleTrade twice sequentially produces exactly one financial effect (idempotent replay, not a double payout)', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('doublesettle')
    await grantAsset(userId, 'USDT', '1000')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    await options.settleTrade(trade.body.id)
    await options.settleTrade(trade.body.id)
    await options.settleTrade(trade.body.id)

    const txnCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `option-settle-${trade.body.id}` } })
    expect(txnCount).toBe(1)
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.cash.toString()).toBe('1005')
  })

  it('P. concurrent settlement attempts for the SAME trade produce exactly one financial effect', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('concurrentsettle')
    await grantAsset(userId, 'USDT', '1000')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    await Promise.all([
      options.settleTrade(trade.body.id),
      options.settleTrade(trade.body.id),
      options.settleTrade(trade.body.id),
      options.settleTrade(trade.body.id),
      options.settleTrade(trade.body.id),
    ])

    const txnCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `option-settle-${trade.body.id}` } })
    expect(txnCount).toBe(1)
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.cash.toString()).toBe('1005')
    const finalTrade = await prisma.optionTrade.findUniqueOrThrow({ where: { id: trade.body.id } })
    expect(finalTrade.status).toBe('SETTLED')
  })

  // ---- Q. Idempotency (trade creation) ----------------------------------------

  it('Q1. same Idempotency-Key + same body replays the same trade; same key + different body is 409', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('idemsame')
    await grantAsset(userId, 'USDT', '1000')
    const key = `options-idem-${Date.now()}`

    const first = await request(server).post('/options/trades').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)
    const replay = await request(server).post('/options/trades').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)
    expect(replay.body.id).toBe(first.body.id)

    await request(server).post('/options/trades').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, direction: 'SELL', investment: '100', durationSeconds: 30 }).expect(409)

    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(1)
  })

  it('Q2. concurrent requests with the SAME Idempotency-Key create exactly one trade and exactly one reservation', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('idemconcurrent')
    await grantAsset(userId, 'USDT', '1000')
    const key = `options-idem-concurrent-${Date.now()}`
    const body = { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }

    const results = await Promise.all(
      Array.from({ length: 5 }).map(() => request(server).post('/options/trades').set('Cookie', cookie).set('Idempotency-Key', key).send(body)),
    )
    for (const r of results) expect(r.status).toBe(201)
    const ids = new Set(results.map((r) => r.body.id))
    expect(ids.size).toBe(1)
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(1)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.reserved.toString()).toBe('100')
  })

  it('Q3. concurrent requests with DIFFERENT Idempotency-Keys create separate trades and separate reservations', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('idemdifferent')
    await grantAsset(userId, 'USDT', '1000')

    const results = await Promise.all(
      Array.from({ length: 3 }).map((_, i) =>
        request(server).post('/options/trades').set('Cookie', cookie).set('Idempotency-Key', `diffkey-${i}-${Date.now()}`).send({ symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }),
      ),
    )
    for (const r of results) expect(r.status).toBe(201)
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(3)
  })

  // ---- R/S/T. Price integrity --------------------------------------------------

  it('R/T. a trade cannot be created when no market-data provider is configured for the asset (price unavailable)', async () => {
    const symbol = await setupOptionMarket({ configured: false })
    const { userId, cookie } = await registerAndLogin('nopricefeeed')
    await grantAsset(userId, 'USDT', '1000')

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/not currently available/)
    expect(await prisma.optionTrade.count({ where: { userId } })).toBe(0)
  })

  it('S. an unresolvable price at EXPIRY marks the trade UNRESOLVED rather than fabricating a WIN/LOSS/DRAW result', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('unresolved')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)

    // Break the price feed AFTER entry (simulating an outage that starts
    // once the trade is already open) by removing the provider mapping.
    await prisma.marketConfig.update({ where: { symbol }, data: { provider: null, providerSymbol: null } })

    const settled = await options.settleTrade(trade.body.id)
    expect(settled.status).toBe('UNRESOLVED')
    expect(settled.result).toBeNull()
    expect(settled.rejectionReason).toBeTruthy()

    // Funds remain reserved — never released, never lost, while unresolved.
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.reserved.toString()).toBe('100')

    // Admin can see it.
    const unresolvedList = await request(server).get('/admin/options/unresolved').set('Cookie', superCookie).expect(200)
    expect(unresolvedList.body.trades.some((t: any) => t.id === trade.body.id)).toBe(true)
  })

  // ---- AI. Unresolved trade later resolves once the feed recovers ------------

  it('AI. once the price feed recovers, re-attempting settlement resolves a previously UNRESOLVED trade — never a stuck-forever state', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('recoveredfeed')
    await grantAsset(userId, 'USDT', '1000')

    // NORMAL mode deliberately — FORCE_* modes are designed to settle
    // regardless of price availability (Part 26: a demo/test trade must
    // never be blocked by a flaky feed), so exercising the real
    // "unresolved while the feed is down" path requires a real,
    // price-dependent trade.
    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)
    await prisma.marketConfig.update({ where: { symbol }, data: { provider: null, providerSymbol: null } })
    const unresolved = await options.settleTrade(trade.body.id)
    expect(unresolved.status).toBe('UNRESOLVED')

    // Feed recovers. Re-attempt settlement directly (this trade's
    // 30s-future expiryAt hasn't actually arrived in wall-clock time yet,
    // so the SWEEP's own `expiryAt <= now()` filter would correctly skip
    // it for another ~30s — settleTrade() itself has no such time gate,
    // exactly like an admin's on-demand "retry now" action).
    await prisma.marketConfig.update({ where: { symbol }, data: { provider: 'SIMULATED', providerSymbol: 'BTCUSDT' } })
    await options.settleTrade(trade.body.id)

    const final = await prisma.optionTrade.findUniqueOrThrow({ where: { id: trade.body.id } })
    expect(final.status).toBe('SETTLED')
    expect(['WIN', 'LOSS', 'DRAW']).toContain(final.result)
  })

  it('AI2. the expiry sweep only settles trades whose expiryAt has genuinely passed — a not-yet-expired ACTIVE trade is left untouched', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 1, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('sweeptiming')
    await grantAsset(userId, 'USDT', '1000')

    const dueSoon = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 1 }).expect(201)
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const stillActive = await prisma.optionTrade.create({
      data: {
        userId, accountId: account.id, symbol, direction: 'BUY', investment: '10', currency: 'USDT',
        durationSeconds: 3600, payoutPercentSnapshot: '5', entryPrice: '100', entryPriceTimestamp: new Date(), entrySource: 'SIMULATED',
        expiryAt: new Date(Date.now() + 3600_000), status: 'ACTIVE',
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 1200))
    const sweep = await options.runExpirySweep()
    expect(sweep.checked).toBeGreaterThanOrEqual(1)

    const dueSoonFinal = await prisma.optionTrade.findUniqueOrThrow({ where: { id: dueSoon.body.id } })
    expect(dueSoonFinal.status).toBe('SETTLED')
    const stillActiveFinal = await prisma.optionTrade.findUniqueOrThrow({ where: { id: stillActive.id } })
    expect(stillActiveFinal.status).toBe('ACTIVE')
  })

  // ---- U. Currency correctness -------------------------------------------------

  it('U. every ledger entry posted for an option trade uses the market\'s configured currency — never a mismatch', async () => {
    const symbol = await setupOptionMarket({ currency: 'USDT' })
    const { userId, cookie } = await registerAndLogin('currencycheck')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    await options.settleTrade(trade.body.id)

    const txns = await prisma.ledgerTransaction.findMany({ where: { relatedType: 'OPTION_TRADE', relatedId: trade.body.id }, include: { entries: true } })
    for (const txn of txns) {
      for (const entry of txn.entries) {
        expect(entry.currency).toBe('USDT')
      }
    }
  })

  // ---- V. Kill switch ------------------------------------------------------------

  it('V. disabling options trading platform-wide rejects new trades with zero rows, but does not block existing settlement', async () => {
    const symbol = await setupOptionMarket({ durations: [{ durationSeconds: 30, payoutPercent: '5' }] })
    const { userId, cookie } = await registerAndLogin('killswitch')
    await grantAsset(userId, 'USDT', '1000')

    const openTrade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '50', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'kill switch test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '50', durationSeconds: 30 })
    expect(res.status).toBe(503)
    expect(await prisma.optionTrade.count({ where: { userId, id: { not: openTrade.body.id } } })).toBe(0)

    // The already-open trade can still settle while NEW trading is disabled.
    const settled = await options.settleTrade(openTrade.body.id)
    expect(settled.status).toBe('SETTLED')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'restore', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  // ---- W/X. Admin authorization & step-up -----------------------------------

  it('W. a plain USER and a permission-less ADMIN cannot access options admin endpoints', async () => {
    const { cookie } = await registerAndLogin('optionsplainuser', 'USER')
    await request(server).get('/admin/options/settings').set('Cookie', cookie).expect(403)
    await request(server).get('/admin/options/markets').set('Cookie', cookie).expect(403)

    const email = uniqueEmail('optionsnoauth')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    await request(server).get('/admin/options/settings').set('Cookie', extractSessionCookie(res)).expect(403)
  })

  // Part 31 — reverses the earlier Phase F lockout: options trading is back
  // in the normal-user experience via the Trade page's amount-tier ticket.
  // Proves a plain USER can reach every user-facing options endpoint,
  // including creating a real trade, with no role gate involved.
  it('W2. a plain USER can reach every user-facing options endpoint, including creating and settling a real trade', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('optionsnormaluser', 'USER')
    await grantAsset(userId, 'USDT', '1000')

    await request(server).get('/options/markets').set('Cookie', cookie).expect(200)
    await request(server).get('/options/balance').set('Cookie', cookie).expect(200)
    await request(server).get('/options/trades/active').set('Cookie', cookie).expect(200)
    await request(server).get('/options/trades/mine').set('Cookie', cookie).expect(200)

    const created = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)
    expect(created.body.status).toBe('ACTIVE')
    expect(created.body.userId).toBe(userId)

    await request(server).get(`/options/trades/${created.body.id}`).set('Cookie', cookie).expect(200)
    const settled = await options.settleTrade(created.body.id)
    expect(settled.status).toBe('SETTLED')
  })

  // Part 31 — the actual security boundary now that any USER can reach
  // these routes: ownership, not role. A second, unrelated USER must never
  // be able to read or act on the first user's trade.
  it("W3. a plain USER cannot read or act on ANOTHER user's option trade — ownership is the boundary, not role", async () => {
    const symbol = await setupOptionMarket()
    const { userId: ownerId, cookie: ownerCookie } = await registerAndLogin('optionsowner', 'USER')
    await grantAsset(ownerId, 'USDT', '1000')
    const trade = await createTrade(ownerCookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)

    const { cookie: strangerCookie } = await registerAndLogin('optionsstranger', 'USER')
    await request(server).get(`/options/trades/${trade.body.id}`).set('Cookie', strangerCookie).expect(404)

    // The stranger's OWN active/mine lists must never include the owner's trade.
    const strangerActive = await request(server).get('/options/trades/active').set('Cookie', strangerCookie).expect(200)
    expect(strangerActive.body.find((t: any) => t.id === trade.body.id)).toBeUndefined()
    const strangerMine = await request(server).get('/options/trades/mine').set('Cookie', strangerCookie).expect(200)
    expect(strangerMine.body.find((t: any) => t.id === trade.body.id)).toBeUndefined()
  })

  // Part 31 — the separate ADMIN management surface is untouched by opening
  // up the customer-facing controller; it keeps its own independent gate.
  it('W4. the admin options management surface still rejects a plain USER — unaffected by opening the customer-facing controller', async () => {
    const { cookie } = await registerAndLogin('optionsplainuserw4', 'USER')
    await request(server).get('/admin/options/settings').set('Cookie', cookie).expect(403)
    await request(server).get('/admin/options/markets').set('Cookie', cookie).expect(403)
  })

  it('X. changing options settings without a valid step-up (wrong password / missing TOTP) is rejected', async () => {
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'bad step-up test', confirmPassword: 'totally-wrong-password', totpCode: currentTotpCode(superSecret) })
      .expect(401)
  })

  // ---- Y. Audit logging -----------------------------------------------------

  it('Y. trade creation and settlement each write a distinct audit event', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('auditcheck')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    const created = await prisma.auditLog.findFirst({ where: { action: 'OPTION_TRADE_CREATED', targetId: trade.body.id } })
    expect(created).toBeTruthy()

    await options.settleTrade(trade.body.id)
    const settled = await prisma.auditLog.findFirst({ where: { action: 'OPTION_TRADE_SETTLED', targetId: trade.body.id } })
    expect(settled).toBeTruthy()

    const demoUse = await prisma.auditLog.findFirst({ where: { action: 'OPTION_DEMO_SIMULATION_USED', actorId: userId } })
    expect(demoUse).toBeTruthy()
  })

  // ---- Z/AA/AB/AC. Demo/test result simulation ---------------------------------

  it('Z/AA/AB. FORCE_WIN, FORCE_LOSS, and FORCE_DRAW are all honored under NODE_ENV=test', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('demoall')
    await grantAsset(userId, 'USDT', '3000')

    for (const [mode, expected] of [['FORCE_WIN', 'WIN'], ['FORCE_LOSS', 'LOSS'], ['FORCE_DRAW', 'DRAW']] as const) {
      const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30, requestedResultMode: mode }).expect(201)
      const settled = await options.settleTrade(trade.body.id)
      expect(settled.result).toBe(expected)
    }
  })

  it('AC. the production/staging environment rejects any non-NORMAL requestedResultMode, even though the DTO accepts it structurally', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('demoprod')
    await grantAsset(userId, 'USDT', '1000')

    const original = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' })
      expect(res.status).toBe(403)
      expect(await prisma.optionTrade.count({ where: { userId } })).toBe(0)
      // The attempt itself is still audited, whether accepted or rejected.
      const attempt = await prisma.auditLog.findFirst({ where: { action: 'OPTION_DEMO_SIMULATION_USED', actorId: userId }, orderBy: { createdAt: 'desc' } })
      expect(attempt).toBeTruthy()
      expect((attempt?.metadata as any)?.accepted).toBe(false)
    } finally {
      process.env.NODE_ENV = original
    }

    // Staging is excluded too (Part 26's allow-list, deliberately narrower
    // than "not production" — see options.service.ts).
    try {
      process.env.NODE_ENV = 'staging'
      const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30, requestedResultMode: 'FORCE_LOSS' })
      expect(res.status).toBe(403)
    } finally {
      process.env.NODE_ENV = original
    }

    // NORMAL mode is always allowed, in every environment.
    try {
      process.env.NODE_ENV = 'production'
      await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
    } finally {
      process.env.NODE_ENV = original
    }
  })

  // ---- AD. Refresh / active-trade sync ----------------------------------------

  it('AD. an active trade is consistently visible across repeated reads, exactly as if the browser were refreshed', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('refresh')
    await grantAsset(userId, 'USDT', '1000')

    const trade = await createTrade(cookie, { symbol, direction: 'BUY', investment: '100', durationSeconds: 30 }).expect(201)

    const readsBeforeSettle = await Promise.all([
      request(server).get('/options/trades/active').set('Cookie', cookie),
      request(server).get(`/options/trades/${trade.body.id}`).set('Cookie', cookie),
    ])
    for (const r of readsBeforeSettle) expect(r.status).toBe(200)
    expect(readsBeforeSettle[0].body.some((t: any) => t.id === trade.body.id)).toBe(true)
    expect(readsBeforeSettle[1].body.id).toBe(trade.body.id)
    expect(readsBeforeSettle[1].body.status).toBe('ACTIVE')
  })

  // ---- AE. Trade history filtering --------------------------------------------

  it('AE. trade history can be filtered by symbol, result, and active/completed status', async () => {
    const symbolA = await setupOptionMarket()
    const symbolB = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('history')
    await grantAsset(userId, 'USDT', '3000')

    const winTrade = await createTrade(cookie, { symbol: symbolA, direction: 'BUY', investment: '10', durationSeconds: 30, requestedResultMode: 'FORCE_WIN' }).expect(201)
    await options.settleTrade(winTrade.body.id)
    const lossTrade = await createTrade(cookie, { symbol: symbolA, direction: 'BUY', investment: '10', durationSeconds: 30, requestedResultMode: 'FORCE_LOSS' }).expect(201)
    await options.settleTrade(lossTrade.body.id)
    const activeTrade = await createTrade(cookie, { symbol: symbolB, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)

    const bySymbol = await request(server).get(`/options/trades/mine?symbol=${encodeURIComponent(symbolA)}`).set('Cookie', cookie).expect(200)
    expect(bySymbol.body.every((t: any) => t.symbol === symbolA)).toBe(true)
    expect(bySymbol.body.length).toBe(2)

    const wins = await request(server).get('/options/trades/mine?result=WIN').set('Cookie', cookie).expect(200)
    expect(wins.body.some((t: any) => t.id === winTrade.body.id)).toBe(true)
    expect(wins.body.every((t: any) => t.result === 'WIN')).toBe(true)

    const active = await request(server).get('/options/trades/mine?active=true').set('Cookie', cookie).expect(200)
    expect(active.body.some((t: any) => t.id === activeTrade.body.id)).toBe(true)
    expect(active.body.every((t: any) => t.status !== 'SETTLED')).toBe(true)

    const completed = await request(server).get('/options/trades/mine?completed=true').set('Cookie', cookie).expect(200)
    expect(completed.body.some((t: any) => t.id === activeTrade.body.id)).toBe(false)
  })

  // ---- AF/AG. Concurrent trades & max-active-trades limit ---------------------

  it('AF. a user may hold multiple simultaneous active option trades', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('multiactive')
    await grantAsset(userId, 'USDT', '1000')

    await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
    await createTrade(cookie, { symbol, direction: 'SELL', investment: '10', durationSeconds: 30 }).expect(201)
    const activeCount = await prisma.optionTrade.count({ where: { userId, status: 'ACTIVE' } })
    expect(activeCount).toBe(2)
  })

  it('AG. maxActiveTradesPerUser, once configured, is enforced by the backend', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('maxactive')
    await grantAsset(userId, 'USDT', '1000')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ maxActiveTradesPerUser: 2, reason: 'test max active', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    try {
      await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
      await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
      const res = await createTrade(cookie, { symbol, direction: 'BUY', investment: '10', durationSeconds: 30 })
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/MAX_ACTIVE_TRADES_EXCEEDED/)
      expect(await prisma.optionTrade.count({ where: { userId, status: 'ACTIVE' } })).toBe(2)
    } finally {
      await request(server)
        .patch('/admin/options/settings')
        .set('Cookie', superCookie)
        .send({ maxActiveTradesPerUser: 999999, reason: 'restore', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
        .expect(200)
    }
  })

  // ---- Admin stats -----------------------------------------------------------

  it('admin can view aggregate options statistics', async () => {
    const res = await request(server).get('/admin/options/stats').set('Cookie', superCookie).expect(200)
    expect(typeof res.body.activeTrades).toBe('number')
    expect(typeof res.body.wins).toBe('number')
    expect(Array.isArray(res.body.byAsset)).toBe(true)
  })
})

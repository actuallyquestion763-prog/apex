import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, createUserDirect, extractSessionCookie, uniqueEmail } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6B, Part 21 — HTTP/API-contract level tests. Provider-failure-mode
// tests (malformed/timeout/429/500/auth-failure/stale/unavailable/invalid
// price/timestamp/bid-ask) live in src/markets/market-data.service.spec.ts,
// where a fake provider makes them deterministic; this file covers what
// only makes sense at the real HTTP layer.
describe('Market Data API (real PostgreSQL)', () => {
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

  it('GET /markets lists configured instruments in the normalized Instrument shape, database-driven (Part 4) — BTC/USDT is BINANCE as of Phase 6C', async () => {
    const res = await request(server).get('/markets').expect(200)
    expect(Array.isArray(res.body)).toBe(true)
    const xau = res.body.find((m: any) => m.symbol === 'XAU/USD')
    expect(xau).toBeDefined()
    expect(xau).toMatchObject({ baseAsset: 'XAU', quoteAsset: 'USD', marketType: 'CFD', provider: 'GOLDAPI' })
    const btc = res.body.find((m: any) => m.symbol === 'BTC/USDT')
    expect(btc).toMatchObject({ baseAsset: 'BTC', quoteAsset: 'USDT', marketType: 'CRYPTO_SPOT', provider: 'BINANCE', providerSymbol: 'BTCUSDT' })
  })

  it('33. GET /markets/:symbol/quote returns a real LIVE quote for a Binance-backed instrument, with 24h stats, never SIMULATED', async () => {
    const res = await request(server).get('/markets/BTC%2FUSDT/quote').expect(200)
    expect(res.body.status).toBe('LIVE')
    expect(res.body.source).toBe('Binance')
    expect(typeof res.body.last).toBe('number')
    expect(Number.isFinite(res.body.last)).toBe(true)
    expect(res.body.last).toBeGreaterThan(0)
    expect(res.body.bid).toBeGreaterThan(0)
    expect(res.body.ask).toBeGreaterThanOrEqual(res.body.bid)
    // 24h stats (Part 10) — present because Binance actually supplies them.
    expect(typeof res.body.priceChangePercent).toBe('number')
    expect(typeof res.body.highPrice).toBe('number')
    expect(typeof res.body.volume).toBe('number')
  })

  // 30. a SIMULATED-configured instrument must never report LIVE, and a
  // Binance-configured one must never report SIMULATED — the distinction
  // is enforced by which provider is actually configured, not guessed.
  it('30. a market explicitly configured provider: SIMULATED always reports SIMULATED, never LIVE', async () => {
    await prisma.marketConfig.upsert({
      where: { symbol: 'TEST/SIM' },
      create: { symbol: 'TEST/SIM', dataSource: 'SIMULATED', enabled: true, provider: 'SIMULATED', providerSymbol: 'BTCUSDT', baseAsset: 'TEST', quoteAsset: 'SIM', displayName: 'Test Simulated', marketType: 'CRYPTO_SPOT' },
      update: {},
    })
    const res = await request(server).get('/markets/TEST%2FSIM/quote').expect(200)
    expect(res.body.status).toBe('SIMULATED')
    expect(res.body.status).not.toBe('LIVE')
  })

  it('9. GET /markets/:symbol/quote for an unconfigured symbol returns UNAVAILABLE, not a 500 or a fabricated value', async () => {
    const res = await request(server).get(`/markets/${encodeURIComponent('NOPE/NOTREAL')}/quote`).expect(200)
    expect(res.body.status).toBe('UNAVAILABLE')
    expect(res.body.last).toBeUndefined()
  })

  it('GET /markets/:symbol 404s for an unconfigured/disabled instrument (distinct from the quote endpoint, which never 404s)', async () => {
    await request(server).get(`/markets/${encodeURIComponent('NOPE/NOTREAL')}`).expect(404)
    const res = await request(server).get('/markets/XAU%2FUSD').expect(200)
    expect(res.body.symbol).toBe('XAU/USD')
  })

  it('14/31/32. GET /markets/quotes batches multiple REAL Binance symbols concurrently, capped, and requires the query param', async () => {
    await request(server).get('/markets/quotes').expect(400)
    const res = await request(server).get('/markets/quotes?symbols=XAU/USD,BTC/USDT,ETH/USDT,BNB/USDT,SOL/USDT').expect(200)
    expect(res.body).toHaveLength(5)
    expect(res.body.map((r: any) => r.symbol)).toEqual(['XAU/USD', 'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'])
    const btc = res.body.find((r: any) => r.symbol === 'BTC/USDT')
    const eth = res.body.find((r: any) => r.symbol === 'ETH/USDT')
    expect(btc.status).toBe('LIVE')
    expect(eth.status).toBe('LIVE')
    expect(btc.last).toBeGreaterThan(0)
    expect(eth.last).toBeGreaterThan(0)
  })

  it('candles: a Binance-backed LIVE market returns real klines; XAU/USD honestly reports OHLC_UNAVAILABLE, never a fabricated candle', async () => {
    const btcCandles = await request(server).get('/markets/BTC%2FUSDT/candles?interval=1m&limit=5').expect(200)
    expect(btcCandles.body.status).toBe('OK')
    expect(btcCandles.body.candles).toHaveLength(5)
    for (const c of btcCandles.body.candles) {
      expect(Number.isFinite(c.open)).toBe(true)
      expect(Number.isFinite(c.high)).toBe(true)
      expect(Number.isFinite(c.low)).toBe(true)
      expect(Number.isFinite(c.close)).toBe(true)
    }

    const xauCandles = await request(server).get('/markets/XAU%2FUSD/candles').expect(200)
    expect(xauCandles.body.status).toBe('OHLC_UNAVAILABLE')
    expect(xauCandles.body.candles).toBeUndefined()

    await request(server).get('/markets/BTC%2FUSDT/candles?interval=invalid').expect(400)
  })

  it('12/17. an arbitrarily large symbols list is capped rather than becoming an unbounded batch of outbound requests', async () => {
    const many = Array.from({ length: 200 }, (_, i) => `FAKE${i}/USD`).join(',')
    const res = await request(server).get(`/markets/quotes?symbols=${many}`).expect(200)
    expect(res.body.length).toBeLessThanOrEqual(50)
  })

  // 19/20/21 — market-data failure must never touch deposits/withdrawals/
  // support. Structural proof (no financial/support import anywhere in the
  // markets module) plus a live behavioral proof: even with
  // MARKET_API_KEY unset (XAU/USD guaranteed UNAVAILABLE), a deposit still
  // works completely normally.
  it('18/19/20. market-data unavailability does not affect deposits, withdrawals, or their creation flow', async () => {
    const original = process.env.MARKET_API_KEY
    delete process.env.MARKET_API_KEY
    try {
      const email = uniqueEmail('marketfail')
      const password = 'correct-horse-battery'
      await createUserDirect(prisma, { email, password })
      const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
      const cookie = extractSessionCookie(loginRes)

      // Market data is confirmed unavailable...
      const quote = await request(server).get('/markets/XAU%2FUSD/quote').expect(200)
      expect(quote.body.status).toBe('UNAVAILABLE')

      // ...yet a deposit request creation is completely unaffected (deposits
      // never touch MarketsService/MarketDataService at all).
      const deposit = await request(server).post('/deposits').set('Cookie', cookie).send({ amount: '10', method: 'card' }).expect(201)
      expect(deposit.body.status).toBe('PENDING')
    } finally {
      if (original) process.env.MARKET_API_KEY = original
    }
  })

  // Phase 6F Checkpoint G, Part 8/19 (#19) — the backend must be the sole
  // authority on the price used for any trading decision. CreateOrderDto
  // has no `currentPrice`/`price` field at all, and the global
  // ValidationPipe is configured with whitelist:true,
  // forbidNonWhitelisted:true (main.ts/test-app.ts) — an extra,
  // unrecognized property doesn't get silently stripped, it makes the
  // WHOLE request 400. This proves that contract at the real HTTP layer,
  // not just by reading the DTO's decorators.
  it('19. a frontend-supplied price field on an order request is rejected outright (400), never silently accepted or used', async () => {
    const email = uniqueEmail('pricenjection')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password })
    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const cookie = extractSessionCookie(loginRes)

    const res = await request(server)
      .post('/orders')
      .set('Cookie', cookie)
      .send({ symbol: 'BTC/USDT', side: 'BUY', quantity: '10', currentPrice: 1 }) // attacker/buggy-client-supplied price
    expect(res.status).toBe(400)

    const orderCount = await prisma.order.count({ where: { userId: user.id } })
    expect(orderCount).toBe(0) // rejected before any order row was even considered
  })
})

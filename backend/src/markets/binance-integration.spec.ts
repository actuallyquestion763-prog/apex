import { MarketDataService } from './market-data.service'
import { BinanceProvider } from './providers/binance.provider'
import type { GoldApiProvider } from './providers/goldapi.provider'
import type { SimulatedProvider } from './providers/simulated.provider'

// Phase 6C, Part 27 items 13/14/15/34/35 — unlike market-data.service.spec.ts
// (Phase 6B, uses a hand-written FakeProvider), this wires the REAL
// BinanceProvider into a REAL MarketDataService, with only `fetch` mocked —
// proving MarketDataService's validation/staleness rules actually catch bad
// data coming specifically through the Binance code path, not just a
// simplified test double.
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

function makePrismaMock(row: any) {
  return {
    marketConfig: {
      findUnique: jest.fn(async () => row),
      findMany: jest.fn(async () => [row]),
    },
  } as any
}

const btcRow = { symbol: 'BTC/USDT', enabled: true, provider: 'BINANCE', providerSymbol: 'BTCUSDT' }

describe('BinanceProvider + MarketDataService integration', () => {
  let fetchMock: jest.Mock
  let binance: BinanceProvider
  let service: MarketDataService

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as any
    binance = new BinanceProvider()
    const prisma = makePrismaMock(btcRow)
    service = new MarketDataService(prisma, {} as GoldApiProvider, {} as SimulatedProvider, binance)
  })

  function mockBookAndTicker(bookRows: any[], tickerRows: any[]) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('bookTicker')) return jsonResponse(bookRows)
      if (url.includes('ticker/24hr')) return jsonResponse(tickerRows)
      throw new Error(`unexpected URL: ${url}`)
    })
  }

  it('a genuine valid Binance response becomes a LIVE MarketQuote with real 24h stats', async () => {
    mockBookAndTicker(
      [{ symbol: 'BTCUSDT', bidPrice: '64100.00', askPrice: '64100.50' }],
      [{ symbol: 'BTCUSDT', lastPrice: '64100.25', priceChange: '500', priceChangePercent: '0.78', highPrice: '64500', lowPrice: '63000', volume: '1200', quoteVolume: '77000000', closeTime: Date.now() }],
    )
    const result = await service.getQuote('BTC/USDT')
    expect(result.status).toBe('LIVE')
    expect((result as any).last).toBe(64100.25)
    expect((result as any).priceChangePercent).toBe(0.78)
  })

  // 13. invalid price via the real Binance path
  it('13. a Binance response with a NaN-producing last price is rejected — never published as LIVE', async () => {
    mockBookAndTicker([{ symbol: 'BTCUSDT', bidPrice: '1', askPrice: '2' }], [{ symbol: 'BTCUSDT', lastPrice: 'not-a-number' }])
    const result = await service.getQuote('BTC/USDT')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 14. invalid bid/ask via the real Binance path
  it('14. a Binance bookTicker with bid > ask is rejected outright, never repaired or swapped', async () => {
    mockBookAndTicker([{ symbol: 'BTCUSDT', bidPrice: '65000', askPrice: '64000' }], [{ symbol: 'BTCUSDT', lastPrice: '64500' }])
    const result = await service.getQuote('BTC/USDT')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 15. invalid timestamp via the real Binance path
  it('15. a Binance closeTime implausibly far in the future is rejected', async () => {
    const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000
    mockBookAndTicker([{ symbol: 'BTCUSDT', bidPrice: '1', askPrice: '2' }], [{ symbol: 'BTCUSDT', lastPrice: '100', closeTime: farFuture }])
    const result = await service.getQuote('BTC/USDT')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 34/35. stale-then-unavailable, driven by a real Binance outage
  it('34/35. a Binance outage first yields STALE (last known value), then UNAVAILABLE once that ages out — never LIVE', async () => {
    const realNow = Date.now
    try {
      let now = realNow()
      Date.now = () => now
      mockBookAndTicker([{ symbol: 'BTCUSDT', bidPrice: '100', askPrice: '101' }], [{ symbol: 'BTCUSDT', lastPrice: '100.5', closeTime: now }])
      const first = await service.getQuote('BTC/USDT')
      expect(first.status).toBe('LIVE')

      // Binance goes down.
      now += 45_000
      fetchMock.mockRejectedValue(new Error('Binance network failure: ECONNRESET'))
      const stale = await service.getQuote('BTC/USDT')
      expect(stale.status).toBe('STALE')

      // Still down, well past the stale window.
      now += 200_000
      const unavailable = await service.getQuote('BTC/USDT')
      expect(unavailable.status).toBe('UNAVAILABLE')
    } finally {
      Date.now = realNow
    }
  })
})

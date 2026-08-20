import { MarketDataService } from './market-data.service'
import type { MarketDataProvider, ProviderQuoteRequest, RawProviderQuote } from './market-data.types'
import type { GoldApiProvider } from './providers/goldapi.provider'
import type { SimulatedProvider } from './providers/simulated.provider'
import type { BinanceProvider } from './providers/binance.provider'

// A fully controllable fake provider — lets every Part 21 failure scenario
// (malformed response, timeout, 429, 500, auth failure) be tested
// deterministically, without depending on real network access to GoldAPI.
class FakeProvider implements MarketDataProvider {
  readonly name: string
  private nextResult: RawProviderQuote | Error
  calls: ProviderQuoteRequest[] = []

  constructor(name: string, result: RawProviderQuote | Error) {
    this.name = name
    this.nextResult = result
  }

  setNext(result: RawProviderQuote | Error) {
    this.nextResult = result
  }

  async getQuote(request: ProviderQuoteRequest): Promise<RawProviderQuote> {
    this.calls.push(request)
    if (this.nextResult instanceof Error) throw this.nextResult
    return this.nextResult
  }

  async healthCheck() {
    return !(this.nextResult instanceof Error)
  }
}

function makePrismaMock(rows: Record<string, any>) {
  return {
    marketConfig: {
      findUnique: jest.fn(async ({ where: { symbol } }: any) => rows[symbol] ?? null),
      findMany: jest.fn(async () => Object.values(rows).filter((r: any) => r.enabled)),
    },
  } as any
}

const VALID_QUOTE: RawProviderQuote = { last: 100, bid: 99.5, ask: 100.5, timestampSeconds: Math.floor(Date.now() / 1000) }

describe('MarketDataService', () => {
  let fakeGood: FakeProvider

  function build(rows: Record<string, any>) {
    fakeGood = new FakeProvider('GOLDAPI', VALID_QUOTE)
    const prisma = makePrismaMock(rows)
    // Injected in place of the real GoldApiProvider/SimulatedProvider —
    // MarketDataService only depends on the MarketDataProvider interface,
    // so a fake satisfying it is a legitimate substitute, not a shortcut
    // around the real contract.
    const service = new MarketDataService(prisma, fakeGood as unknown as GoldApiProvider, fakeGood as unknown as SimulatedProvider, fakeGood as unknown as BinanceProvider)
    return { service, prisma }
  }

  const liveRow = { symbol: 'XAU/USD', enabled: true, provider: 'GOLDAPI', providerSymbol: 'XAU/USD' }

  // 1. provider returns valid quote
  it('1. returns a LIVE quote for a valid provider response', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('LIVE')
    expect((result as any).last).toBe(100)
    expect((result as any).source).toBe('GOLDAPI')
  })

  // 2. malformed response
  it('2. rejects a malformed response (NaN price) as UNAVAILABLE, never publishes it', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext({ last: NaN, bid: null, ask: null, timestampSeconds: null })
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 3. provider timeout
  it('3. treats a provider timeout as a failure -> UNAVAILABLE (no cache yet)', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext(new Error('fetch timed out'))
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 4. provider 429
  it('4. treats a 429 as a failure -> UNAVAILABLE (no cache yet)', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext(new Error('GoldAPI rate limited (429)'))
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 5. provider 500
  it('5. treats a 500 as a failure -> UNAVAILABLE (no cache yet)', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext(new Error('GoldAPI server error (500)'))
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 6. provider authentication failure
  it('6. treats an authentication failure as a failure -> UNAVAILABLE, never a fabricated price', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext(new Error('GoldAPI authentication failed (401)'))
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('UNAVAILABLE')
    expect((result as any).last).toBeUndefined()
  })

  // 7. stale quote
  it('7. returns STALE (not LIVE) once a previously-valid quote ages past the fresh window but within the stale window', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    const realNow = Date.now
    try {
      let now = realNow()
      Date.now = () => now
      const first = await service.getQuote('XAU/USD')
      expect(first.status).toBe('LIVE')

      // Advance past FRESH_MS (30s) but within STALE_MS (120s), and make
      // the provider fail this time — a real re-fetch attempt that fails,
      // falling back to the cached value marked STALE.
      now += 45_000
      fakeGood.setNext(new Error('provider temporarily unreachable'))
      const second = await service.getQuote('XAU/USD')
      expect(second.status).toBe('STALE')
      expect((second as any).last).toBe(100) // still the last known-good value, never re-labeled LIVE
    } finally {
      Date.now = realNow
    }
  })

  it('25. provider recovery after outage — a subsequent successful fetch returns LIVE again, not stuck on STALE/UNAVAILABLE', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    const realNow = Date.now
    try {
      let now = realNow()
      Date.now = () => now
      await service.getQuote('XAU/USD') // LIVE, cached

      now += 45_000
      fakeGood.setNext(new Error('provider outage'))
      const duringOutage = await service.getQuote('XAU/USD')
      expect(duringOutage.status).toBe('STALE')

      now += 1_000
      fakeGood.setNext({ last: 105, bid: 104.5, ask: 105.5, timestampSeconds: Math.floor(now / 1000) })
      const recovered = await service.getQuote('XAU/USD')
      expect(recovered.status).toBe('LIVE')
      expect((recovered as any).last).toBe(105)
    } finally {
      Date.now = realNow
    }
  })

  // 8. unavailable market (disabled / no provider configured)
  it('8. returns UNAVAILABLE for a disabled instrument', async () => {
    const { service } = build({ 'XAU/USD': { ...liveRow, enabled: false } })
    const result = await service.getQuote('XAU/USD')
    expect(result.status).toBe('UNAVAILABLE')
  })

  it('8b. returns UNAVAILABLE for an instrument with no provider configured', async () => {
    const { service } = build({ 'BTC/USDT': { symbol: 'BTC/USDT', enabled: true, provider: null, providerSymbol: null } })
    const result = await service.getQuote('BTC/USDT')
    expect(result.status).toBe('UNAVAILABLE')
  })

  // 9. unknown symbol
  it('9. returns UNAVAILABLE for a symbol that has no MarketConfig row at all — never attempts a provider call', async () => {
    const { service } = build({})
    const result = await service.getQuote('NOT/CONFIGURED')
    expect(result.status).toBe('UNAVAILABLE')
    expect(fakeGood.calls).toHaveLength(0)
  })

  // 10. invalid price
  it('10. rejects a negative or zero price', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext({ last: -5, bid: null, ask: null, timestampSeconds: null })
    expect((await service.getQuote('XAU/USD')).status).toBe('UNAVAILABLE')

    fakeGood.setNext({ last: 0, bid: null, ask: null, timestampSeconds: null })
    expect((await service.getQuote('XAU/USD')).status).toBe('UNAVAILABLE')
  })

  // 11. invalid timestamp
  it('11. rejects a timestamp implausibly far in the future', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext({ last: 100, bid: null, ask: null, timestampSeconds: Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60 })
    expect((await service.getQuote('XAU/USD')).status).toBe('UNAVAILABLE')
  })

  // 12. invalid bid/ask relationship
  it('12. rejects a quote where bid > ask', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    fakeGood.setNext({ last: 100, bid: 101, ask: 99, timestampSeconds: null })
    expect((await service.getQuote('XAU/USD')).status).toBe('UNAVAILABLE')
  })

  // 13. provider mapping
  it("13. calls the provider with the instrument's providerSymbol, never TRUST's own symbol", async () => {
    const { service } = build({ 'BTC/USDT': { symbol: 'BTC/USDT', enabled: true, provider: 'GOLDAPI', providerSymbol: 'BTCUSDT' } })
    await service.getQuote('BTC/USDT')
    expect(fakeGood.calls[0]).toEqual({ providerSymbol: 'BTCUSDT' })
  })

  // 14. multiple symbols
  it('14. getQuotes resolves multiple symbols independently, including a mix of known/unknown', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    const results = await service.getQuotes(['XAU/USD', 'NOT/CONFIGURED'])
    expect(results).toHaveLength(2)
    expect(results[0].status).toBe('LIVE')
    expect(results[1].status).toBe('UNAVAILABLE')
  })

  // 17 (partial — structural): an injection-shaped "symbol" never becomes a
  // provider call, because it never matches a configured MarketConfig row.
  it('17. a URL/injection-shaped input never reaches a provider — no config match means no outbound call', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    const result = await service.getQuote('http://evil.example.com/steal')
    expect(result.status).toBe('UNAVAILABLE')
    expect(fakeGood.calls).toHaveLength(0)
  })

  // Phase 6F Checkpoint G, Part 9/19 (#15) — the backend's own cache is
  // what makes "multiple frontend clients share backend market data" true
  // rather than aspirational: two requests for the same symbol within
  // FRESH_MS must hit the provider exactly once, not twice.
  it('26. two getQuote calls for the same symbol within the freshness window hit the provider exactly once (cache/fanout)', async () => {
    const { service } = build({ 'XAU/USD': liveRow })
    const first = await service.getQuote('XAU/USD')
    const second = await service.getQuote('XAU/USD')
    expect(first.status).toBe('LIVE')
    expect(second.status).toBe('LIVE')
    expect(fakeGood.calls).toHaveLength(1) // second call served from cache, no re-fetch
  })

  // Phase 6F Checkpoint G, Part 15/19 (#13) — one broken market must not
  // affect another. Two DIFFERENT provider instances (not just two
  // symbols on the same fake) so this genuinely exercises independent
  // per-provider failure, not just independent per-symbol config lookup
  // (already covered by test 14 above).
  it('27. a failure in one configured provider does not affect a DIFFERENT market on a different, healthy provider', async () => {
    const healthy = new FakeProvider('GOLDAPI', VALID_QUOTE)
    const failing = new FakeProvider('BINANCE', new Error('Binance outage'))
    const prisma = makePrismaMock({
      'XAU/USD': liveRow,
      'BTC/USDT': { symbol: 'BTC/USDT', enabled: true, provider: 'BINANCE', providerSymbol: 'BTCUSDT' },
    })
    const service = new MarketDataService(prisma, healthy as unknown as GoldApiProvider, healthy as unknown as SimulatedProvider, failing as unknown as BinanceProvider)
    const [gold, btc] = await service.getQuotes(['XAU/USD', 'BTC/USDT'])
    expect(gold.status).toBe('LIVE') // unaffected by BTC/USDT's provider failing
    expect(btc.status).toBe('UNAVAILABLE') // the broken one, never a fabricated fallback
  })
})

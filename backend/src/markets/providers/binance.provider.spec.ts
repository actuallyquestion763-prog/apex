import { BinanceProvider } from './binance.provider'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

describe('BinanceProvider', () => {
  let provider: BinanceProvider
  let fetchMock: jest.Mock

  beforeEach(() => {
    provider = new BinanceProvider()
    fetchMock = jest.fn()
    global.fetch = fetchMock as any
  })

  // 1. implements MarketDataProvider (+ history capability)
  it('1. implements the MarketDataProvider interface, plus getKlines for history', () => {
    expect(provider.name).toBe('Binance')
    expect(typeof provider.getQuote).toBe('function')
    expect(typeof provider.healthCheck).toBe('function')
    expect(typeof provider.getKlines).toBe('function')
  })

  function mockBookAndTicker(bookRows: any[], tickerRows: any[]) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('bookTicker')) return jsonResponse(bookRows)
      if (url.includes('ticker/24hr')) return jsonResponse(tickerRows)
      throw new Error(`unexpected URL in test: ${url}`)
    })
  }

  // 2/3/4. valid price + book ticker + 24h ticker, merged correctly
  it('2/3/4. merges bookTicker (bid/ask) with ticker/24hr (last + 24h stats) into one normalized quote', async () => {
    mockBookAndTicker(
      [{ symbol: 'BTCUSDT', bidPrice: '64100.00', askPrice: '64100.50' }],
      [{ symbol: 'BTCUSDT', lastPrice: '64100.25', priceChange: '500', priceChangePercent: '0.78', highPrice: '64500', lowPrice: '63000', volume: '1200', quoteVolume: '77000000', closeTime: 1700000000000 }],
    )
    const result = await provider.getQuote({ providerSymbol: 'BTCUSDT' })
    expect(result.last).toBe(64100.25)
    expect(result.bid).toBe(64100.0) // from bookTicker specifically, not ticker/24hr's own bid field
    expect(result.ask).toBe(64100.5)
    expect(result.priceChangePercent).toBe(0.78)
    expect(result.highPrice).toBe(64500)
    expect(result.lowPrice).toBe(63000)
    expect(result.volume).toBe(1200)
    expect(result.quoteVolume).toBe(77000000)
    expect(result.timestampSeconds).toBe(1700000000)
  })

  // 5. valid symbol mapping — request URL carries the exact providerSymbol
  it('5. requests exactly the providerSymbol given, never a TRUST-shaped symbol', async () => {
    mockBookAndTicker([{ symbol: 'ETHUSDT', bidPrice: '1', askPrice: '2' }], [{ symbol: 'ETHUSDT', lastPrice: '1.5' }])
    await provider.getQuote({ providerSymbol: 'ETHUSDT' })
    const urls = fetchMock.mock.calls.map((c: any[]) => c[0] as string)
    expect(urls.some((u) => u.includes(encodeURIComponent('ETHUSDT').replace(/%2C/g, ',')) || u.includes('ETHUSDT'))).toBe(true)
  })

  // 7. unsupported symbol
  it('7. throws for a symbol Binance did not return data for (unsupported/unrecognized)', async () => {
    mockBookAndTicker([], [])
    await expect(provider.getQuote({ providerSymbol: 'NOTREAL123' })).rejects.toThrow(/did not return data/)
  })

  // 8. malformed response
  it('8. throws on a malformed (non-array) batch response', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('bookTicker')) return jsonResponse({ not: 'an array' })
      return jsonResponse([{ symbol: 'BTCUSDT', lastPrice: '100' }])
    })
    await expect(provider.getQuote({ providerSymbol: 'BTCUSDT' })).rejects.toThrow(/malformed/)
  })

  // 9. HTTP 429
  it('9. throws a rate-limit-specific error on HTTP 429', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 429))
    await expect(provider.getQuote({ providerSymbol: 'BTCUSDT' })).rejects.toThrow(/rate limited/)
  })

  // 10. HTTP 5xx
  it('10. throws a server-error-specific error on HTTP 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 500))
    await expect(provider.getQuote({ providerSymbol: 'BTCUSDT' })).rejects.toThrow(/server error/)
  })

  // 11/12. timeout / network failure
  it('11/12. surfaces a network failure as a clear error, never a hang or a fabricated value', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(provider.getQuote({ providerSymbol: 'BTCUSDT' })).rejects.toThrow(/network failure/)
  })

  it('malformed JSON body is treated as a failure', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } } as any)
    await expect(provider.getQuote({ providerSymbol: 'BTCUSDT' })).rejects.toThrow(/non-JSON/)
  })

  // 22. rate-limit-conscious batching — the whole point of this adapter's design
  it('22. batches concurrent requests for different symbols into exactly 2 HTTP calls, not 2-per-symbol', async () => {
    mockBookAndTicker(
      [
        { symbol: 'BTCUSDT', bidPrice: '1', askPrice: '2' },
        { symbol: 'ETHUSDT', bidPrice: '1', askPrice: '2' },
        { symbol: 'BNBUSDT', bidPrice: '1', askPrice: '2' },
      ],
      [
        { symbol: 'BTCUSDT', lastPrice: '100' },
        { symbol: 'ETHUSDT', lastPrice: '200' },
        { symbol: 'BNBUSDT', lastPrice: '300' },
      ],
    )
    const [btc, eth, bnb] = await Promise.all([
      provider.getQuote({ providerSymbol: 'BTCUSDT' }),
      provider.getQuote({ providerSymbol: 'ETHUSDT' }),
      provider.getQuote({ providerSymbol: 'BNBUSDT' }),
    ])
    expect(btc.last).toBe(100)
    expect(eth.last).toBe(200)
    expect(bnb.last).toBe(300)
    expect(fetchMock).toHaveBeenCalledTimes(2) // bookTicker + ticker/24hr, ONE call each, covering all 3 symbols
  })

  // Phase 6F Checkpoint G, Part 22 — found via manual live-price
  // verification against the real Binance API (not a hypothetical): the
  // FIRST concurrent batch of never-before-queried symbols can have its
  // knownSymbols snapshot taken before every concurrent caller's own
  // registration has landed, so the outbound request only actually covers
  // a SUBSET of what was asked for. Test 22 above never caught this
  // because its mock ignores the request URL's `symbols` param and always
  // returns data for every row regardless of what was actually
  // requested — this test's mock is symbol-aware instead, so it only ever
  // returns data for symbols that genuinely appear in the URL, exactly
  // like the real Binance API does.
  it("28. the FIRST concurrent batch for several never-before-queried symbols still resolves every symbol correctly, even if the initial outbound request's snapshot missed one", async () => {
    const bookBySymbol: Record<string, any> = {
      BTCUSDT: { symbol: 'BTCUSDT', bidPrice: '1', askPrice: '2' },
      ETHUSDT: { symbol: 'ETHUSDT', bidPrice: '3', askPrice: '4' },
      BNBUSDT: { symbol: 'BNBUSDT', bidPrice: '5', askPrice: '6' },
    }
    const tickerBySymbol: Record<string, any> = {
      BTCUSDT: { symbol: 'BTCUSDT', lastPrice: '100' },
      ETHUSDT: { symbol: 'ETHUSDT', lastPrice: '200' },
      BNBUSDT: { symbol: 'BNBUSDT', lastPrice: '300' },
    }
    fetchMock.mockImplementation(async (url: string) => {
      const match = url.match(/symbols=(.+)$/)
      const requested: string[] = match ? JSON.parse(decodeURIComponent(match[1])) : []
      if (url.includes('bookTicker')) return jsonResponse(requested.map((s) => bookBySymbol[s]).filter(Boolean))
      if (url.includes('ticker/24hr')) return jsonResponse(requested.map((s) => tickerBySymbol[s]).filter(Boolean))
      throw new Error(`unexpected URL in test: ${url}`)
    })

    const [btc, eth, bnb] = await Promise.all([
      provider.getQuote({ providerSymbol: 'BTCUSDT' }),
      provider.getQuote({ providerSymbol: 'ETHUSDT' }),
      provider.getQuote({ providerSymbol: 'BNBUSDT' }),
    ])
    expect(btc.last).toBe(100)
    expect(eth.last).toBe(200) // would previously throw "not a recognized Binance symbol"
    expect(bnb.last).toBe(300) // same
  })

  it('subsequent getQuote calls for an already-known symbol reuse the cache without a new fetch until asked again', async () => {
    mockBookAndTicker([{ symbol: 'BTCUSDT', bidPrice: '1', askPrice: '2' }], [{ symbol: 'BTCUSDT', lastPrice: '100' }])
    await provider.getQuote({ providerSymbol: 'BTCUSDT' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await provider.getQuote({ providerSymbol: 'BTCUSDT' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // no new call — MarketDataService owns the real freshness/staleness policy above this
  })

  // klines / historical candles
  it('getKlines maps Binance kline rows into normalized MarketCandle objects', async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      [1700000000000, '100.0', '105.0', '99.0', '103.0', '12.5', 1700000059999, '1287.5', 10, '6.0', '618.0', '0'],
    ]))
    const candles = await provider.getKlines({ providerSymbol: 'BTCUSDT', interval: '1m', limit: 1 })
    expect(candles).toEqual([{ time: 1700000000000, open: 100, high: 105, low: 99, close: 103, volume: 12.5 }])
  })

  it('getKlines rejects a malformed row rather than silently producing a partial candle', async () => {
    fetchMock.mockResolvedValue(jsonResponse([[1700000000000, '100.0']])) // too short
    await expect(provider.getKlines({ providerSymbol: 'BTCUSDT', interval: '1m', limit: 1 })).rejects.toThrow(/unexpected shape/)
  })

  it('healthCheck reflects real reachability without ever hitting an authenticated endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    expect(await provider.healthCheck()).toBe(true)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/ping')

    fetchMock.mockRejectedValue(new Error('down'))
    expect(await provider.healthCheck()).toBe(false)
  })
})

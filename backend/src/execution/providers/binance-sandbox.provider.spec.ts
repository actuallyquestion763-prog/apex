import { BinanceSandboxProvider } from './binance-sandbox.provider'
import { ProviderError } from '../execution-provider.types'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

describe('BinanceSandboxProvider', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as any
  })

  it('fails closed at construction time if either credential is missing — never half-configured', () => {
    expect(() => new BinanceSandboxProvider({ apiKey: '', apiSecret: 'x' })).toThrow()
    expect(() => new BinanceSandboxProvider({ apiKey: 'x', apiSecret: '' })).toThrow()
  })

  it('every request goes to testnet.binance.vision — NEVER api.binance.com, regardless of method', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await provider.healthCheck()
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('testnet.binance.vision')
    expect(calledUrl).not.toContain('api.binance.com')
  })

  it('signed requests carry the X-MBX-APIKEY header and a signature query param — never the secret itself in the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ balances: [] }))
    const provider = new BinanceSandboxProvider({ apiKey: 'my-api-key', apiSecret: 'my-secret' })
    await provider.getAccountBalances()

    const [url, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-MBX-APIKEY']).toBe('my-api-key')
    expect(url).toMatch(/signature=[0-9a-f]{64}/) // HMAC-SHA256 hex digest length
    expect(url).not.toContain('my-secret')
  })

  it('getSymbolInfo throws INVALID_SYMBOL when Binance returns no matching symbol, never fabricates one', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ symbols: [] }))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getSymbolInfo('NOPE')).rejects.toMatchObject({ category: 'INVALID_SYMBOL' })
  })

  it('getSymbolInfo reports "unsupported" filters rather than invented numbers when Binance omits a filter', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [] }] }),
    )
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const info = await provider.getSymbolInfo('BTCUSDT')
    expect(info.minQuantity).toBe('unsupported')
    expect(info.minNotional).toBe('unsupported')
  })

  it('normalizes a 429 into RATE_LIMITED (retryable)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -1003, msg: 'Too many requests' }, false, 429))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getAccountBalances()).rejects.toMatchObject({ category: 'RATE_LIMITED', retryable: true })
  })

  it('normalizes a 401 into AUTHENTICATION_FAILED (not retryable)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -2015, msg: 'Invalid API key' }, false, 401))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getAccountBalances()).rejects.toMatchObject({ category: 'AUTHENTICATION_FAILED', retryable: false })
  })

  it('normalizes Binance code -2010 (insufficient balance) into INSUFFICIENT_PROVIDER_BALANCE', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -2010, msg: 'Account has insufficient balance' }, false, 400))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(
      provider.submitMarketOrder({ clientOrderId: 't-1', providerSymbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '999999' }),
    ).rejects.toMatchObject({ category: 'INSUFFICIENT_PROVIDER_BALANCE' })
  })

  it('normalizes Binance code -1121 (invalid symbol) into INVALID_SYMBOL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -1121, msg: 'Invalid symbol' }, false, 400))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getOrderStatus({ providerSymbol: 'BOGUS', clientOrderId: 't-1' })).rejects.toMatchObject({ category: 'INVALID_SYMBOL' })
  })

  it('an unrecognized Binance error code falls through to UNKNOWN_PROVIDER_STATE rather than being guessed at', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -9999, msg: 'something new' }, false, 400))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getAccountBalances()).rejects.toMatchObject({ category: 'UNKNOWN_PROVIDER_STATE' })
  })

  it('a network failure normalizes to PROVIDER_UNAVAILABLE (retryable), never silently swallowed', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getAccountBalances()).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE', retryable: true })
  })

  it('healthCheck() never claims executionAvailable:true from connectivity alone', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const health = await provider.healthCheck()
    expect(health.connectivity).toBe('ok')
    expect(health.executionAvailable).toBe(false)
  })

  it('healthCheck() reports unreachable, not a thrown exception, when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const health = await provider.healthCheck()
    expect(health.connectivity).toBe('unreachable')
    expect(health.executionAvailable).toBe(false)
  })

  it('thrown errors are real ProviderError instances', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -1121, msg: 'Invalid symbol' }, false, 400))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    try {
      await provider.getSymbolInfo('X')
      fail('expected a throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
    }
  })

  // ---- Phase 6F Checkpoint H — MARKET/LIMIT submission, cancellation,
  // fills/fees, status mapping, timeout, 5xx, and duplicate-clientOrderId,
  // none of which had a dedicated deterministic test before this checkpoint
  // (only the shared error-normalization paths were covered). All mocked —
  // never touches the real testnet.

  it('15. submitMarketOrder sends side/type/quantity/newClientOrderId and normalizes a filled response, including fills', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        symbol: 'BTCUSDT', orderId: 555111, clientOrderId: 't-abc', side: 'BUY', type: 'MARKET',
        status: 'FILLED', origQty: '0.01', executedQty: '0.01', price: '0',
        fills: [{ id: 9001, orderId: 555111, price: '64000.00', qty: '0.01', commission: '0.0000064', commissionAsset: 'BTC', time: 1700000000000 }],
      }),
    )
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const res = await provider.submitMarketOrder({ clientOrderId: 't-abc', providerSymbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(url).toContain('symbol=BTCUSDT')
    expect(url).toContain('side=BUY')
    expect(url).toContain('type=MARKET')
    expect(url).toContain('newClientOrderId=t-abc')
    expect(url).toContain('quantity=0.01')

    expect(res.status).toBe('FILLED')
    expect(res.providerOrderId).toBe('555111')
    expect(res.executedQuantity).toBe('0.01')
    expect(res.fills).toHaveLength(1)
    expect(res.fills[0]).toMatchObject({ providerFillId: '9001', providerOrderId: '555111', price: '64000.00', quantity: '0.01', fee: '0.0000064', feeAsset: 'BTC' })
  })

  it('16. submitMarketOrder with quoteOrderQty sends quoteOrderQty instead of quantity, never both', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ symbol: 'BTCUSDT', orderId: 1, status: 'NEW', origQty: '0', executedQty: '0' }))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await provider.submitMarketOrder({ clientOrderId: 't-1', providerSymbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: '100' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('quoteOrderQty=100')
    expect(url).not.toContain('&quantity=')
  })

  it('17. submitLimitOrder sends price and GTC timeInForce, and rejects a missing price before ever calling fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ symbol: 'BTCUSDT', orderId: 2, status: 'NEW', origQty: '0.01', executedQty: '0', price: '60000' }))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const res = await provider.submitLimitOrder({ clientOrderId: 't-2', providerSymbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: '0.01', price: '60000' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('price=60000')
    expect(url).toContain('timeInForce=GTC')
    expect(res.status).toBe('NEW')

    fetchMock.mockClear()
    await expect(
      provider.submitLimitOrder({ clientOrderId: 't-3', providerSymbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: '0.01' }),
    ).rejects.toMatchObject({ category: 'INVALID_REQUEST' })
    expect(fetchMock).not.toHaveBeenCalled() // never submitted a LIMIT order with no price
  })

  it('18. cancelOrder queries by origClientOrderId and normalizes the CANCELED response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ symbol: 'BTCUSDT', orderId: 3, status: 'CANCELED', origQty: '0.01', executedQty: '0' }))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const res = await provider.cancelOrder({ providerSymbol: 'BTCUSDT', clientOrderId: 't-4' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('origClientOrderId=t-4')
    expect(res.status).toBe('CANCELED')
  })

  it('19. getOrderFills maps every raw trade into a normalized ProviderFill, fees included', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { id: 1, orderId: 100, price: '60000', qty: '0.005', commission: '0.03', commissionAsset: 'USDT', time: 1700000001000 },
        { id: 2, orderId: 100, price: '60010', qty: '0.005', commission: '0.03', commissionAsset: 'USDT', time: 1700000002000 },
      ]),
    )
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const fills = await provider.getOrderFills({ providerSymbol: 'BTCUSDT', clientOrderId: 't-5', providerOrderId: '100' })
    expect(fills).toHaveLength(2)
    expect(fills[0]).toEqual({ providerFillId: '1', providerOrderId: '100', price: '60000', quantity: '0.005', fee: '0.03', feeAsset: 'USDT', executedAt: new Date(1700000001000).toISOString() })
  })

  // Phase 6F Checkpoint I, Part 1 — locks in the exact bug found during live
  // Testnet verification (Checkpoint H): OrdersService.syncOrder/cancelOrder
  // previously called getOrderFills WITHOUT providerOrderId, so Binance's
  // real /v3/myTrades (symbol-only scoping) returned every trade for the
  // symbol across every order the account had ever placed — a real,
  // reproduced cross-order contamination, not a hypothetical. This
  // provider-level test proves the request itself is correctly scoped;
  // OrdersService's own call sites (orders.service.ts's syncOrder/
  // cancelOrder) now always pass order.externalOrderId through as
  // providerOrderId — the fix this test locks in from the OTHER end.
  it('25. getOrderFills sends providerOrderId as the orderId query param, so same-symbol fills from a DIFFERENT order are never returned', async () => {
    // A realistic Binance response: this mock respects the orderId query
    // param exactly like the real exchange does — it only ever returns
    // trades matching the orderId actually requested, proving the request
    // itself carries that scoping rather than merely trusting the caller.
    const allTrades = [
      { id: 1, orderId: 100, symbol: 'BTCUSDT', price: '60000', qty: '0.005', commission: '0.03', commissionAsset: 'USDT', time: 1700000001000 },
      { id: 2, orderId: 200, symbol: 'BTCUSDT', price: '61000', qty: '0.010', commission: '0.06', commissionAsset: 'USDT', time: 1700000002000 },
      { id: 3, orderId: 200, symbol: 'BTCUSDT', price: '61010', qty: '0.010', commission: '0.06', commissionAsset: 'USDT', time: 1700000003000 },
    ]
    fetchMock.mockImplementation(async (url: string) => {
      const match = url.match(/orderId=(\d+)/)
      expect(match).not.toBeNull() // the request MUST include orderId — this is the actual regression assertion
      const requestedOrderId = Number(match![1])
      return jsonResponse(allTrades.filter((t) => t.orderId === requestedOrderId))
    })

    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })

    // Order 100's own fills — exactly its one trade, never order 200's two.
    const order100Fills = await provider.getOrderFills({ providerSymbol: 'BTCUSDT', clientOrderId: 't-order-100', providerOrderId: '100' })
    expect(order100Fills).toHaveLength(1)
    expect(order100Fills[0].providerOrderId).toBe('100')
    expect(order100Fills.every((f) => f.providerOrderId === '100')).toBe(true)

    // Order 200's own fills — exactly its two trades, never order 100's.
    const order200Fills = await provider.getOrderFills({ providerSymbol: 'BTCUSDT', clientOrderId: 't-order-200', providerOrderId: '200' })
    expect(order200Fills).toHaveLength(2)
    expect(order200Fills.every((f) => f.providerOrderId === '200')).toBe(true)

    // Same URL-level proof, directly on the request the mock received.
    const [order100Url] = fetchMock.mock.calls[0]
    expect(order100Url).toContain('orderId=100')
    const [order200Url] = fetchMock.mock.calls[1]
    expect(order200Url).toContain('orderId=200')
  })

  it('20. an exchange-reported status TRUST does not recognize normalizes to UNKNOWN, never a guess', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ symbol: 'BTCUSDT', orderId: 4, status: 'SOME_NEW_BINANCE_STATUS', origQty: '0.01', executedQty: '0' }))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const res = await provider.getOrderStatus({ providerSymbol: 'BTCUSDT', clientOrderId: 't-6' })
    expect(res.status).toBe('UNKNOWN')
  })

  it('21. a request that times out normalizes to TIMEOUT (not retryable — Part 14 requires a status query first, never a blind retry)', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const promise = provider.getAccountBalances()
    await expect(promise).rejects.toMatchObject({ category: 'TIMEOUT', retryable: false })
  }, 15_000)

  it('22. normalizes a 5xx into PROVIDER_UNAVAILABLE (retryable)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -1, msg: 'Internal error' }, false, 503))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(provider.getAccountBalances()).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE', retryable: true })
  })

  it('23. normalizes Binance code -2011 (duplicate/unknown order) into DUPLICATE_CLIENT_ORDER_ID', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: -2011, msg: 'Duplicate order sent' }, false, 400))
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    await expect(
      provider.submitMarketOrder({ clientOrderId: 't-dup', providerSymbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' }),
    ).rejects.toMatchObject({ category: 'DUPLICATE_CLIENT_ORDER_ID' })
  })

  it('24. getOpenOrders maps every row into a normalized ProviderOrderResponse, symbol/clientOrderId taken from each row', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { symbol: 'BTCUSDT', orderId: 10, clientOrderId: 't-open-1', status: 'NEW', origQty: '0.01', executedQty: '0', side: 'BUY', type: 'LIMIT', price: '60000' },
        { symbol: 'ETHUSDT', orderId: 11, clientOrderId: 't-open-2', status: 'PARTIALLY_FILLED', origQty: '1', executedQty: '0.4', side: 'SELL', type: 'LIMIT', price: '2000' },
      ]),
    )
    const provider = new BinanceSandboxProvider({ apiKey: 'k', apiSecret: 's' })
    const orders = await provider.getOpenOrders()
    expect(orders).toHaveLength(2)
    expect(orders[0]).toMatchObject({ clientOrderId: 't-open-1', providerSymbol: 'BTCUSDT', status: 'NEW' })
    expect(orders[1]).toMatchObject({ clientOrderId: 't-open-2', providerSymbol: 'ETHUSDT', status: 'PARTIALLY_FILLED', executedQuantity: '0.4' })
  })
})

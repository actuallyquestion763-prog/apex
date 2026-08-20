import { FakeExecutionProvider } from './fake-execution.provider'
import { ProviderError } from '../execution-provider.types'
import { deriveClientOrderId, newExecutionAttemptId } from '../client-order-id'
import type { ProviderOrderRequest } from '../execution-provider.types'

// Contract tests for the deterministic in-process fake — Step 14/15. These
// are the tests later checkpoints' real MARKET/LIMIT/cancel/reconciliation
// logic will be built and verified against, so every scenario Step 14 lists
// must be provably deterministic here, with no reliance on Math.random(),
// timers, or real network access.
describe('FakeExecutionProvider — contract', () => {
  let provider: FakeExecutionProvider

  beforeEach(() => {
    provider = new FakeExecutionProvider()
  })

  function marketRequest(overrides: Partial<ProviderOrderRequest> = {}): ProviderOrderRequest {
    const clientOrderId = deriveClientOrderId(newExecutionAttemptId())
    return { clientOrderId, providerSymbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01', ...overrides }
  }

  it('1. accepted market order fills immediately and fully', async () => {
    const res = await provider.submitMarketOrder(marketRequest())
    expect(res.status).toBe('FILLED')
    expect(res.executedQuantity).toBe('0.01')
    expect(res.fills.length).toBe(1)
    expect(res.providerOrderId).not.toBeNull()
  })

  it('2. rejected order (REJECT_ prefixed symbol) throws a categorized, non-retryable ProviderError', async () => {
    await expect(provider.submitMarketOrder(marketRequest({ providerSymbol: 'REJECT_BTCUSDT' }))).rejects.toMatchObject({
      category: 'ORDER_REJECTED',
      retryable: false,
    })
  })

  it('3. limit order opens (NEW), does not fill immediately', async () => {
    const res = await provider.submitLimitOrder(marketRequest({ type: 'LIMIT', price: '60000' }))
    expect(res.status).toBe('NEW')
    expect(res.executedQuantity).toBe('0')
  })

  it('4. partial fill via simulateFill, then full fill on a second call', async () => {
    const req = marketRequest({ type: 'LIMIT', price: '60000', quantity: '1' })
    const opened = await provider.submitLimitOrder(req)
    const partial = provider.simulateFill(opened.clientOrderId, '0.4', '60000')
    expect(partial.status).toBe('PARTIALLY_FILLED')
    expect(partial.executedQuantity).toBe('0.4')

    const full = provider.simulateFill(opened.clientOrderId, '0.6', '60000')
    expect(full.status).toBe('FILLED')
    expect(full.executedQuantity).toBe('1')
    expect(full.fills.length).toBe(2)
  })

  it('5. full fill in one simulateFill call reaches FILLED directly', async () => {
    const req = marketRequest({ type: 'LIMIT', price: '60000', quantity: '1' })
    const opened = await provider.submitLimitOrder(req)
    const filled = provider.simulateFill(opened.clientOrderId, '1', '60000')
    expect(filled.status).toBe('FILLED')
  })

  it('6. cancellation of an open order succeeds', async () => {
    const req = marketRequest({ type: 'LIMIT', price: '60000' })
    const opened = await provider.submitLimitOrder(req)
    const cancelled = await provider.cancelOrder({ providerSymbol: req.providerSymbol, clientOrderId: opened.clientOrderId })
    expect(cancelled.status).toBe('CANCELED')
  })

  it('7. cancel-vs-fill race: if the order is already FILLED, cancelOrder never overwrites it to CANCELED — the fill wins', async () => {
    const req = marketRequest({ type: 'LIMIT', price: '60000', quantity: '1' })
    const opened = await provider.submitLimitOrder(req)
    provider.simulateFill(opened.clientOrderId, '1', '60000') // fills before the cancel "arrives"
    const result = await provider.cancelOrder({ providerSymbol: req.providerSymbol, clientOrderId: opened.clientOrderId })
    expect(result.status).toBe('FILLED')
  })

  it('8. timeout: submit throws TIMEOUT, but the order WAS actually processed provider-side — a status query with the SAME clientOrderId reveals it', async () => {
    const req = marketRequest({ providerSymbol: 'TIMEOUT_BTCUSDT' })
    await expect(provider.submitMarketOrder(req)).rejects.toMatchObject({ category: 'TIMEOUT', retryable: false })

    // The critical safety property (Step 13): querying by the SAME
    // clientOrderId after a timeout resolves the real state — it does not
    // stay permanently unknown, and a caller does not need to guess.
    const status = await provider.getOrderStatus({ providerSymbol: req.providerSymbol, clientOrderId: req.clientOrderId })
    expect(status.status).toBe('FILLED') // MARKET order — fills immediately provider-side
  })

  it('9. lost response behaves identically to timeout (separately named for test clarity, same underlying mechanism)', async () => {
    const req = marketRequest({ providerSymbol: 'LOSTRESPONSE_BTCUSDT', type: 'LIMIT', price: '100' })
    await expect(provider.submitLimitOrder(req)).rejects.toMatchObject({ category: 'TIMEOUT' })
    const status = await provider.getOrderStatus({ providerSymbol: req.providerSymbol, clientOrderId: req.clientOrderId })
    expect(status.status).toBe('NEW') // LIMIT order — opens, does not auto-fill
  })

  it('10. duplicate clientOrderId reuse on a still-open order is rejected, never silently creates a second order', async () => {
    const req = marketRequest({ type: 'LIMIT', price: '60000' })
    await provider.submitLimitOrder(req) // still NEW (open)
    await expect(provider.submitLimitOrder(req)).rejects.toMatchObject({
      category: 'DUPLICATE_CLIENT_ORDER_ID',
      retryable: false,
    })
  })

  it('10b. re-submitting a clientOrderId whose order already FILLED returns the existing filled order idempotently, not a new one', async () => {
    const req = marketRequest() // MARKET — fills immediately
    const first = await provider.submitMarketOrder(req)
    const second = await provider.submitMarketOrder(req)
    expect(second).toEqual(first)
  })

  it('11. provider unavailable (UNAVAILABLE_ prefixed symbol) throws on every method, not just submit', async () => {
    const symbol = 'UNAVAILABLE_BTCUSDT'
    await expect(provider.submitMarketOrder(marketRequest({ providerSymbol: symbol }))).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' })
    await expect(provider.getMarketStatus(symbol)).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' })
    await expect(provider.getSymbolInfo(symbol)).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' })
  })

  it('11b. setUnhealthy(true) makes every method unavailable regardless of symbol', async () => {
    provider.setUnhealthy(true)
    await expect(provider.submitMarketOrder(marketRequest())).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' })
    const health = await provider.healthCheck()
    expect(health.connectivity).toBe('unreachable')
    expect(health.executionAvailable).toBe(false)
  })

  it('12. rate limited (RATELIMIT_ prefixed symbol) throws a retryable ProviderError', async () => {
    await expect(provider.submitMarketOrder(marketRequest({ providerSymbol: 'RATELIMIT_BTCUSDT' }))).rejects.toMatchObject({
      category: 'RATE_LIMITED',
      retryable: true,
    })
  })

  it('13. an unrecognized clientOrderId returns UNKNOWN status, never fabricated as REJECTED or FILLED', async () => {
    const status = await provider.getOrderStatus({ providerSymbol: 'BTCUSDT', clientOrderId: 'never-submitted' })
    expect(status.status).toBe('UNKNOWN')
    expect(status.providerOrderId).toBeNull()
  })

  it('an unconfigured symbol returns UNKNOWN status info, with every filter explicitly "unsupported" — never invented', async () => {
    const info = await provider.getSymbolInfo('NEVERCONFIGURED')
    expect(info.status).toBe('UNKNOWN')
    expect(info.minQuantity).toBe('unsupported')
    expect(info.minNotional).toBe('unsupported')
  })

  it('configureSymbol lets a test set real filter values explicitly', async () => {
    provider.configureSymbol('BTCUSDT', { baseAsset: 'BTC', quoteAsset: 'USDT', minQuantity: '0.00001', minNotional: '10' })
    const info = await provider.getSymbolInfo('BTCUSDT')
    expect(info.baseAsset).toBe('BTC')
    expect(info.minQuantity).toBe('0.00001')
  })

  it('getOpenOrders only returns NEW/PARTIALLY_FILLED/PENDING_CANCEL orders, filterable by symbol', async () => {
    const open = await provider.submitLimitOrder(marketRequest({ type: 'LIMIT', price: '1', providerSymbol: 'ETHUSDT' }))
    await provider.submitMarketOrder(marketRequest({ providerSymbol: 'BTCUSDT' })) // fills immediately, not "open"

    const allOpen = await provider.getOpenOrders()
    expect(allOpen.map((o) => o.clientOrderId)).toEqual([open.clientOrderId])

    const filtered = await provider.getOpenOrders('ETHUSDT')
    expect(filtered.length).toBe(1)
    const filteredOut = await provider.getOpenOrders('SOLUSDT')
    expect(filteredOut.length).toBe(0)
  })

  it('getAccountBalances reflects only what a test explicitly configures — never a fabricated balance', async () => {
    expect(await provider.getAccountBalances()).toEqual([])
    provider.setBalances([{ asset: 'USDT', free: '1000', locked: '0' }])
    expect(await provider.getAccountBalances()).toEqual([{ asset: 'USDT', free: '1000', locked: '0' }])
  })

  it('healthCheck reports ok/available by default, never claims healthy once setUnhealthy(true)', async () => {
    const healthy = await provider.healthCheck()
    expect(healthy.connectivity).toBe('ok')
    expect(healthy.executionAvailable).toBe(true)
  })

  it('getOrderFills returns exactly the fills recorded for that order, empty for none', async () => {
    const req = marketRequest({ type: 'LIMIT', price: '60000' })
    const opened = await provider.submitLimitOrder(req)
    expect(await provider.getOrderFills({ providerSymbol: req.providerSymbol, clientOrderId: opened.clientOrderId })).toEqual([])
    provider.simulateFill(opened.clientOrderId, '0.01', '60000')
    const fills = await provider.getOrderFills({ providerSymbol: req.providerSymbol, clientOrderId: opened.clientOrderId })
    expect(fills.length).toBe(1)
  })

  it('reset() clears all state', async () => {
    await provider.submitMarketOrder(marketRequest())
    provider.setBalances([{ asset: 'USDT', free: '1', locked: '0' }])
    provider.reset()
    expect(await provider.getAccountBalances()).toEqual([])
    expect(await provider.getOpenOrders()).toEqual([])
  })

  it('ProviderError is a real Error instance with the thrown category preserved', async () => {
    try {
      await provider.submitMarketOrder(marketRequest({ providerSymbol: 'REJECT_X' }))
      fail('expected a throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect(err).toBeInstanceOf(Error)
      expect((err as ProviderError).category).toBe('ORDER_REJECTED')
    }
  })
})

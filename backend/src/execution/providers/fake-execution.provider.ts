import { Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import type {
  ExecutionProvider,
  ExecutionProviderHealth,
  ProviderBalance,
  ProviderFill,
  ProviderMarketStatus,
  ProviderOrderQuery,
  ProviderOrderRequest,
  ProviderOrderResponse,
  ProviderOrderStatus,
  ProviderSymbolInfo,
} from '../execution-provider.types'
import { ProviderError } from '../execution-provider.types'

type Scenario = 'REJECT' | 'RATELIMIT' | 'TIMEOUT' | 'LOSTRESPONSE' | 'UNAVAILABLE' | 'MALFORMED' | 'MULTIFILL' | 'CANCEL_REJECT' | 'UNKNOWN_STATUS' | 'MISSING_ORDER'

// Deterministic, in-memory execution provider — Step 5/14. Exists ONLY for
// automated contract testing. It NEVER touches PrismaService, LedgerService,
// or any customer balance — it has no dependency on either, by construction,
// so there is no code path here that could accidentally settle a real
// transaction (Step 5: "The fake provider must NEVER touch customer ledger
// balances automatically").
//
// Every scenario Step 14 lists is reachable DETERMINISTICALLY, two ways:
//
//  1. providerSymbol PREFIX (e.g. "REJECT_FOO") — simple, self-contained,
//     used by Checkpoint B's execution-only tests where providerSymbol has
//     no other meaning.
//
//  2. queueScenario() (Phase 6F Checkpoint C addition) — for tests where
//     providerSymbol must ALSO be a real Binance pair (e.g. "BTCUSDT"),
//     because OrdersService's CRYPTO_SPOT/LIVE path uses the SAME
//     MarketConfig.providerSymbol for both real market-data lookups
//     (MarketDataService -> the real BinanceProvider) AND execution
//     (this fake). An invented symbol like "REJECT_BTCUSDT" would make the
//     real market-data quote check fail for the wrong reason (unrecognized
//     Binance symbol) before execution is ever reached. queueScenario()
//     lets a test keep a genuine Binance symbol and still script the next
//     submit() call's outcome — consumed exactly once, then reverts to
//     normal behavior.
//
// Scenario meanings (identical whichever way they're triggered):
//   REJECT       -> submit throws ProviderError('ORDER_REJECTED')
//   UNAVAILABLE  -> every method throws ProviderError('PROVIDER_UNAVAILABLE')
//   RATELIMIT    -> submit throws ProviderError('RATE_LIMITED')
//   TIMEOUT      -> submit records the order as ACCEPTED internally (as a
//                   real exchange would have), then throws
//                   ProviderError('TIMEOUT') to the caller — simulating a
//                   response that was lost in transit AFTER the provider
//                   already processed it. A subsequent getOrderStatus()
//                   call with the SAME clientOrderId reveals the real
//                   state, proving the "query, don't retry blind" pattern
//                   (Step 13) actually resolves correctly.
//   LOSTRESPONSE -> identical mechanism to TIMEOUT, named separately so a
//                   test can express "the network dropped the response"
//                   distinctly from "the provider was slow", even though
//                   from TRUST's side both are observationally identical
//                   (Step 13 explicitly treats them the same way).
//   MALFORMED    -> fillImmediately() returns a single, deliberately
//                   invalid fill (price: '0') — Checkpoint C, Part 5/17#28.
//   MULTIFILL    -> fillImmediately() splits into TWO fills at two
//                   different prices — Checkpoint C, Part 6/17#10-11.
//   CANCEL_REJECT -> cancelOrder() throws ProviderError('INVALID_REQUEST')
//                   instead of cancelling — Checkpoint D, Part 25#7 (the
//                   provider itself refuses the cancel request).
//   UNKNOWN_STATUS -> getOrderStatus()/getOrderFills() throw
//                   ProviderError('UNKNOWN_PROVIDER_STATE') instead of
//                   answering — Checkpoint D, Part 25#12 (distinct from an
//                   unrecognized clientOrderId, which returns a normal
//                   UNKNOWN-status response rather than throwing: this
//                   scenario models a KNOWN order the provider currently
//                   can't report on).
//
// Price/fee simulation (Phase 6F Checkpoint C): a MARKET order needs SOME
// price to fill at. setSimulatedPrice() lets a test set one explicitly
// (deliberately DIFFERENT from whatever "display" quote a test also mocks
// via MarketDataService, to prove settlement uses the FILL price, never the
// displayed estimate — Part 3's core requirement); unset defaults to '1'.
// Fees default to 0.1% of the trade's quote-currency notional, charged in
// the quote asset (inferred from providerSymbol via a small suffix
// heuristic, or set explicitly via configureSymbol) — a deliberately simple
// fake-provider-only default, not a claim about any real exchange's fee
// schedule. Overridable per symbol via setFeeConfig().
const DEFAULT_FEE_RATE = '0.001'
const KNOWN_QUOTE_SUFFIXES = ['USDT', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB']
const PREFIX_SCENARIOS: Array<[string, Scenario]> = [
  ['REJECT_', 'REJECT'],
  ['RATELIMIT_', 'RATELIMIT'],
  ['TIMEOUT_', 'TIMEOUT'],
  ['LOSTRESPONSE_', 'LOSTRESPONSE'],
  ['UNAVAILABLE_', 'UNAVAILABLE'],
  ['MALFORMED_', 'MALFORMED'],
  ['MULTIFILL_', 'MULTIFILL'],
  ['CANCELREJECT_', 'CANCEL_REJECT'],
  ['UNKNOWNSTATUS_', 'UNKNOWN_STATUS'],
]

@Injectable()
export class FakeExecutionProvider implements ExecutionProvider {
  readonly name = 'Fake'

  private readonly orders = new Map<string, ProviderOrderResponse>()
  private readonly symbolInfo = new Map<string, ProviderSymbolInfo>()
  private readonly marketStatus = new Map<string, ProviderMarketStatus>()
  private readonly simulatedPrices = new Map<string, string>()
  private readonly feeConfig = new Map<string, { rate: string; asset?: string }>()
  private readonly scenarioQueue = new Map<string, Scenario[]>()
  private balances: ProviderBalance[] = []
  private unhealthy = false
  private fillCounter = 0

  // ---- Test control surface — never called by production code paths ------

  configureSymbol(providerSymbol: string, info: Partial<ProviderSymbolInfo>): void {
    this.symbolInfo.set(providerSymbol, {
      providerSymbol,
      baseAsset: 'unsupported',
      quoteAsset: 'unsupported',
      status: 'TRADING',
      pricePrecision: 'unsupported',
      quantityPrecision: 'unsupported',
      minQuantity: 'unsupported',
      maxQuantity: 'unsupported',
      minNotional: 'unsupported',
      ...info,
    })
  }

  setMarketStatus(providerSymbol: string, status: ProviderMarketStatus): void {
    this.marketStatus.set(providerSymbol, status)
  }

  setBalances(balances: ProviderBalance[]): void {
    this.balances = balances
  }

  setUnhealthy(unhealthy: boolean): void {
    this.unhealthy = unhealthy
  }

  // The price a MARKET order fills at for this symbol. Deliberately a
  // separate concept from any "display" quote a test mocks elsewhere.
  setSimulatedPrice(providerSymbol: string, price: string): void {
    this.simulatedPrices.set(providerSymbol, price)
  }

  setFeeConfig(providerSymbol: string, config: { rate?: string; asset?: string }): void {
    this.feeConfig.set(providerSymbol, { rate: config.rate ?? DEFAULT_FEE_RATE, asset: config.asset })
  }

  // Scripts the outcome of the NEXT submit() call for this providerSymbol
  // (FIFO if called more than once), without requiring providerSymbol
  // itself to carry a magic prefix — see the file header comment for why
  // this exists alongside the prefix convention.
  queueScenario(providerSymbol: string, scenario: Scenario): void {
    const q = this.scenarioQueue.get(providerSymbol) ?? []
    q.push(scenario)
    this.scenarioQueue.set(providerSymbol, q)
  }

  // Simulates the provider filling (fully or partially) an already-open
  // order — e.g. a resting LIMIT order. Never invoked automatically; a test
  // calls this to advance a scenario deterministically.
  //
  // `fillId`, when supplied, forces the fill's providerFillId instead of
  // auto-generating a fresh one — Checkpoint D, Part 13/25#10 ("provider
  // returns fill F123 again"): a test calls simulateFill(..., 'F123') twice
  // to prove the CALLER's own deduplication (not this fake's) rejects the
  // repeat. The fake itself does not deduplicate — it is a faithful record
  // of "what the provider reported," including a genuine repeat if asked
  // for one; TRUST's own dedup logic is what's under test.
  simulateFill(clientOrderId: string, quantity: string, price: string, fee = '0', feeAsset?: string, fillId?: string): ProviderOrderResponse {
    const order = this.requireOrder(clientOrderId)
    this.fillCounter += 1
    const fill: ProviderFill = {
      providerFillId: fillId ?? `fake-fill-${this.fillCounter}`,
      providerOrderId: order.providerOrderId ?? `fake-order-${clientOrderId}`,
      price,
      quantity,
      fee,
      feeAsset: feeAsset ?? this.resolveFeeAsset(order.providerSymbol),
      executedAt: new Date().toISOString(),
    }
    const newExecuted = new Decimal(order.executedQuantity).plus(quantity).toString()
    const filled = new Decimal(newExecuted).gte(order.requestedQuantity)
    const updated: ProviderOrderResponse = {
      ...order,
      executedQuantity: newExecuted,
      status: filled ? 'FILLED' : 'PARTIALLY_FILLED',
      fills: [...order.fills, fill],
      receivedAt: new Date().toISOString(),
    }
    this.orders.set(clientOrderId, updated)
    return updated
  }

  // Simulates the provider itself cancelling/expiring an order (distinct
  // from cancelOrder(), which represents TRUST asking the provider to
  // cancel) — useful for EXPIRED-style scenarios.
  simulateProviderStatusChange(clientOrderId: string, status: ProviderOrderStatus): void {
    const order = this.requireOrder(clientOrderId)
    this.orders.set(clientOrderId, { ...order, status, receivedAt: new Date().toISOString() })
  }

  reset(): void {
    this.orders.clear()
    this.symbolInfo.clear()
    this.marketStatus.clear()
    this.simulatedPrices.clear()
    this.feeConfig.clear()
    this.scenarioQueue.clear()
    this.balances = []
    this.unhealthy = false
    this.fillCounter = 0
  }

  // ---- ExecutionProvider implementation -----------------------------------

  async getMarketStatus(providerSymbol: string): Promise<ProviderMarketStatus> {
    this.guardAvailability(providerSymbol)
    return this.marketStatus.get(providerSymbol) ?? { providerSymbol, tradingEnabled: true }
  }

  async getSymbolInfo(providerSymbol: string): Promise<ProviderSymbolInfo> {
    this.guardAvailability(providerSymbol)
    const existing = this.symbolInfo.get(providerSymbol)
    if (existing) return existing
    // Unconfigured symbol: honest "we don't know", never a guessed filter
    // (Step 10) — status UNKNOWN, every filter 'unsupported'.
    return {
      providerSymbol,
      baseAsset: 'unsupported',
      quoteAsset: 'unsupported',
      status: 'UNKNOWN',
      pricePrecision: 'unsupported',
      quantityPrecision: 'unsupported',
      minQuantity: 'unsupported',
      maxQuantity: 'unsupported',
      minNotional: 'unsupported',
    }
  }

  async submitMarketOrder(request: ProviderOrderRequest): Promise<ProviderOrderResponse> {
    return this.submit(request, 'MARKET')
  }

  async submitLimitOrder(request: ProviderOrderRequest): Promise<ProviderOrderResponse> {
    if (!request.quantity) throw new ProviderError('INVALID_REQUEST', 'A LIMIT order requires quantity.', false)
    return this.submit(request, 'LIMIT')
  }

  private async submit(request: ProviderOrderRequest, type: 'MARKET' | 'LIMIT'): Promise<ProviderOrderResponse> {
    this.guardAvailability(request.providerSymbol)

    if (!request.quantity && !request.quoteOrderQty) {
      throw new ProviderError('INVALID_REQUEST', 'Order requires either quantity or quoteOrderQty.', false)
    }

    const existing = this.orders.get(request.clientOrderId)
    if (existing) {
      // Verified Binance behavior (rest-api.md, newClientOrderId): reuse is
      // only accepted once the PREVIOUS order with that id is filled;
      // otherwise the new submission is rejected. Binance's docs don't
      // specify what happens on a genuine re-submit of an ALREADY-filled id
      // — this fake's deliberate, documented choice is to return the
      // existing filled order idempotently (the safest interpretation for
      // TRUST's own retry-after-uncertain-outcome flow, Step 13).
      if (existing.status === 'FILLED') return existing
      throw new ProviderError('DUPLICATE_CLIENT_ORDER_ID', `clientOrderId ${request.clientOrderId} is already open and not yet filled.`, false)
    }

    const scenario = this.resolveScenario(request.providerSymbol)

    if (scenario === 'REJECT') {
      throw new ProviderError('ORDER_REJECTED', `Fake provider: order for ${request.providerSymbol} rejected by design (test scenario).`, false)
    }
    if (scenario === 'RATELIMIT') {
      throw new ProviderError('RATE_LIMITED', `Fake provider: rate limited (test scenario).`, true)
    }

    // quoteOrderQty (MARKET only, verified real Binance capability — see
    // execution-provider.types.ts) — the base quantity is DERIVED from the
    // simulated fill price, exactly like a real exchange would compute it.
    // requestedQuantity always ends up base-asset-denominated, matching
    // ProviderOrderResponse's documented shape.
    const requestedQuantity = request.quantity ?? new Decimal(request.quoteOrderQty!).div(this.priceFor(request.providerSymbol)).toString()

    const base: ProviderOrderResponse = {
      clientOrderId: request.clientOrderId,
      providerOrderId: `fake-order-${request.clientOrderId}`,
      status: 'NEW',
      providerSymbol: request.providerSymbol,
      side: request.side,
      type,
      requestedQuantity,
      executedQuantity: '0',
      price: request.price ?? null,
      fills: [],
      receivedAt: new Date().toISOString(),
    }

    if (scenario === 'TIMEOUT' || scenario === 'LOSTRESPONSE') {
      // The provider "accepted" the order (recorded internally) but the
      // caller never gets to see this return value — simulating a response
      // lost after successful processing.
      const accepted: ProviderOrderResponse = type === 'MARKET' ? this.fillImmediately(base, null) : base
      this.orders.set(request.clientOrderId, accepted)
      throw new ProviderError('TIMEOUT', `Fake provider: response lost for ${request.clientOrderId} (test scenario) — order WAS processed provider-side.`, false)
    }

    // Default behavior: MARKET fills immediately and fully (a real spot
    // market order does not rest); LIMIT opens and stays NEW until a test
    // calls simulateFill/simulateProviderStatusChange or cancelOrder().
    const fillScenario = scenario === 'MALFORMED' || scenario === 'MULTIFILL' ? scenario : null
    const result = type === 'MARKET' ? this.fillImmediately(base, fillScenario) : base
    this.orders.set(request.clientOrderId, result)
    return result
  }

  private fillImmediately(order: ProviderOrderResponse, fillScenario: 'MALFORMED' | 'MULTIFILL' | null): ProviderOrderResponse {
    const price = order.price ?? this.priceFor(order.providerSymbol)
    const feeCfg = this.feeConfig.get(order.providerSymbol)
    const feeRate = feeCfg?.rate ?? DEFAULT_FEE_RATE
    const feeAsset = feeCfg?.asset ?? this.resolveFeeAsset(order.providerSymbol)

    // MALFORMED (Phase 6F Checkpoint C, Part 5/17#28) — deterministically
    // produces a single, deliberately invalid fill (zero price) so the
    // caller's fill-validation path can be proven end-to-end, not just unit
    // tested against a hand-built object.
    if (fillScenario === 'MALFORMED') {
      this.fillCounter += 1
      const badFill: ProviderFill = {
        providerFillId: `fake-fill-${this.fillCounter}`,
        providerOrderId: order.providerOrderId ?? `fake-order-${order.clientOrderId}`,
        price: '0', // invalid — never a real exchange price
        quantity: order.requestedQuantity,
        fee: '0',
        feeAsset,
        executedAt: new Date().toISOString(),
      }
      return { ...order, status: 'FILLED', executedQuantity: order.requestedQuantity, fills: [badFill] }
    }

    // MULTIFILL (Part 6/17#10-11) — deterministically splits one MARKET
    // order into TWO fills at two different prices, so multi-fill
    // aggregation (SUM quantity, weighted-average price, SUM fee) is
    // provable end-to-end rather than only at the private-method level.
    if (fillScenario === 'MULTIFILL') {
      const total = new Decimal(order.requestedQuantity)
      const half = total.div(2)
      const priceA = new Decimal(price)
      const priceB = priceA.times('1.01') // deliberately different, to prove weighted averaging
      this.fillCounter += 2
      const fillA: ProviderFill = {
        providerFillId: `fake-fill-${this.fillCounter - 1}`,
        providerOrderId: order.providerOrderId ?? `fake-order-${order.clientOrderId}`,
        price: priceA.toString(),
        quantity: half.toString(),
        fee: half.times(priceA).times(feeRate).toString(),
        feeAsset,
        executedAt: new Date().toISOString(),
      }
      const fillB: ProviderFill = {
        providerFillId: `fake-fill-${this.fillCounter}`,
        providerOrderId: order.providerOrderId ?? `fake-order-${order.clientOrderId}`,
        price: priceB.toString(),
        quantity: total.minus(half).toString(),
        fee: total.minus(half).times(priceB).times(feeRate).toString(),
        feeAsset,
        executedAt: new Date().toISOString(),
      }
      return { ...order, status: 'FILLED', executedQuantity: order.requestedQuantity, fills: [fillA, fillB] }
    }

    this.fillCounter += 1
    const notional = new Decimal(order.requestedQuantity).times(price)
    const fee = notional.times(feeRate).toString()
    const fill: ProviderFill = {
      providerFillId: `fake-fill-${this.fillCounter}`,
      providerOrderId: order.providerOrderId ?? `fake-order-${order.clientOrderId}`,
      price,
      quantity: order.requestedQuantity,
      fee,
      feeAsset,
      executedAt: new Date().toISOString(),
    }
    return { ...order, status: 'FILLED', executedQuantity: order.requestedQuantity, fills: [fill] }
  }

  async getOrderStatus(query: ProviderOrderQuery): Promise<ProviderOrderResponse> {
    this.guardAvailability(query.providerSymbol)
    if (this.consumeTargetedScenario(query.providerSymbol, 'UNKNOWN_STATUS')) {
      throw new ProviderError('UNKNOWN_PROVIDER_STATE', `Fake provider: status unknown for ${query.providerSymbol} (test scenario).`, false)
    }
    // MISSING_ORDER (Phase 6F Checkpoint E, Part 6/18#2) — forces the
    // "unrecognized" response shape below even for a clientOrderId this
    // fake DOES have on record, simulating a provider that has genuinely
    // lost the order (e.g. a testnet reset — Binance's own testnet resets
    // "approximately monthly" per its documentation) rather than merely
    // being slow or unreachable (UNKNOWN_STATUS/PROVIDER_UNAVAILABLE).
    if (this.consumeTargetedScenario(query.providerSymbol, 'MISSING_ORDER')) {
      return {
        clientOrderId: query.clientOrderId,
        providerOrderId: null,
        status: 'UNKNOWN',
        providerSymbol: query.providerSymbol,
        side: 'BUY',
        type: 'MARKET',
        requestedQuantity: '0',
        executedQuantity: '0',
        price: null,
        fills: [],
        receivedAt: new Date().toISOString(),
      }
    }
    const order = this.orders.get(query.clientOrderId)
    if (order) return order
    // Step 3/15: an unrecognized clientOrderId is reported UNKNOWN, never
    // fabricated as REJECTED — TRUST genuinely does not know what happened
    // to an order it can't find (could be a provider it never reached).
    return {
      clientOrderId: query.clientOrderId,
      providerOrderId: null,
      status: 'UNKNOWN',
      providerSymbol: query.providerSymbol,
      side: 'BUY',
      type: 'MARKET',
      requestedQuantity: '0',
      executedQuantity: '0',
      price: null,
      fills: [],
      receivedAt: new Date().toISOString(),
    }
  }

  async getOrderFills(query: ProviderOrderQuery): Promise<ProviderFill[]> {
    this.guardAvailability(query.providerSymbol)
    if (this.consumeTargetedScenario(query.providerSymbol, 'UNKNOWN_STATUS')) {
      throw new ProviderError('UNKNOWN_PROVIDER_STATE', `Fake provider: fills unknown for ${query.providerSymbol} (test scenario).`, false)
    }
    return this.orders.get(query.clientOrderId)?.fills ?? []
  }

  async cancelOrder(query: ProviderOrderQuery): Promise<ProviderOrderResponse> {
    this.guardAvailability(query.providerSymbol)
    if (this.consumeTargetedScenario(query.providerSymbol, 'CANCEL_REJECT')) {
      throw new ProviderError('INVALID_REQUEST', `Fake provider: cancel rejected for ${query.providerSymbol} (test scenario).`, false)
    }
    const order = this.requireOrder(query.clientOrderId)
    // Cancel-vs-fill race (Step 14): if the order already reached a
    // terminal filled state before this cancel arrived, the fill wins —
    // never overwritten to CANCELED.
    if (order.status === 'FILLED') return order
    const cancelled: ProviderOrderResponse = { ...order, status: 'CANCELED', receivedAt: new Date().toISOString() }
    this.orders.set(query.clientOrderId, cancelled)
    return cancelled
  }

  async getAccountBalances(): Promise<ProviderBalance[]> {
    return this.balances
  }

  async getOpenOrders(providerSymbol?: string): Promise<ProviderOrderResponse[]> {
    return Array.from(this.orders.values()).filter(
      (o) => (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED' || o.status === 'PENDING_CANCEL') && (!providerSymbol || o.providerSymbol === providerSymbol),
    )
  }

  async healthCheck(): Promise<ExecutionProviderHealth> {
    return {
      provider: this.name,
      environment: 'test',
      connectivity: this.unhealthy ? 'unreachable' : 'ok',
      marketDataAvailable: !this.unhealthy,
      executionAvailable: !this.unhealthy,
      checkedAt: new Date().toISOString(),
    }
  }

  // ---- internal ------------------------------------------------------------

  // Queued scenario takes priority (consumed exactly once); falls back to
  // the providerSymbol prefix convention for backward compatibility with
  // Checkpoint B's tests. Returns null for ordinary, unscripted behavior.
  private resolveScenario(providerSymbol: string): Scenario | null {
    const queue = this.scenarioQueue.get(providerSymbol)
    if (queue && queue.length > 0) return queue.shift()!
    for (const [prefix, scenario] of PREFIX_SCENARIOS) {
      if (providerSymbol.startsWith(prefix)) return scenario
    }
    return null
  }

  // Consumes a queued or prefix-triggered scenario ONLY if it exactly
  // matches `match` — unlike resolveScenario() (submit()'s consumer, which
  // owns the whole queue head), this never eats a DIFFERENT scenario that
  // was queued for another call (e.g. a REJECT meant for the next submit()
  // must survive a getOrderStatus() call that only cares about
  // UNKNOWN_STATUS).
  private consumeTargetedScenario(providerSymbol: string, match: Scenario): boolean {
    const queue = this.scenarioQueue.get(providerSymbol)
    if (queue && queue[0] === match) {
      queue.shift()
      return true
    }
    return PREFIX_SCENARIOS.some(([prefix, scenario]) => scenario === match && providerSymbol.startsWith(prefix))
  }

  // Checked at the start of every ExecutionProvider method (not just
  // submit) — a queued UNAVAILABLE is consumed on whichever call happens
  // to come first, modeling "the provider was down for this one attempt."
  // For an outage spanning multiple calls, use setUnhealthy(true) instead
  // (deliberately persistent, not a one-shot).
  private guardAvailability(providerSymbol: string): void {
    if (this.unhealthy || providerSymbol.startsWith('UNAVAILABLE_')) {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Fake provider: unavailable.', true)
    }
    const queue = this.scenarioQueue.get(providerSymbol)
    if (queue && queue[0] === 'UNAVAILABLE') {
      queue.shift()
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Fake provider: unavailable (test scenario).', true)
    }
  }

  private requireOrder(clientOrderId: string): ProviderOrderResponse {
    const order = this.orders.get(clientOrderId)
    if (!order) throw new ProviderError('INVALID_REQUEST', `No known order for clientOrderId ${clientOrderId}.`, false)
    return order
  }

  private priceFor(providerSymbol: string): string {
    return this.simulatedPrices.get(providerSymbol) ?? '1'
  }

  private resolveFeeAsset(providerSymbol: string): string {
    const configured = this.symbolInfo.get(providerSymbol)
    if (configured && configured.quoteAsset !== 'unsupported') return configured.quoteAsset
    for (const suffix of KNOWN_QUOTE_SUFFIXES) {
      if (providerSymbol.endsWith(suffix) && providerSymbol.length > suffix.length) return suffix
    }
    return 'USDT'
  }
}

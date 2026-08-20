// Provider-neutral EXECUTION model (Phase 6F, Checkpoint B) — the trading
// equivalent of markets/market-data.types.ts. Nothing outside this module
// and its adapters should ever see a raw provider (e.g. Binance) response
// shape; every adapter normalizes into these types before anything else in
// the application sees it.
//
// HARD BOUNDARY for this checkpoint: nothing in this file, or any adapter
// implementing ExecutionProvider, may touch LedgerService, write an Order/
// Fill row, or otherwise affect a customer's balance. This is infrastructure
// only — settlement is a later checkpoint's job (see orders.service.ts,
// unchanged this checkpoint).
import type { OrderSide } from '@prisma/client'

// ---------------------------------------------------------------------------
// Order status — verified against Binance's real Spot API docs
// (binance-spot-api-docs/rest-api.md, New Order / Query Order sections,
// fetched 2026-08-18): a real order can be NEW, PARTIALLY_FILLED, FILLED,
// CANCELED, PENDING_CANCEL, REJECTED, or EXPIRED. 'UNKNOWN' is NOT a
// Binance status — it is TRUST's own safe fallback for "we asked the
// provider and could not get a definitive answer" (timeout, lost response,
// provider unavailable). Never collapsed into REJECTED or FILLED — see
// Step 13's timeout design and client-order-id.ts.
export type ProviderOrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'PENDING_CANCEL'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNKNOWN'

export type ProviderOrderType = 'MARKET' | 'LIMIT'

// A stable request TRUST hands to a provider. `clientOrderId` is always
// TRUST-generated (see client-order-id.ts) — never left for the provider to
// assign — so a lost response can always be resolved by re-querying with the
// SAME id rather than guessing whether a retry is safe.
//
// quantity vs quoteOrderQty (Phase 6F Checkpoint C — resolves Phase 6E §7's
// open question): exactly one of the two must be set.
//   - `quantity` — base-asset units (e.g. "0.01" BTC). Required for LIMIT
//     orders and for MARKET SELL (the customer specifies how much of the
//     asset they hold to sell).
//   - `quoteOrderQty` — quote-asset amount to spend/receive, MARKET orders
//     only. Verified against Binance's real, current Spot API docs (New
//     Order endpoint, fetched 2026-08-18): "specifies the amount the user
//     wants to spend (when buying)... the correct quantity will be
//     determined based on market liquidity and quoteOrderQty." Using this
//     for MARKET BUY means TRUST never needs to guess a base quantity from
//     a display price to size the reservation — the provider caps quote
//     spend at exactly this amount, by design, on a real exchange.
export interface ProviderOrderRequest {
  clientOrderId: string
  providerSymbol: string // the PROVIDER's own symbol (e.g. "BTCUSDT"), matching MarketConfig.providerSymbol — never TRUST's own "BTC/USDT"
  side: OrderSide
  type: ProviderOrderType
  quantity?: string
  quoteOrderQty?: string
  price?: string // required for LIMIT, absent for MARKET
}

// What identifies an already-submitted order for a status/cancel/fills
// lookup. Deliberately keyed by clientOrderId (TRUST's own stable id), with
// providerOrderId carried alongside once known — never queried by
// providerOrderId ALONE, since that value doesn't exist until the provider
// has acknowledged the order, which is exactly the case a lost response
// can't assume.
export interface ProviderOrderQuery {
  providerSymbol: string
  clientOrderId: string
  providerOrderId?: string | null
}

export interface ProviderFill {
  providerFillId: string
  providerOrderId: string
  price: string
  quantity: string
  fee: string
  feeAsset: string
  executedAt: string // ISO
}

// The normalized response for submit/status/cancel — all three return this
// same shape so a caller doesn't need three different result types to
// reason about "what state is this order in right now."
export interface ProviderOrderResponse {
  clientOrderId: string
  providerOrderId: string | null // null only when the provider never acknowledged the order at all (e.g. UNKNOWN after a timeout)
  status: ProviderOrderStatus
  providerSymbol: string
  side: OrderSide
  type: ProviderOrderType
  requestedQuantity: string
  executedQuantity: string
  price: string | null // LIMIT price if applicable; null for MARKET
  fills: ProviderFill[]
  rejectReason?: string
  receivedAt: string // ISO — when TRUST received this specific response, distinct from any fill's executedAt
}

export interface ProviderBalance {
  asset: string
  free: string
  locked: string
}

// Step 10: never invented. Precision/min-quantity/min-notional/max-quantity
// are 'unsupported' when a provider genuinely doesn't expose the filter,
// never a guessed number.
export type ProviderFilterValue = string | 'unsupported'

export interface ProviderSymbolInfo {
  providerSymbol: string
  baseAsset: string | 'unsupported'
  quoteAsset: string | 'unsupported'
  status: 'TRADING' | 'BREAK' | 'HALT' | 'UNKNOWN'
  pricePrecision: number | 'unsupported'
  quantityPrecision: number | 'unsupported'
  minQuantity: ProviderFilterValue
  maxQuantity: ProviderFilterValue
  minNotional: ProviderFilterValue
}

export interface ProviderMarketStatus {
  providerSymbol: string
  tradingEnabled: boolean
  reason?: string
}

// ---------------------------------------------------------------------------
// Error normalization (Step 12) — every ExecutionProvider method throws
// ONLY this type on failure (never a raw provider error, never a raw HTTP
// error) so callers can branch on `.category` without knowing which
// provider is behind the interface. `message` is safe to log; it must never
// contain a credential (enforced by convention in each adapter — see
// binance-sandbox.provider.ts, which never interpolates the API secret into
// any string).
export type ProviderErrorCategory =
  | 'INVALID_REQUEST'
  | 'INVALID_SYMBOL'
  | 'INSUFFICIENT_PROVIDER_BALANCE'
  | 'RATE_LIMITED'
  | 'AUTHENTICATION_FAILED'
  | 'MARKET_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'DUPLICATE_CLIENT_ORDER_ID'
  | 'ORDER_REJECTED'
  | 'UNKNOWN_PROVIDER_STATE'

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory
  // Whether the SAME request is safe to retry as a fresh attempt (a new
  // clientOrderId) without any status query first. Only ever true for
  // errors where TRUST knows for certain nothing was accepted
  // (INVALID_REQUEST, INVALID_SYMBOL) — TIMEOUT/PROVIDER_UNAVAILABLE/
  // UNKNOWN_PROVIDER_STATE are always retryable=false: the caller MUST
  // query status by the existing clientOrderId first (Step 13).
  readonly retryable: boolean

  constructor(category: ProviderErrorCategory, message: string, retryable: boolean) {
    super(message)
    this.name = 'ProviderError'
    this.category = category
    this.retryable = retryable
  }
}

// ---------------------------------------------------------------------------
// Health check (Step 9) — structured, never a bare boolean, and never
// "healthy" just because config exists.
export interface ExecutionProviderHealth {
  provider: string
  environment: string
  connectivity: 'ok' | 'unreachable' | 'unknown'
  marketDataAvailable: boolean
  executionAvailable: boolean
  checkedAt: string // ISO
  detail?: string
}

// ---------------------------------------------------------------------------
// The interface itself. Business logic (a future OrdersService change) will
// depend on ONLY this — never on BinanceSandboxProvider or FakeExecutionProvider
// directly (mirrors MarketDataProvider's role in markets/market-data.types.ts).
export interface ExecutionProvider {
  readonly name: string

  getMarketStatus(providerSymbol: string): Promise<ProviderMarketStatus>
  getSymbolInfo(providerSymbol: string): Promise<ProviderSymbolInfo>

  submitMarketOrder(request: ProviderOrderRequest): Promise<ProviderOrderResponse>
  submitLimitOrder(request: ProviderOrderRequest): Promise<ProviderOrderResponse>

  getOrderStatus(query: ProviderOrderQuery): Promise<ProviderOrderResponse>
  getOrderFills(query: ProviderOrderQuery): Promise<ProviderFill[]>
  cancelOrder(query: ProviderOrderQuery): Promise<ProviderOrderResponse>

  getAccountBalances(): Promise<ProviderBalance[]>
  getOpenOrders(providerSymbol?: string): Promise<ProviderOrderResponse[]>

  healthCheck(): Promise<ExecutionProviderHealth>
}

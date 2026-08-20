import { createHmac } from 'crypto'
import { Logger } from '@nestjs/common'
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

// Binance Spot TESTNET adapter (Phase 6F, Step 5/6) — verified against
// Binance's real, current documentation on 2026-08-18:
//   - Base URL (testnet.binance.vision landing page): the Spot Test Network
//     uses `https://testnet.binance.vision/api` in place of production's
//     `https://api.binance.com/api` — every other path segment is
//     documented as identical to the production Spot API.
//   - Auth (same page): HMAC-SHA-256 (also RSA/Ed25519, not used here) —
//     API key sent via the `X-MBX-APIKEY` header, request signed with the
//     secret over the query string.
//   - Endpoints (binance-spot-api-docs/rest-api.md, fetched the same day):
//     POST /api/v3/order (SIGNED, newClientOrderId supported, auto-generated
//     if omitted — TRUST always supplies one, see client-order-id.ts),
//     GET /api/v3/order (SIGNED, query by orderId or origClientOrderId),
//     DELETE /api/v3/order (SIGNED, same query keys), GET /api/v3/myTrades
//     (SIGNED, fills), GET /api/v3/account (SIGNED, balances),
//     GET /api/v3/openOrders (SIGNED), GET /api/v3/exchangeInfo (PUBLIC,
//     symbol status + filters), GET /api/v3/ping (PUBLIC, connectivity).
//   - Order statuses confirmed present in the docs: NEW, PARTIALLY_FILLED,
//     FILLED, CANCELED, PENDING_CANCEL, REJECTED, EXPIRED.
//   - newClientOrderId reuse rule confirmed (see client-order-id.ts's
//     header comment for the exact quote and what it means for retries).
//
// NOT independently verified this checkpoint (REQUIRES VERIFICATION before
// this adapter is ever exercised against a live testnet account): the
// testnet's current rate limits, whether every documented production
// endpoint is mirrored 1:1, the exact set of Binance numeric error codes
// this environment returns, and the testnet's actual current uptime/reset
// schedule (the portal states "resets approximately monthly" — treat any
// testnet-held state as ephemeral).
//
// SAFETY: BASE_URL is a hardcoded module-level constant, never a
// configuration value — this class has no code path, environment variable,
// or constructor argument that can point it at api.binance.com. If Binance
// production execution is ever built, it MUST be a separate class, never a
// parameterized version of this one (see execution-provider.factory.ts —
// the factory is what actually prevents this adapter from being selected
// outside development/test/staging, not this file).
const BASE_URL = 'https://testnet.binance.vision/api'

export interface BinanceSandboxCredentials {
  apiKey: string
  apiSecret: string
}

export class BinanceSandboxProvider implements ExecutionProvider {
  readonly name = 'BinanceSandbox'
  private readonly logger = new Logger('BinanceSandboxProvider')

  constructor(private readonly credentials: BinanceSandboxCredentials) {
    if (!credentials.apiKey || !credentials.apiSecret) {
      // Fail closed (Step 6) — never construct a half-configured adapter
      // that would only fail later, mid-request, in a way that's harder to
      // trace back to "credentials were never set."
      throw new Error('BinanceSandboxProvider requires both apiKey and apiSecret.')
    }
  }

  async getMarketStatus(providerSymbol: string): Promise<ProviderMarketStatus> {
    const info = await this.getSymbolInfo(providerSymbol)
    return { providerSymbol, tradingEnabled: info.status === 'TRADING', reason: info.status !== 'TRADING' ? `Binance reports symbol status ${info.status}.` : undefined }
  }

  async getSymbolInfo(providerSymbol: string): Promise<ProviderSymbolInfo> {
    const data = await this.publicRequest<{ symbols: any[] }>('/v3/exchangeInfo', { symbol: providerSymbol })
    const symbol = data.symbols?.[0]
    if (!symbol) throw new ProviderError('INVALID_SYMBOL', `Binance testnet does not recognize symbol ${providerSymbol}.`, false)

    const filters: any[] = symbol.filters ?? []
    const lotSize = filters.find((f) => f.filterType === 'LOT_SIZE')
    const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER')
    // Binance has used both MIN_NOTIONAL and NOTIONAL filter type names
    // across API versions — check both rather than assuming one.
    const notional = filters.find((f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL')

    return {
      providerSymbol,
      baseAsset: typeof symbol.baseAsset === 'string' ? symbol.baseAsset : 'unsupported',
      quoteAsset: typeof symbol.quoteAsset === 'string' ? symbol.quoteAsset : 'unsupported',
      status: symbol.status === 'TRADING' || symbol.status === 'BREAK' || symbol.status === 'HALT' ? symbol.status : 'UNKNOWN',
      pricePrecision: typeof symbol.quoteAssetPrecision === 'number' ? symbol.quoteAssetPrecision : 'unsupported',
      quantityPrecision: typeof symbol.baseAssetPrecision === 'number' ? symbol.baseAssetPrecision : 'unsupported',
      minQuantity: lotSize?.minQty ?? 'unsupported',
      maxQuantity: lotSize?.maxQty ?? 'unsupported',
      minNotional: notional?.minNotional ?? 'unsupported',
    }
  }

  async submitMarketOrder(request: ProviderOrderRequest): Promise<ProviderOrderResponse> {
    return this.submit(request, 'MARKET')
  }

  async submitLimitOrder(request: ProviderOrderRequest): Promise<ProviderOrderResponse> {
    if (!request.price) throw new ProviderError('INVALID_REQUEST', 'A LIMIT order requires a price.', false)
    return this.submit(request, 'LIMIT')
  }

  private async submit(request: ProviderOrderRequest, type: 'MARKET' | 'LIMIT'): Promise<ProviderOrderResponse> {
    if (!request.quantity && !request.quoteOrderQty) {
      throw new ProviderError('INVALID_REQUEST', 'Order requires either quantity or quoteOrderQty.', false)
    }
    const params: Record<string, string> = {
      symbol: request.providerSymbol,
      side: request.side,
      type,
      newClientOrderId: request.clientOrderId,
    }
    // quoteOrderQty (MARKET only) — verified real Binance parameter (New
    // Order endpoint): "specifies the amount the user wants to spend...
    // the correct quantity will be determined based on market liquidity
    // and quoteOrderQty." Mutually exclusive with `quantity` on Binance's
    // real API for a MARKET order — never send both.
    if (type === 'MARKET' && request.quoteOrderQty) {
      params.quoteOrderQty = request.quoteOrderQty
    } else {
      params.quantity = request.quantity!
    }
    if (type === 'LIMIT') {
      params.price = request.price!
      // GTC (Good-Til-Canceled) — Binance requires timeInForce for LIMIT
      // orders; GTC is the standard default across the documented API.
      // Whether TRUST ever wants IOC/FOK instead is a future product
      // decision, not made here.
      params.timeInForce = 'GTC'
    }
    const data = await this.signedRequest<any>('POST', '/v3/order', params)
    return this.toOrderResponse(request.clientOrderId, request.providerSymbol, data)
  }

  async getOrderStatus(query: ProviderOrderQuery): Promise<ProviderOrderResponse> {
    const data = await this.signedRequest<any>('GET', '/v3/order', {
      symbol: query.providerSymbol,
      origClientOrderId: query.clientOrderId,
    })
    return this.toOrderResponse(query.clientOrderId, query.providerSymbol, data)
  }

  async getOrderFills(query: ProviderOrderQuery): Promise<ProviderFill[]> {
    const params: Record<string, string> = { symbol: query.providerSymbol }
    if (query.providerOrderId) params.orderId = query.providerOrderId
    const rows = await this.signedRequest<any[]>('GET', '/v3/myTrades', params)
    return rows.map((r) => this.toFill(r))
  }

  async cancelOrder(query: ProviderOrderQuery): Promise<ProviderOrderResponse> {
    const data = await this.signedRequest<any>('DELETE', '/v3/order', {
      symbol: query.providerSymbol,
      origClientOrderId: query.clientOrderId,
    })
    return this.toOrderResponse(query.clientOrderId, query.providerSymbol, data)
  }

  async getAccountBalances(): Promise<ProviderBalance[]> {
    const data = await this.signedRequest<{ balances: any[] }>('GET', '/v3/account', {})
    return (data.balances ?? []).map((b) => ({ asset: b.asset, free: b.free, locked: b.locked }))
  }

  async getOpenOrders(providerSymbol?: string): Promise<ProviderOrderResponse[]> {
    const params: Record<string, string> = providerSymbol ? { symbol: providerSymbol } : {}
    const rows = await this.signedRequest<any[]>('GET', '/v3/openOrders', params)
    return rows.map((r) => this.toOrderResponse(r.clientOrderId, r.symbol, r))
  }

  async healthCheck(): Promise<ExecutionProviderHealth> {
    try {
      await this.publicRequest('/v3/ping', {})
      return {
        provider: this.name,
        environment: 'staging',
        connectivity: 'ok',
        marketDataAvailable: true,
        // Reachability alone does not prove the credentials are valid — a
        // real "can we actually trade" check would need a signed call
        // (e.g. getAccountBalances), which this checkpoint does not perform
        // automatically (Step 9: "do not claim healthy merely because
        // configuration exists" — connectivity and execution readiness are
        // reported as the separate things they are).
        executionAvailable: false,
        checkedAt: new Date().toISOString(),
        detail: 'Connectivity confirmed via /v3/ping. Signed-endpoint reachability not checked by healthCheck() — call getAccountBalances() to verify credentials.',
      }
    } catch (err) {
      return {
        provider: this.name,
        environment: 'staging',
        connectivity: 'unreachable',
        marketDataAvailable: false,
        executionAvailable: false,
        checkedAt: new Date().toISOString(),
        detail: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  // ---- signing / transport ---------------------------------------------

  private sign(queryString: string): string {
    return createHmac('sha256', this.credentials.apiSecret).update(queryString).digest('hex')
  }

  private async publicRequest<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(params).toString()
    const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`
    return this.fetchJson<T>(url, { method: 'GET' })
  }

  private async signedRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string>): Promise<T> {
    const timestamp = Date.now().toString()
    const fullParams = { ...params, timestamp, recvWindow: '5000' }
    const query = new URLSearchParams(fullParams).toString()
    const signature = this.sign(query)
    const url = `${BASE_URL}${path}?${query}&signature=${signature}`
    return this.fetchJson<T>(url, { method, headers: { 'X-MBX-APIKEY': this.credentials.apiKey } })
  }

  private async fetchJson<T>(url: string, init: { method: string; headers?: Record<string, string> }): Promise<T> {
    let res: Response
    try {
      // 10s timeout — Binance testnet has no documented SLA; TRUST must
      // never hang indefinitely waiting on it (Step 13 depends on a
      // TIMEOUT actually being observable, not an unbounded hang).
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        res = await fetch(url, { ...init, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError('TIMEOUT', 'Binance sandbox request timed out.', false)
      }
      // Never includes `url` verbatim in the thrown message beyond the
      // path — the query string carries the signature, which must never be
      // logged even though it isn't the secret itself (defense in depth).
      throw new ProviderError('PROVIDER_UNAVAILABLE', `Binance sandbox network failure: ${err instanceof Error ? err.message : 'unknown'}`, true)
    }

    if (!res.ok) {
      throw await this.normalizeError(res)
    }
    try {
      return (await res.json()) as T
    } catch {
      throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Binance sandbox returned a non-JSON response.', false)
    }
  }

  private async normalizeError(res: Response): Promise<ProviderError> {
    let code: number | undefined
    let msg = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { code?: number; msg?: string }
      code = body.code
      msg = body.msg ?? msg
    } catch {
      // Non-JSON error body — fall through with the HTTP status alone.
    }

    if (res.status === 429 || res.status === 418) return new ProviderError('RATE_LIMITED', `Binance sandbox rate limited: ${msg}`, true)
    if (res.status === 401 || res.status === 403) return new ProviderError('AUTHENTICATION_FAILED', `Binance sandbox authentication failed: ${msg}`, false)
    if (res.status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', `Binance sandbox server error: ${msg}`, true)

    // Common documented Binance error codes — mapped conservatively; any
    // code not explicitly listed here falls through to
    // UNKNOWN_PROVIDER_STATE rather than being guessed at (Step 12).
    switch (code) {
      case -1121: // Invalid symbol
        return new ProviderError('INVALID_SYMBOL', msg, false)
      case -2010: // Account has insufficient balance (NEW_ORDER_REJECTED)
        return new ProviderError('INSUFFICIENT_PROVIDER_BALANCE', msg, false)
      case -2011: // Unknown order / duplicate
        return new ProviderError('DUPLICATE_CLIENT_ORDER_ID', msg, false)
      case -2013: // Order does not exist
        return new ProviderError('UNKNOWN_PROVIDER_STATE', msg, false)
      case -1013: // Filter failure (LOT_SIZE, MIN_NOTIONAL, etc.)
      case -1100: // Illegal characters
      case -1102: // Mandatory param missing/malformed
        return new ProviderError('INVALID_REQUEST', msg, false)
      default:
        this.logger.warn(`Unmapped Binance sandbox error code ${code ?? '(none)'}: ${msg}`)
        return new ProviderError('UNKNOWN_PROVIDER_STATE', msg, false)
    }
  }

  private toOrderResponse(clientOrderId: string, providerSymbol: string, data: any): ProviderOrderResponse {
    const status: ProviderOrderStatus = isKnownStatus(data?.status) ? data.status : 'UNKNOWN'
    return {
      clientOrderId,
      providerOrderId: data?.orderId != null ? String(data.orderId) : null,
      status,
      providerSymbol,
      side: data?.side === 'SELL' ? 'SELL' : 'BUY',
      type: data?.type === 'LIMIT' ? 'LIMIT' : 'MARKET',
      requestedQuantity: data?.origQty ?? '0',
      executedQuantity: data?.executedQty ?? '0',
      price: data?.price ?? null,
      fills: Array.isArray(data?.fills) ? data.fills.map((f: any) => this.toFill(f, data?.orderId)) : [],
      receivedAt: new Date().toISOString(),
    }
  }

  private toFill(raw: any, providerOrderId?: string | number): ProviderFill {
    return {
      providerFillId: String(raw.id ?? raw.tradeId ?? ''),
      providerOrderId: String(raw.orderId ?? providerOrderId ?? ''),
      price: raw.price,
      quantity: raw.qty,
      fee: raw.commission ?? '0',
      feeAsset: raw.commissionAsset ?? 'unknown',
      executedAt: raw.time ? new Date(Number(raw.time)).toISOString() : new Date().toISOString(),
    }
  }
}

function isKnownStatus(value: unknown): value is ProviderOrderStatus {
  return typeof value === 'string' && ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'PENDING_CANCEL', 'REJECTED', 'EXPIRED'].includes(value)
}

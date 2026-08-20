// Provider-neutral market-data model (Phase 6B, Part 2). Nothing outside
// this module and market-data.service.ts should ever see a raw provider
// response shape — every adapter normalizes into this before it goes
// anywhere else in the application.

// LIVE: a fresh, validated quote from a real external provider.
// SIMULATED: internally generated — must never be presented as LIVE, ever
// (see markets/providers/simulated.provider.ts and StatusBadge.tsx on the
// frontend, which visually distinguishes this on purpose).
// STALE: the last known-valid quote, now older than the configured
// freshness threshold — still shown (never blanked to protect UX), but
// never relabeled LIVE.
// UNAVAILABLE: no usable quote exists at all (no provider configured, the
// provider is down with no prior cached quote, or the instrument doesn't
// exist) — the honest "we have nothing" state; never fabricated.
export type QuoteStatus = 'LIVE' | 'SIMULATED' | 'STALE' | 'UNAVAILABLE'

export interface MarketQuote {
  symbol: string // TRUST's own symbol, e.g. "XAU/USD"
  bid: number | null
  ask: number | null
  last: number
  timestamp: string // ISO — when the underlying price was actually observed (provider's own timestamp when available)
  source: string // 'GOLDAPI' | 'SIMULATED' | 'BINANCE' | ...
  receivedAt: string // ISO — when THIS backend received/generated it (distinct from `timestamp` — a provider can hand back an old timestamp)
  status: QuoteStatus
  // ---- 24h statistics (Phase 6C, Part 10) — optional and independent of
  // `last`/`bid`/`ask`. Only ever populated when the provider actually
  // supplies them (Binance's 24hr ticker does; GoldAPI/Simulated don't) —
  // null/undefined here means "not available from this provider", never a
  // computed or guessed value. Deliberately NOT historical candle data —
  // see MarketCandle below, a separate concept (Part 10: "do not confuse
  // 24-hour statistics with historical candle data").
  priceChange?: number | null
  priceChangePercent?: number | null
  highPrice?: number | null
  lowPrice?: number | null
  volume?: number | null
  quoteVolume?: number | null
}

// The one shape returned when no usable quote exists — deliberately has no
// `last`/`bid`/`ask` fields at all, so a caller can't accidentally read a
// stale/zero/fabricated number out of it. See Part 9/24 — never invent a
// replacement price.
export interface UnavailableQuote {
  symbol: string
  status: 'UNAVAILABLE'
  reason: string
}

export type QuoteResult = MarketQuote | UnavailableQuote

export function isUnavailable(q: QuoteResult): q is UnavailableQuote {
  return q.status === 'UNAVAILABLE'
}

// A single candle. Previously only ever produced by the SIMULATED provider
// (Phase 6B) — Phase 6C adds a real source (Binance klines) for Binance-
// backed symbols specifically. GoldAPI still supplies none (Part 11 — no
// real OHLC provider exists for XAU/USD in this project); that stays an
// honest empty/OHLC_UNAVAILABLE result, never fabricated, for any LIVE
// market data.service.ts doesn't have real candles for.
export interface MarketCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Standard interval strings, matching Binance's own kline interval values
// (Part 11 — "only if actually needed by the current UI"; TradePage/
// CandlestickChart only ever use 1m/5m/1h today, but the type isn't
// artificially restricted to just those three).
export type KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export interface KlineRequest {
  providerSymbol: string
  interval: KlineInterval
  limit: number
}

// Historical candles are a genuinely optional capability — GoldAPI and
// SimulatedProvider don't implement this at all (checked via `in` at the
// call site in MarketDataService, not a no-op stub), so a provider without
// real history support simply isn't asked for one, rather than returning
// an empty array that could be mistaken for "fetched successfully, zero
// candles".
export interface MarketDataProviderWithHistory extends MarketDataProvider {
  getKlines(request: KlineRequest): Promise<MarketCandle[]>
}

export function supportsHistory(provider: MarketDataProvider): provider is MarketDataProviderWithHistory {
  return typeof (provider as Partial<MarketDataProviderWithHistory>).getKlines === 'function'
}

// What the Market Data Service asks an adapter to fetch — deliberately the
// PROVIDER's own symbol (see Part 11), never TRUST's internal symbol; the
// service layer is responsible for that translation before calling in.
export interface ProviderQuoteRequest {
  providerSymbol: string
}

// Implemented once per real external data source. The rest of the
// application (MarketDataService, MarketsController, OrdersService) only
// ever depends on this interface — never on a concrete provider — so a
// provider can be added or swapped without touching anything else (Part 5).
export interface MarketDataProvider {
  readonly name: string
  getQuote(request: ProviderQuoteRequest): Promise<RawProviderQuote>
  healthCheck(): Promise<boolean>
}

// What an adapter hands back BEFORE validation — deliberately loose/
// nullable, since this is exactly the shape most likely to contain
// malformed data from a real external API. MarketDataService.validate()
// (Part 10) is what turns this into a trustworthy MarketQuote or rejects
// it outright.
export interface RawProviderQuote {
  bid: number | null
  ask: number | null
  last: number | null
  timestampSeconds: number | null
  // Optional 24h stats — see MarketQuote's equivalent fields. Absent
  // entirely (not just null) for providers that never supply them.
  priceChange?: number | null
  priceChangePercent?: number | null
  highPrice?: number | null
  lowPrice?: number | null
  volume?: number | null
  quoteVolume?: number | null
}

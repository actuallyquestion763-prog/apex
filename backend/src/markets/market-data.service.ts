import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { GoldApiProvider } from './providers/goldapi.provider'
import { SimulatedProvider } from './providers/simulated.provider'
import { BinanceProvider } from './providers/binance.provider'
import { supportsHistory } from './market-data.types'
import type { KlineInterval, MarketCandle, MarketDataProvider, MarketQuote, QuoteResult, RawProviderQuote } from './market-data.types'

/**
 * Central Market Data Service (Phase 6B, Part 2/5/7/8/9/10).
 *
 * The ONLY place in the application that talks to a MarketDataProvider
 * adapter, caches a quote, or decides LIVE/STALE/UNAVAILABLE. Everything
 * else (MarketsController, OrdersService) goes through this.
 *
 * Flow: instrument lookup (DB) -> symbol mapping (Part 11) -> provider
 * adapter -> validation (Part 10) -> cache (Part 8) -> normalized
 * MarketQuote (Part 2).
 *
 * HARD BOUNDARY (Part 19): this service never touches LedgerService,
 * AccountsService, DepositsService, WithdrawalsService, or any Prisma model
 * beyond MarketConfig (read-only). A market quote is informational only.
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger('MarketDataService')
  private readonly cache = new Map<string, { quote: MarketQuote; receivedAt: number }>()

  // A quote fetched within this window is reported LIVE (or SIMULATED) —
  // matches the pre-existing 30s GoldAPI cache TTL this project already
  // used (server/market.js, then markets.service.ts) before this phase;
  // not a newly invented number. Also the interval used to avoid
  // re-fetching the upstream provider on every request (Part 7/16 — don't
  // hammer the provider).
  private readonly FRESH_MS = 30_000
  // Beyond FRESH_MS but within this window, the last cached quote is still
  // shown, explicitly marked STALE — never re-labeled LIVE. Set to 4x
  // FRESH_MS (2 minutes) as a reasonable, documented default: long enough
  // to ride out a brief provider hiccup without flashing "unavailable",
  // short enough that a genuinely stuck feed doesn't masquerade as usable
  // for an extended period. PROPOSED, not a business requirement.
  private readonly STALE_MS = this.FRESH_MS * 4

  private readonly providers: Record<string, MarketDataProvider>

  constructor(
    private readonly prisma: PrismaService,
    goldApi: GoldApiProvider,
    simulated: SimulatedProvider,
    binance: BinanceProvider,
  ) {
    this.providers = { GOLDAPI: goldApi, SIMULATED: simulated, BINANCE: binance }
  }

  async getQuote(symbol: string): Promise<QuoteResult> {
    const instrument = await this.prisma.marketConfig.findUnique({ where: { symbol } })
    if (!instrument || !instrument.enabled) {
      return { symbol, status: 'UNAVAILABLE', reason: 'Instrument is not configured or is disabled.' }
    }
    if (!instrument.provider || !instrument.providerSymbol) {
      return { symbol, status: 'UNAVAILABLE', reason: 'No market-data provider is configured for this instrument.' }
    }
    const provider = this.providers[instrument.provider]
    if (!provider) {
      this.logger.warn(`Unknown provider "${instrument.provider}" configured for symbol ${symbol}`)
      return { symbol, status: 'UNAVAILABLE', reason: 'Configured provider is not recognized.' }
    }

    const cached = this.cache.get(symbol)
    const now = Date.now()
    if (cached && now - cached.receivedAt < this.FRESH_MS) {
      return cached.quote
    }

    try {
      const raw = await provider.getQuote({ providerSymbol: instrument.providerSymbol })
      const validated = this.validate(raw, symbol)
      const quote: MarketQuote = {
        symbol,
        bid: validated.bid,
        ask: validated.ask,
        last: validated.last,
        timestamp: validated.timestampSeconds ? new Date(validated.timestampSeconds * 1000).toISOString() : new Date().toISOString(),
        source: provider.name,
        receivedAt: new Date(now).toISOString(),
        // Keyed off the stable MarketConfig.provider value, not the
        // adapter's own display .name (a cosmetic label that shouldn't be
        // load-bearing for a LIVE/SIMULATED trust decision).
        status: instrument.provider === 'SIMULATED' ? 'SIMULATED' : 'LIVE',
        // 24h stats (Part 10) — only ever present when the provider
        // actually supplied them (GoldAPI/Simulated never do; Binance
        // does) — never computed or guessed here. A non-finite value in
        // one of these SUPPLEMENTARY fields is downgraded to null rather
        // than invalidating the whole quote (unlike last/bid/ask, which
        // are core price data and reject the entire quote on failure).
        priceChange: finiteOrNull(raw.priceChange),
        priceChangePercent: finiteOrNull(raw.priceChangePercent),
        highPrice: finiteOrNull(raw.highPrice),
        lowPrice: finiteOrNull(raw.lowPrice),
        volume: finiteOrNull(raw.volume),
        quoteVolume: finiteOrNull(raw.quoteVolume),
      }
      this.cache.set(symbol, { quote, receivedAt: now })
      return quote
    } catch (err) {
      // Never logs the raw error object verbatim (could theoretically
      // contain a URL with query params in some future provider) — only a
      // short message. Provider adapters are themselves responsible for
      // never including a credential in a thrown message (see
      // GoldApiProvider — the API key is a header, never interpolated into
      // any string this catches).
      const message = err instanceof Error ? err.message : 'Unknown provider error'
      this.logger.warn(`Quote fetch failed for ${symbol} via ${provider.name}: ${message}`)
      return this.staleOrUnavailable(symbol, cached, now, message)
    }
  }

  async getQuotes(symbols: string[]): Promise<QuoteResult[]> {
    // Only ever resolves symbols that are actually configured instruments —
    // an unknown symbol never becomes an arbitrary outbound request (Part 12).
    return Promise.all(symbols.map((s) => this.getQuote(s)))
  }

  // Historical candles (Part 11) — a separate, optional capability from
  // getQuote(). Only ever returns real provider data (Binance klines
  // today) or an explicit unavailable result — never generates a candle
  // itself. Deliberately does NOT go through the quote cache/staleness
  // machinery above (candles are a bulk historical fetch, not a live tick;
  // MarketDataService still owns it so this stays the one place that talks
  // to provider adapters, per Part 2's "do not create a second market-data
  // architecture").
  async getCandles(symbol: string, interval: KlineInterval, limit = 60): Promise<{ candles: MarketCandle[] } | { candles: null; reason: string }> {
    const instrument = await this.prisma.marketConfig.findUnique({ where: { symbol } })
    if (!instrument || !instrument.enabled || !instrument.provider || !instrument.providerSymbol) {
      return { candles: null, reason: 'Instrument is not configured or is disabled.' }
    }
    const provider = this.providers[instrument.provider]
    if (!provider || !supportsHistory(provider)) {
      // Honest OHLC_UNAVAILABLE (Part 11) — e.g. GoldAPI/XAU-USD has no
      // real history provider in this project; never fabricated.
      return { candles: null, reason: 'OHLC_UNAVAILABLE' }
    }
    try {
      const candles = await provider.getKlines({ providerSymbol: instrument.providerSymbol, interval, limit })
      return { candles }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown provider error'
      this.logger.warn(`Klines fetch failed for ${symbol} via ${provider.name}: ${message}`)
      return { candles: null, reason: 'OHLC_UNAVAILABLE' }
    }
  }

  async listInstruments() {
    return this.prisma.marketConfig.findMany({ where: { enabled: true }, orderBy: { symbol: 'asc' } })
  }

  async getInstrument(symbol: string) {
    return this.prisma.marketConfig.findUnique({ where: { symbol } })
  }

  private staleOrUnavailable(
    symbol: string,
    cached: { quote: MarketQuote; receivedAt: number } | undefined,
    now: number,
    reason: string,
  ): QuoteResult {
    if (cached && now - cached.receivedAt < this.STALE_MS) {
      return { ...cached.quote, status: 'STALE' }
    }
    return { symbol, status: 'UNAVAILABLE', reason }
  }

  // Price validation (Part 10) — rejects a quote outright rather than ever
  // passing a malformed value downstream. A rejection here is caught by the
  // caller (getQuote's try/catch) and handled exactly like a provider
  // failure: fall back to STALE/UNAVAILABLE, never publish the bad value.
  private validate(raw: RawProviderQuote, symbol: string): { last: number; bid: number | null; ask: number | null; timestampSeconds: number | null } {
    if (raw.last === null || !Number.isFinite(raw.last)) {
      throw new Error(`Invalid last price for ${symbol}: ${raw.last}`)
    }
    if (raw.last <= 0) {
      throw new Error(`Non-positive price for ${symbol}: ${raw.last}`)
    }
    if (raw.bid !== null && !Number.isFinite(raw.bid)) throw new Error(`Invalid bid for ${symbol}: ${raw.bid}`)
    if (raw.ask !== null && !Number.isFinite(raw.ask)) throw new Error(`Invalid ask for ${symbol}: ${raw.ask}`)
    if (raw.bid !== null && raw.bid < 0) throw new Error(`Negative bid for ${symbol}: ${raw.bid}`)
    if (raw.ask !== null && raw.ask < 0) throw new Error(`Negative ask for ${symbol}: ${raw.ask}`)
    if (raw.bid !== null && raw.ask !== null && raw.bid > raw.ask) {
      throw new Error(`Invalid bid/ask relationship for ${symbol}: bid ${raw.bid} > ask ${raw.ask}`)
    }
    if (raw.timestampSeconds !== null) {
      if (!Number.isFinite(raw.timestampSeconds) || raw.timestampSeconds <= 0) {
        throw new Error(`Invalid timestamp for ${symbol}: ${raw.timestampSeconds}`)
      }
      // A timestamp more than a day in the future is not a freshness issue,
      // it's a malformed/corrupt response — reject outright rather than
      // caching something that would never age into STALE.
      const oneDayMs = 24 * 60 * 60 * 1000
      if (raw.timestampSeconds * 1000 > Date.now() + oneDayMs) {
        throw new Error(`Timestamp too far in the future for ${symbol}: ${raw.timestampSeconds}`)
      }
    }
    return { last: raw.last, bid: raw.bid, ask: raw.ask, timestampSeconds: raw.timestampSeconds }
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

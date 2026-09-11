import { Injectable, Logger } from '@nestjs/common'
import type { KlineInterval, KlineRequest, MarketCandle, MarketDataProviderWithHistory, ProviderQuoteRequest, RawProviderQuote } from '../market-data.types'

// The first REAL crypto market-data provider (Phase 6C) — Binance Spot
// PUBLIC market data only (https://github.com/binance/binance-spot-api-docs).
// No API key is used or required: every endpoint here is publicly
// documented as not requiring authentication (see market_data_only.md in
// that repo). This class never places, cancels, or manages an order, never
// touches an account/user-data endpoint, and never signs a request —
// doing so would require an API key, which this project deliberately does
// not have and was not asked to obtain.
//
// RATE-LIMIT-CONSCIOUS BY DESIGN (Part 21): a naive per-symbol getQuote()
// implementation would make 2 HTTP calls per symbol per refresh (16 calls
// for TRUST's 8 configured pairs) every poll cycle. Instead this adapter
// batches: it tracks every providerSymbol it has ever been asked for, and
// a single refresh() call fetches ALL of them in exactly 2 requests
// (bookTicker + ticker/24hr, both of which accept a `symbols` array —
// documented, not guessed), regardless of how many individual getQuote()
// calls triggered it. Concurrent callers requesting different symbols in
// the same tick coalesce onto the SAME in-flight refresh via `inFlight`,
// so a batch of Promise.all(getQuote) calls (see MarketDataService.getQuotes)
// still only ever issues 2 HTTP requests total, not 2-per-symbol.
//
// api.binance.us, not api.binance.com (found live in production): the
// backend's server (Render, US-region) got a hard 451 "Unavailable For
// Legal Reasons" from api.binance.com on every request — that's Binance.com's
// own regulatory geo-block on US-originating server traffic, unrelated to
// this code. Binance.US is the separate, US-compliant exchange/API Binance
// itself operates for exactly this case — confirmed live: identical public
// endpoint paths, identical response schema (bookTicker/24hr/klines all
// byte-for-byte the same shape), and every symbol this app uses (including
// PAXGUSDT, the gold proxy) is listed there with status TRADING. No API key,
// no other code change, no architecture change — just the correct base URL
// for where this server is actually allowed to ask.
const BASE = 'https://api.binance.us/api/v3'

@Injectable()
export class BinanceProvider implements MarketDataProviderWithHistory {
  readonly name = 'Binance'
  private readonly logger = new Logger('BinanceProvider')

  private readonly knownSymbols = new Set<string>()
  private readonly cache = new Map<string, RawProviderQuote>()
  private inFlight: Promise<void> | null = null
  private lastRefreshAt = 0

  // Short-lived on purpose — this ONLY exists to coalesce a burst of
  // concurrent getQuote() calls (e.g. MarketDataService.getQuotes()'s
  // Promise.all across several symbols, all arriving within milliseconds)
  // into a single batched HTTP round-trip. It must stay well under
  // MarketDataService's own FRESH_MS (30s): if this cache lived that long
  // or longer, a batch of calls right when the OUTER cache lapses would
  // keep getting served BinanceProvider's own old data without ever
  // actually re-fetching — silently defeating MarketDataService's
  // freshness policy from underneath it (caught by
  // binance-integration.spec.ts's stale/outage test).
  private readonly INTERNAL_CACHE_MS = 5_000

  async getQuote(request: ProviderQuoteRequest): Promise<RawProviderQuote> {
    this.knownSymbols.add(request.providerSymbol)
    if (!this.cache.has(request.providerSymbol) || Date.now() - this.lastRefreshAt > this.INTERNAL_CACHE_MS) {
      await this.refresh()
    }
    let entry = this.cache.get(request.providerSymbol)
    if (!entry) {
      // Phase 6F Checkpoint G, Part 22 (found via manual live-price
      // verification, not a hypothetical) — a real race: when several
      // symbols are requested for the FIRST time concurrently (e.g.
      // MarketDataService.getQuotes() across a fresh set of pairs right
      // after a cold start), doRefresh()'s `Array.from(this.knownSymbols)`
      // snapshot can be taken before every concurrent caller's own
      // `knownSymbols.add()` above has landed — that caller's symbol then
      // simply isn't in the batch that was fetched, and it looks
      // indistinguishable from "Binance doesn't recognize this symbol".
      // This caller's own `.add()` DID already happen (synchronously, at
      // the top of this method) by the time we get here, so one bounded
      // retry — which will only ever start a brand-new doRefresh() if no
      // other refresh is currently in flight (`refresh()`'s own
      // coalescing) — resolves the race without ever looping unboundedly:
      // a symbol that's still missing after this retry is genuinely not a
      // recognized Binance symbol, not a timing artifact.
      await this.refresh()
      entry = this.cache.get(request.providerSymbol)
    }
    if (!entry) {
      // Not present after a successful batch fetch means Binance itself
      // doesn't recognize this symbol — an unsupported/misconfigured
      // providerSymbol, not a transient failure. MarketDataService treats
      // this exactly like any other provider error: UNAVAILABLE, never a
      // fabricated value.
      throw new Error(`Binance did not return data for symbol "${request.providerSymbol}" — not a recognized Binance symbol`)
    }
    return entry
  }

  private async refresh(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight
      return
    }
    this.inFlight = this.doRefresh()
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async doRefresh(): Promise<void> {
    const symbols = Array.from(this.knownSymbols)
    if (symbols.length === 0) return
    const symbolsParam = encodeURIComponent(JSON.stringify(symbols))

    // Part 8: prefer the dedicated book-ticker endpoint for bid/ask
    // specifically (best-bid/best-ask, updated on every order book change)
    // rather than relying only on the 24hr ticker's bid/ask fields.
    // Part 7/10: the 24hr ticker is still the source for last price and
    // the 24h statistics — one endpoint doesn't supply everything.
    const [bookRes, tickerRes] = await Promise.all([
      this.fetchJson(`${BASE}/ticker/bookTicker?symbols=${symbolsParam}`),
      this.fetchJson(`${BASE}/ticker/24hr?symbols=${symbolsParam}`),
    ])

    if (!Array.isArray(bookRes) || !Array.isArray(tickerRes)) {
      throw new Error('Binance returned a malformed batch response (expected arrays)')
    }

    const bookBySymbol = new Map<string, any>(bookRes.map((b: any) => [b.symbol, b]))
    for (const t of tickerRes as any[]) {
      const book = bookBySymbol.get(t.symbol)
      this.cache.set(t.symbol, {
        last: t.lastPrice != null ? Number(t.lastPrice) : null,
        bid: book?.bidPrice != null ? Number(book.bidPrice) : t.bidPrice != null ? Number(t.bidPrice) : null,
        ask: book?.askPrice != null ? Number(book.askPrice) : t.askPrice != null ? Number(t.askPrice) : null,
        timestampSeconds: t.closeTime != null ? Math.floor(Number(t.closeTime) / 1000) : null,
        priceChange: t.priceChange != null ? Number(t.priceChange) : null,
        priceChangePercent: t.priceChangePercent != null ? Number(t.priceChangePercent) : null,
        highPrice: t.highPrice != null ? Number(t.highPrice) : null,
        lowPrice: t.lowPrice != null ? Number(t.lowPrice) : null,
        volume: t.volume != null ? Number(t.volume) : null,
        quoteVolume: t.quoteVolume != null ? Number(t.quoteVolume) : null,
      })
    }
    this.lastRefreshAt = Date.now()
  }

  async getKlines(request: KlineRequest): Promise<MarketCandle[]> {
    const url = `${BASE}/klines?symbol=${encodeURIComponent(request.providerSymbol)}&interval=${encodeURIComponent(mapInterval(request.interval))}&limit=${Math.min(Math.max(request.limit, 1), 1000)}`
    const rows = await this.fetchJson(url)
    if (!Array.isArray(rows)) throw new Error('Binance returned a malformed klines response (expected an array)')
    // Documented kline array shape (binance-spot-api-docs): [openTime, open,
    // high, low, close, volume, closeTime, ...]. Anything short of that
    // shape for any row invalidates the whole response — never partially
    // trust a malformed provider payload.
    return rows.map((row: unknown[]) => {
      if (!Array.isArray(row) || row.length < 6) throw new Error('Binance kline row has an unexpected shape')
      const [openTime, open, high, low, close, volume] = row
      return {
        time: Number(openTime),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      }
    })
  }

  async healthCheck(): Promise<boolean> {
    try {
      // The lightest possible public endpoint — connectivity only, no
      // symbol/weight cost beyond the minimum. Never an authenticated
      // endpoint (Part 19).
      const res = await fetch(`${BASE}/ping`)
      return res.ok
    } catch {
      return false
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      throw new Error(`Binance network failure: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!res.ok) {
      if (res.status === 429 || res.status === 418) throw new Error(`Binance rate limited (${res.status})`)
      if (res.status >= 500) throw new Error(`Binance server error (${res.status})`)
      if (res.status === 401 || res.status === 403) throw new Error(`Binance authentication/permission failed (${res.status})`)
      throw new Error(`Binance request failed (${res.status})`)
    }
    try {
      return await res.json()
    } catch {
      throw new Error('Binance returned a non-JSON response')
    }
  }
}

function mapInterval(interval: KlineInterval): string {
  // TRUST's interval values already match Binance's own kline interval
  // strings exactly (both use "1m"/"5m"/"1h" etc.) — this function exists
  // so that fact is never silently assumed at the call site; if TRUST's
  // interval type ever diverges from Binance's, this is the one place that
  // needs to change.
  return interval
}

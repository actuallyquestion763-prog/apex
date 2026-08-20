import type { Candle, TickerPrice } from '../types'

// Phase 6B — this module is now a thin, backend-driven client. The
// symbol list, live quotes (XAU/USD via GoldAPI), and simulated demo
// quotes (everything else — no real crypto exchange is connected, see the
// Phase 6B report's "Provider Limitations" section) all come from the
// backend's centralized Market Data Service (backend/src/markets/), never
// generated or faked in this file anymore. The public functions below keep
// their EXACT pre-Phase-6B signatures so every consuming component
// (PriceTicker, MarketOverview, MarketPrice, CandlestickChart, MarketsPage,
// TradePage, DashboardPage) needed zero changes — only where the data
// comes from changed.
export type MarketStatus = 'loading' | 'live' | 'stale' | 'unavailable' | 'simulated'

export const SYMBOLS: { symbol: string; name: string; base: number }[] = []

const priceState: Record<string, number> = {}
// Reference price used only to compute a display "24h change" for
// SIMULATED symbols (set on first observed tick this session) — LIVE
// symbols (XAU/USD) never get a fabricated change%, matching the
// pre-Phase-6B behavior: GoldAPI's response here carries no real 24h-change
// field, so TRUST has never displayed one for it (Part 14: "24h change only
// if a trusted provider supplies it").
const referencePrice: Record<string, number> = {}

interface MarketMeta { status: MarketStatus; bid: number | null; ask: number | null; timestamp: number | null; source: string | null; lastFetch: number | null }
const marketMeta: Record<string, MarketMeta> = {}

function ensureMeta(symbol: string): MarketMeta {
  return marketMeta[symbol] ?? (marketMeta[symbol] = { status: 'loading', bid: null, ask: null, timestamp: null, source: null, lastFetch: null })
}

const STATUS_MAP: Record<string, MarketStatus> = { LIVE: 'live', SIMULATED: 'simulated', STALE: 'stale', UNAVAILABLE: 'unavailable' }

async function fetchInstrumentList() {
  try {
    const res = await fetch('/api/markets')
    const rows = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(rows)) return
    SYMBOLS.length = 0
    for (const r of rows) {
      SYMBOLS.push({ symbol: r.symbol, name: r.displayName || r.symbol, base: 0 })
      ensureMeta(r.symbol)
    }
  } catch {
    // Network failure fetching the instrument list itself — every symbol
    // simply stays absent from SYMBOLS/marketMeta (reported as 'loading'
    // by getMarketStatus's fallback below) rather than falling back to any
    // hardcoded list.
  }
}

async function fetchQuotes() {
  if (SYMBOLS.length === 0) return
  const symbols = SYMBOLS.map((s) => s.symbol).join(',')
  try {
    const res = await fetch(`/api/markets/quotes?symbols=${encodeURIComponent(symbols)}`)
    const quotes = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(quotes)) return
    const now = Date.now()
    for (const q of quotes) {
      const meta = ensureMeta(q.symbol)
      const status = STATUS_MAP[q.status] ?? 'unavailable'
      if (status === 'unavailable') {
        // Never overwrite a previously-live price with a fabricated one —
        // simply mark the status; getPrice() keeps returning the last
        // known value (honest "last known, currently unavailable"), never
        // resets to 0 or a placeholder.
        meta.status = 'unavailable'
        continue
      }
      const price = Number(q.last)
      if (!Number.isFinite(price) || price <= 0) { meta.status = 'unavailable'; continue }
      if (referencePrice[q.symbol] === undefined) referencePrice[q.symbol] = price
      priceState[q.symbol] = price
      meta.bid = q.bid != null ? Number(q.bid) : null
      meta.ask = q.ask != null ? Number(q.ask) : null
      meta.timestamp = q.timestamp ? Date.parse(q.timestamp) : now
      meta.source = q.source ?? null
      meta.lastFetch = now
      meta.status = status
      // Real 24h stats, only when the provider actually supplied them.
      stats24h[q.symbol] = {
        priceChangePercent: q.priceChangePercent ?? null,
        highPrice: q.highPrice ?? null,
        lowPrice: q.lowPrice ?? null,
        volume: q.volume ?? null,
        quoteVolume: q.quoteVolume ?? null,
      }
    }
  } catch {
    // Network failure — leave every symbol's last-known status/price
    // exactly as it was; a real request failure isn't grounds to blank out
    // data that was valid moments ago (that's what STALE is for, and the
    // backend already computes that transition itself on ITS side; a
    // frontend-side fetch failure here just means "try again next poll").
  }
}

// Backend already caches per its own FRESH_MS window (market-data.service.ts)
// — this interval controls how often the FRONTEND asks, not how often the
// upstream provider is hit (Part 7/8). 15s matches the pre-Phase-6B polling
// cadence this project already used for XAU/USD specifically.
const POLL_INTERVAL_MS = 15_000

let started = false
export function startPriceFeed() {
  if (started) return
  started = true
  fetchInstrumentList().then(fetchQuotes)
  setInterval(async () => {
    if (SYMBOLS.length === 0) await fetchInstrumentList()
    await fetchQuotes()
  }, POLL_INTERVAL_MS)
}
// Auto-starts on import, same as the pre-Phase-6B module did — every
// consumer already just imports functions from here without knowing (or
// needing to know) that a poll loop is running underneath.
startPriceFeed()

export function getMarketStatus(symbol: string): MarketStatus {
  return marketMeta[symbol]?.status ?? 'loading'
}

export function getMarketMeta(symbol: string) {
  return marketMeta[symbol] ?? { status: 'loading' as MarketStatus, bid: null, ask: null, timestamp: null, source: null, lastFetch: null }
}

export function getPrice(symbol: string): number {
  return priceState[symbol] ?? 0
}

function toTickerPrice(s: { symbol: string; name: string }): TickerPrice {
  const price = priceState[s.symbol] ?? 0
  const ref = referencePrice[s.symbol]
  const status = marketMeta[s.symbol]?.status
  // Phase 6C: a LIVE symbol with a real provider-supplied 24h change
  // (Binance-backed pairs) shows that REAL value — never computed here.
  // A SIMULATED symbol falls back to the locally-tracked reference-price
  // delta (already-labeled demo data). Anything else (e.g. XAU/USD, whose
  // provider supplies no 24h-change field) honestly reports 0/no change,
  // never a guessed value.
  const real = stats24h[s.symbol]
  const change24h = status === 'live' && real?.priceChangePercent != null ? (real.priceChangePercent / 100) * price
    : status === 'simulated' && ref ? price - ref
    : 0
  const changePct = status === 'live' && real?.priceChangePercent != null ? real.priceChangePercent
    : status === 'simulated' && ref ? (change24h / ref) * 100
    : 0
  return { symbol: s.symbol, name: s.name, price, change24h, changePct }
}

export function snapshot(): TickerPrice[] {
  return SYMBOLS.map(toTickerPrice)
}

// Previously advanced a local random walk on every call (every 1.5s from
// PriceTicker); now simply returns the current backend-polled snapshot —
// no fabricated sub-tick jitter between real polls (a small, deliberate
// honesty improvement consistent with Part 24, not a functional regression
// for any caller, all of which only ever displayed whatever this returned).
export function tickAll(): TickerPrice[] {
  return snapshot()
}

// ---- Simulated-only historical candles ------------------------------------
// Kept client-side, deliberately: this is fabricated demo data for symbols
// that were ALREADY explicitly labeled SIMULATED (Part 24's closing rule —
// existing simulated/test functionality may remain, if clearly labeled;
// StatusBadge already renders 'simulated' distinctly from 'live'). Moving
// this generator server-side would add real complexity for zero honesty
// benefit, since it only ever runs for symbols already flagged non-live.
// LIVE symbols (XAU/USD) never get fabricated candles — see the explicit
// guard below and CandlestickChart.tsx's own empty-state handling.
// Widened to the full interval set the backend/BinanceProvider genuinely
// supports end to end (backend/src/markets/markets.controller.ts's
// VALID_INTERVALS) — TradingView-style Chart checkpoint. 30m is deliberately
// absent: there is no real 30m kline source, and resampling would mean
// showing data the market-data system never actually returned.
const TF_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 }

export function generateHistory(symbol: string, tf: keyof typeof TF_MS = '1m', count = 60): Candle[] {
  if (getMarketStatus(symbol) !== 'simulated') return []
  const interval = TF_MS[tf]
  const now = Date.now()
  const start = now - count * interval
  let price = priceState[symbol] || 100
  const candles: Candle[] = []
  for (let i = 0; i < count; i++) {
    const time = start + i * interval
    const open = price
    let high = open, low = open, close = open
    for (let m = 0; m < 4; m++) {
      const step = (Math.random() - 0.5) * 2 * open * 0.004
      close += step
      high = Math.max(high, close)
      low = Math.min(low, close)
    }
    const volume = (Math.abs(close - open) / open) * 1000 + Math.random() * 500
    candles.push({ time, open, high, low, close, volume })
    price = close
  }
  return candles
}

export function nextCandle(prev: Candle, tf: keyof typeof TF_MS = '1m'): Candle {
  const interval = TF_MS[tf]
  const open = prev.close
  let high = open, low = open, close = open
  for (let m = 0; m < 4; m++) {
    const step = (Math.random() - 0.5) * 2 * open * 0.004
    close += step
    high = Math.max(high, close)
    low = Math.min(low, close)
  }
  const volume = (Math.abs(close - open) / open) * 1000 + Math.random() * 500
  return { time: prev.time + interval, open, high, low, close, volume }
}

// ---- Real historical candles (Phase 6C) ------------------------------------
// For any non-simulated symbol (LIVE — e.g. Binance-backed pairs), fetches
// REAL klines from the backend rather than ever calling generateHistory()
// above. Returns null (not []) specifically to distinguish "asked, got
// nothing" (OHLC_UNAVAILABLE — e.g. XAU/USD, no real history provider) from
// "haven't asked yet" — the caller (CandlestickChart) uses that to show an
// honest unavailable state rather than an empty-but-still-loading chart.
export async function fetchRealCandles(symbol: string, tf: keyof typeof TF_MS, limit = 60): Promise<Candle[] | null> {
  try {
    const res = await fetch(`/api/markets/${encodeURIComponent(symbol)}/candles?interval=${tf}&limit=${limit}`)
    const data = await res.json().catch(() => null)
    if (!res.ok || !data || data.status !== 'OK' || !Array.isArray(data.candles)) return null
    return data.candles
  } catch {
    return null
  }
}

// ---- 24h statistics (Phase 6C, Part 10) ------------------------------------
// Only ever populated for a provider that actually supplies them (Binance
// does; GoldAPI/Simulated don't) — surfaced separately from the ticker's
// price/change% (which IS shown for simulated symbols too, from a locally
// tracked reference price — see toTickerPrice above). These are real,
// provider-supplied numbers only, never computed here.
interface Stats24h { priceChangePercent: number | null; highPrice: number | null; lowPrice: number | null; volume: number | null; quoteVolume: number | null }
const stats24h: Record<string, Stats24h> = {}

export function getStats24h(symbol: string): Stats24h {
  return stats24h[symbol] ?? { priceChangePercent: null, highPrice: null, lowPrice: null, volume: null, quoteVolume: null }
}

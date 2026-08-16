import type { Candle, TickerPrice } from '../types'

export const SYMBOLS: { symbol: string; name: string; base: number }[] = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', base: 67250 },
  { symbol: 'ETH/USDT', name: 'Ethereum', base: 3480 },
  { symbol: 'USDT/USD', name: 'Tether', base: 1.0 },
  { symbol: 'XRP/USDT', name: 'Ripple', base: 0.612 },
  { symbol: 'SOL/USDT', name: 'Solana', base: 168 },
  { symbol: 'BNB/USDT', name: 'BNB', base: 595 },
  { symbol: 'ADA/USDT', name: 'Cardano', base: 0.45 },
  { symbol: 'DOGE/USDT', name: 'Dogecoin', base: 0.158 },
  // XAU/USD is live-sourced from the market proxy; do not simulate or fabricate a base price
  { symbol: 'XAU/USD', name: 'Gold', base: 0 },
]

const priceState: Record<string, number> = {}
SYMBOLS.forEach((s) => (priceState[s.symbol] = s.base))

// Market metadata for live symbols (only XAU/USD for now). Symbols with no entry
// here are simulated locally, not sourced from a real exchange/broker feed.
export type MarketStatus = 'loading' | 'live' | 'stale' | 'unavailable' | 'simulated'
const marketMeta: Record<string, { status: MarketStatus; bid: number | null; ask: number | null; timestamp: number | null; source: string | null; lastFetch: number | null }> = {
  'XAU/USD': { status: 'loading', bid: null, ask: null, timestamp: null, source: null, lastFetch: null }
}

// Poll the TRUST backend for XAU/USD and update priceState and marketMeta.
// Public endpoint (no session required) — see backend/src/markets/markets.controller.ts.
const XAU_POLL_INTERVAL = 15_000 // ms
async function fetchXauAndUpdate() {
  const key = 'XAU/USD'
  try {
    const res = await fetch('/api/markets/xau')
    const now = Date.now()
    const data = await res.json().catch(() => null)
    if (!res.ok || !data || 'error' in data) {
      // Backend returned an error (including a 200 with an {error,message}
      // body, e.g. no MARKET_API_KEY configured): if we have a last price,
      // mark stale, otherwise unavailable. Never fabricate a price.
      if (marketMeta[key].lastFetch) {
        marketMeta[key].status = 'stale'
      } else {
        marketMeta[key].status = 'unavailable'
      }
      return
    }
    const p = Number(data.price)
    const bid = data.bid != null ? Number(data.bid) : null
    const ask = data.ask != null ? Number(data.ask) : null
    const providerTs = data.timestamp ? Date.parse(data.timestamp) : now

    if (Number.isFinite(p) && p > 0) {
      priceState[key] = p
      marketMeta[key] = { status: data.stale ? 'stale' : 'live', bid, ask, timestamp: providerTs, source: data.source ?? 'GoldAPI', lastFetch: now }
    } else {
      // Invalid price from provider
      if (marketMeta[key].lastFetch) marketMeta[key].status = 'stale'
      else marketMeta[key].status = 'unavailable'
    }
  } catch (e) {
    if (marketMeta[key].lastFetch) marketMeta[key].status = 'stale'
    else marketMeta[key].status = 'unavailable'
  }
}

// Start polling but don't block module initialization
setTimeout(() => { fetchXauAndUpdate(); setInterval(fetchXauAndUpdate, XAU_POLL_INTERVAL) }, 0)

// Symbols not tracked in marketMeta (i.e. not backed by a real external feed)
// are reported as 'simulated' — never 'live'. XAU/USD is the only symbol with a
// real feed today; this stays correct automatically if more are added later.
export function getMarketStatus(symbol: string): MarketStatus {
  return marketMeta[symbol]?.status ?? 'simulated'
}

export function getMarketMeta(symbol: string) {
  return marketMeta[symbol] ?? { status: 'simulated' as MarketStatus, bid: null, ask: null, timestamp: null, source: null, lastFetch: null }
}

function nextPrice(symbol: string): number {
  // XAU/USD must not be simulated locally
  if (symbol === 'XAU/USD') {
    return priceState[symbol] ?? SYMBOLS.find((s) => s.symbol === symbol)!.base
  }
  const cur = priceState[symbol] ?? SYMBOLS.find((s) => s.symbol === symbol)!.base
  const vol = cur * 0.0015
  const drift = (Math.random() - 0.5) * 2 * vol
  const next = Math.max(0.0001, cur + drift)
  priceState[symbol] = next
  return next
}

export function getPrice(symbol: string): number {
  return priceState[symbol] ?? SYMBOLS.find((s) => s.symbol === symbol)!.base
}

export function tickAll(): TickerPrice[] {
  return SYMBOLS.map((s) => {
    const price = nextPrice(s.symbol)
    // avoid divide-by-zero for symbols with no base (XAU/USD uses live data)
    const change24h = s.base ? price - s.base : 0
    const changePct = s.base ? (change24h / s.base) * 100 : 0
    return { symbol: s.symbol, name: s.name, price, change24h, changePct }
  })
}

export function snapshot(): TickerPrice[] {
  return SYMBOLS.map((s) => {
    const price = priceState[s.symbol]
    const change24h = s.base ? price - s.base : 0
    const changePct = s.base ? (change24h / s.base) * 100 : 0
    return { symbol: s.symbol, name: s.name, price, change24h, changePct }
  })
}

const TF_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000 }

export function generateHistory(symbol: string, tf: keyof typeof TF_MS = '1m', count = 60): Candle[] {
  // Do not fabricate historical candles for live XAU/USD data
  if (symbol === 'XAU/USD') return []
  const interval = TF_MS[tf]
  const now = Date.now()
  const start = now - count * interval
  let price = priceState[symbol] ?? SYMBOLS.find((s) => s.symbol === symbol)!.base
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
  priceState[symbol] = price
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

import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { Maximize2, Minimize2, TrendingUp } from 'lucide-react'
import { getPrice, getMarketStatus } from '../../store/priceFeed'
import type { Candle } from '../../types'

// Checkpoint J — a dedicated chart for Options, built on `lightweight-charts`
// (TradingView's own open-source charting library, npm package
// `lightweight-charts`, Apache-2.0, ~45KB gzipped). Deliberately a NEW
// component rather than modifying the existing shared CandlestickChart.tsx
// (which TradePage.tsx/spot trading depends on) — this checkpoint's explicit
// instruction is "do not change the existing Spot Trading system," and that
// includes its UI, not just its financial logic. No CDN, no API credentials
// in the browser: candle data comes from the same existing
// GET /markets/:symbol/candles endpoint every other chart already uses; the
// library itself ships as a plain npm dependency bundled by Vite.
//
// The price/candles shown here are for ANALYSIS ONLY — never authoritative
// for trade settlement. Entry/expiry prices are determined exclusively by
// the backend at the moment of trade creation/settlement (see
// options.service.ts) and never read anything from this component.

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
// The full interval set the backend/BinanceProvider genuinely supports end
// to end (see backend/src/markets/markets.controller.ts's VALID_INTERVALS)
// — not narrowed the way the pre-existing fetchRealCandles() helper is,
// since that helper is spot's and out of scope to touch here.
const INTERVALS: { value: Interval; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
]

async function fetchCandles(symbol: string, interval: Interval, limit = 200): Promise<Candle[] | null> {
  try {
    const res = await fetch(`/api/markets/${encodeURIComponent(symbol)}/candles?interval=${interval}&limit=${limit}`)
    const data = await res.json().catch(() => null)
    if (!res.ok || !data || data.status !== 'OK' || !Array.isArray(data.candles)) return null
    return data.candles
  } catch {
    return null
  }
}

// Simple moving average — analysis only, never fed back into settlement.
export function computeSMA(candles: Candle[], period: number): { time: UTCTimestamp; value: number }[] {
  if (candles.length < period) return []
  const out: { time: UTCTimestamp; value: number }[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) out.push({ time: Math.floor(candles[i].time / 1000) as UTCTimestamp, value: sum / period })
  }
  return out
}

// Standard 14-period RSI (SMA-smoothed average gain/loss — a deliberately
// simple, well-understood formulation appropriate for an analysis overlay,
// not a claim of any particular proprietary variant).
export function computeRSI(candles: Candle[], period = 14): { time: UTCTimestamp; value: number }[] {
  if (candles.length < period + 1) return []
  const out: { time: UTCTimestamp; value: number }[] = []
  let gainSum = 0, lossSum = 0
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close
    if (change >= 0) gainSum += change
    else lossSum -= change
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  const rsiAt = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l))
  out.push({ time: Math.floor(candles[period].time / 1000) as UTCTimestamp, value: rsiAt(avgGain, avgLoss) })
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out.push({ time: Math.floor(candles[i].time / 1000) as UTCTimestamp, value: rsiAt(avgGain, avgLoss) })
  }
  return out
}

export function OptionsChart({ symbol, height = 420 }: { symbol: string; height?: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const candlesRef = useRef<Candle[]>([])

  const [interval, setInterval_] = useState<Interval>('1m')
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [showMA, setShowMA] = useState(true)
  const [showRSI, setShowRSI] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [hover, setHover] = useState<Candle | null>(null)

  const status = getMarketStatus(symbol)
  const price = getPrice(symbol)

  // ---- Chart lifecycle: created once per mount, torn down on unmount -----
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0b0f1a' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1a2236' }, horzLines: { color: '#1a2236' } },
      rightPriceScale: { borderColor: '#1a2236' },
      timeScale: { borderColor: '#1a2236', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: false,
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      color: '#22d3ee66',
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } })

    const maSeries = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setHover(null); return }
      const idx = candlesRef.current.findIndex((c) => Math.floor(c.time / 1000) === param.time)
      setHover(idx >= 0 ? candlesRef.current[idx] : null)
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    maSeriesRef.current = maSeries

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      maSeriesRef.current = null
      rsiSeriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- RSI pane, added/removed on toggle ----------------------------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (showRSI && !rsiSeriesRef.current) {
      const rsi = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, priceLineVisible: false }, 1)
      chart.panes()[1]?.setStretchFactor(0.25)
      rsiSeriesRef.current = rsi
      if (candlesRef.current.length > 0) rsi.setData(computeRSI(candlesRef.current))
    } else if (!showRSI && rsiSeriesRef.current) {
      chart.removeSeries(rsiSeriesRef.current)
      rsiSeriesRef.current = null
    }
  }, [showRSI])

  // ---- Load candles on symbol/interval change ------------------------------
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setUnavailable(false)
    fetchCandles(symbol, interval).then((candles) => {
      if (cancelled) return
      setLoading(false)
      if (!candles || candles.length === 0) {
        setUnavailable(true)
        candlesRef.current = []
        return
      }
      candlesRef.current = candles
      const bars = candles.map((c) => ({
        time: Math.floor(c.time / 1000) as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }))
      candleSeriesRef.current?.setData(bars)
      volumeSeriesRef.current?.setData(candles.map((c) => ({
        time: Math.floor(c.time / 1000) as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? '#22c55e55' : '#ef444455',
      })))
      if (showMA) maSeriesRef.current?.setData(computeSMA(candles, 20))
      if (showRSI) rsiSeriesRef.current?.setData(computeRSI(candles))
      chartRef.current?.timeScale().fitContent()
    })
    return () => { cancelled = true }
  }, [symbol, interval])

  // ---- MA toggle -------------------------------------------------------------
  useEffect(() => {
    if (!maSeriesRef.current) return
    maSeriesRef.current.setData(showMA && candlesRef.current.length > 0 ? computeSMA(candlesRef.current, 20) : [])
  }, [showMA])

  // ---- Live tick: update only the most recent bar, matching CandlestickChart's
  // existing cadence — never fetches a new full candle set here. -----------
  useEffect(() => {
    const id = window.setInterval(() => {
      const candles = candlesRef.current
      if (candles.length === 0 || status === 'unavailable' || status === 'loading') return
      const last = candles[candles.length - 1]
      const p = getPrice(symbol)
      if (!p) return
      const updated: Candle = { ...last, close: p, high: Math.max(last.high, p), low: Math.min(last.low, p) }
      candles[candles.length - 1] = updated
      candleSeriesRef.current?.update({ time: Math.floor(updated.time / 1000) as UTCTimestamp, open: updated.open, high: updated.high, low: updated.low, close: updated.close })
    }, 1200)
    return () => window.clearInterval(id)
  }, [symbol, status])

  // ---- Responsive sizing (container + fullscreen) ---------------------------
  useEffect(() => {
    const el = containerRef.current
    const chart = chartRef.current
    if (!el || !chart) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullscreen])

  useEffect(() => {
    function onFsChange() { setFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  async function toggleFullscreen() {
    if (!wrapperRef.current) return
    if (!document.fullscreenElement) await wrapperRef.current.requestFullscreen().catch(() => undefined)
    else await document.exitFullscreen().catch(() => undefined)
  }

  const priceLabel = useMemo(() => (price ? (price < 1 ? price.toFixed(4) : price.toLocaleString(undefined, { maximumFractionDigits: 2 })) : '—'), [price])

  return (
    <div ref={wrapperRef} className={fullscreen ? 'fixed inset-0 z-[200] bg-ink-950 p-3' : 'relative'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-ocean-400" />
          <span className="font-mono text-lg font-bold text-white">{priceLabel}</span>
          {status === 'unavailable' && <span className="chip border-bear/30 text-bear">Unavailable</span>}
          {status === 'stale' && <span className="chip border-gold-500/30 text-gold-300">Stale</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex gap-0.5 rounded-lg border border-ink-600 bg-ink-900 p-0.5">
            {INTERVALS.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setInterval_(tf.value)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${interval === tf.value ? 'bg-ocean-500 text-ink-950' : 'text-slate-400 hover:text-white'}`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowMA((v) => !v)}
            aria-pressed={showMA}
            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${showMA ? 'border-gold-500/40 bg-gold-500/10 text-gold-300' : 'border-ink-600 text-slate-400 hover:text-white'}`}
          >
            MA
          </button>
          <button
            onClick={() => setShowRSI((v) => !v)}
            aria-pressed={showRSI}
            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${showRSI ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-ink-600 text-slate-400 hover:text-white'}`}
          >
            RSI
          </button>
          <button
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="rounded-md border border-ink-600 p-1.5 text-slate-400 transition hover:text-white"
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        {(loading || unavailable) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-900/90 text-sm text-slate-500">
            {loading ? 'Loading chart…' : `Historical chart data unavailable for ${symbol}.`}
          </div>
        )}
        <div ref={containerRef} style={{ height: fullscreen ? 'calc(100vh - 90px)' : height, width: '100%' }} />
        {hover && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-ink-600 bg-ink-800/95 px-3 py-2 text-[11px] font-mono shadow-xl">
            <div className="text-slate-400">O {hover.open.toFixed(2)} H {hover.high.toFixed(2)}</div>
            <div className="text-slate-400">L {hover.low.toFixed(2)} C {hover.close.toFixed(2)}</div>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-600">MACD is deferred — see Checkpoint J report. Chart is for analysis only; trade settlement always uses the backend's own authoritative price, never a value read from this chart.</p>
    </div>
  )
}

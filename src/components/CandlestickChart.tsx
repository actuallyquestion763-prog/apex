import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import { generateHistory, fetchRealCandles, getPrice, getMarketStatus } from '../store/priceFeed'
import type { Candle } from '../types'
import { StatusBadge } from './StatusBadge'

// TradingView-style Chart checkpoint — rebuilt on `lightweight-charts`
// (already an installed dependency, already proven in this exact dark theme
// by components/options/OptionsChart.tsx, whose lifecycle pattern this
// mirrors: create once on mount, ResizeObserver-driven resize, fullscreen,
// dispose on unmount). No CDN, no iframe, no TradingView account — the
// library ships as a plain npm dependency bundled by Vite.
//
// Data source is UNCHANGED from the previous SVG chart: real historical
// candles come from the same GET /markets/:symbol/candles endpoint via
// fetchRealCandles() for any non-simulated (LIVE) symbol; a symbol the
// backend has explicitly flagged 'simulated' keeps using the existing local
// generateHistory() generator (already clearly labeled as demo data). A
// LIVE market with no real history available shows the same honest
// "unavailable" state as before — never a fabricated candle.
type TF = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
// The full interval set the backend/BinanceProvider genuinely supports end
// to end (backend/src/markets/markets.controller.ts's VALID_INTERVALS) —
// same set OptionsChart.tsx already uses. 30m is deliberately NOT offered:
// there is no real 30m kline source to show, and resampling two real 15m
// candles into a synthetic 30m one would mean displaying a bar the
// market-data system never actually returned.
const TIMEFRAMES: { value: TF; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
]
const TF_INTERVAL_MS: Record<TF, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 }

// fitContent() squeezes ALL loaded candles (up to 200, see fetchRealCandles
// below) into the chart's width — for a wider timeframe (15m/1H/4H/1D) that
// spans days, most of the width ends up empty/flat between real price
// moves, reading as a sparse, half-broken chart rather than a normal
// trading view. Real exchanges default to a recent, readable window and
// let the user explicitly zoom out — the existing "Reset / fit" button
// (resetView(), unchanged) still calls fitContent() for that.
const DEFAULT_VISIBLE_CANDLES = 60

function toBar(c: Candle) {
  return { time: Math.floor(c.time / 1000) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }
}
function toVolumeBar(c: Candle) {
  return { time: Math.floor(c.time / 1000) as UTCTimestamp, value: c.volume ?? 0, color: c.close >= c.open ? '#22c55e55' : '#ef444455' }
}

export function CandlestickChart({ symbol, height = 320, quoteAsset }: { symbol: string; height?: number; quoteAsset?: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const candlesRef = useRef<Candle[]>([])

  const [tf, setTf] = useState<TF>('1m')
  const [loadingCandles, setLoadingCandles] = useState(false)
  const [ohlcUnavailable, setOhlcUnavailable] = useState(false)
  const [hover, setHover] = useState<Candle | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

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

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setHover(null); return }
      const idx = candlesRef.current.findIndex((c) => Math.floor(c.time / 1000) === param.time)
      setHover(idx >= 0 ? candlesRef.current[idx] : null)
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Load candles on symbol/timeframe change -----------------------------
  // Clears the series immediately on a symbol/timeframe change (before the
  // fetch resolves) so no stale candle from the PREVIOUS symbol is ever
  // visible while the new one loads.
  useEffect(() => {
    let cancelled = false
    setOhlcUnavailable(false)
    candlesRef.current = []
    candleSeriesRef.current?.setData([])
    volumeSeriesRef.current?.setData([])

    async function load() {
      const simulated = getMarketStatus(symbol) === 'simulated'
      if (!simulated) setLoadingCandles(true)
      const candles = simulated ? generateHistory(symbol, tf, 200) : await fetchRealCandles(symbol, tf, 200)
      if (cancelled) return
      setLoadingCandles(false)
      if (!candles || candles.length === 0) {
        setOhlcUnavailable(true)
        return
      }
      candlesRef.current = candles
      candleSeriesRef.current?.setData(candles.map(toBar))
      volumeSeriesRef.current?.setData(candles.map(toVolumeBar))
      // Default to the most recent DEFAULT_VISIBLE_CANDLES, not the entire
      // fetched history — see DEFAULT_VISIBLE_CANDLES's own comment. A
      // short history (fewer candles than that) has nothing to zoom into,
      // so it still just fits everything.
      if (candles.length > DEFAULT_VISIBLE_CANDLES) {
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: candles.length - DEFAULT_VISIBLE_CANDLES,
          to: candles.length + 1, // a little right padding past the latest candle
        })
      } else {
        chartRef.current?.timeScale().fitContent()
      }
    }
    load()
    return () => { cancelled = true }
  }, [symbol, tf])

  // ---- Live tick: update only the most recent bar, never a full reload ----
  useEffect(() => {
    const id = window.setInterval(() => {
      const candles = candlesRef.current
      if (candles.length === 0) return
      const price = getPrice(symbol)
      if (!price) return
      const last = candles[candles.length - 1]
      const now = Date.now()
      const intervalMs = TF_INTERVAL_MS[tf]
      if (now - last.time > intervalMs) {
        const next: Candle = { time: last.time + intervalMs, open: last.close, high: price, low: price, close: price, volume: 0 }
        candles.push(next)
        if (candles.length > 400) candles.shift()
        candleSeriesRef.current?.update(toBar(next))
        volumeSeriesRef.current?.update(toVolumeBar(next))
        return
      }
      const updated: Candle = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }
      candles[candles.length - 1] = updated
      candleSeriesRef.current?.update(toBar(updated))
      volumeSeriesRef.current?.update(toVolumeBar(updated))
    }, 1200)
    return () => window.clearInterval(id)
  }, [symbol, tf])

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

  function resetView() {
    chartRef.current?.timeScale().fitContent()
  }

  const status = getMarketStatus(symbol)
  const price = getPrice(symbol)
  const priceLabel = price ? (price < 1 ? price.toFixed(4) : price.toLocaleString(undefined, { maximumFractionDigits: 2 })) : '—'

  return (
    <div ref={wrapperRef} className={fullscreen ? 'fixed inset-0 z-[200] bg-ink-950 p-3' : 'relative'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{symbol}</span>
          <span className="font-mono text-sm font-semibold text-white">{priceLabel}{quoteAsset ? ` ${quoteAsset}` : ''}</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex gap-0.5 rounded-lg border border-ink-600 bg-ink-900 p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTf(t.value)}
                aria-pressed={tf === t.value}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${tf === t.value ? 'bg-ocean-500 text-ink-950' : 'text-slate-400 hover:text-white'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={resetView} aria-label="Reset chart view" title="Reset / fit" className="rounded-md border border-ink-600 p-1.5 text-slate-400 transition hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} className="rounded-md border border-ink-600 p-1.5 text-slate-400 transition hover:text-white">
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        {(loadingCandles || ohlcUnavailable) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-900/90 text-center text-sm text-slate-500">
            {loadingCandles ? 'Loading chart…' : `Historical chart data unavailable for ${symbol}. Showing live mark when available.`}
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
    </div>
  )
}

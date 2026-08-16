import { useEffect, useMemo, useRef, useState } from 'react'
import { generateHistory, getPrice, getMarketStatus, getMarketMeta } from '../store/priceFeed'
import type { Candle } from '../types'
import { StatusBadge } from './StatusBadge'

type TF = '1m' | '5m' | '1h'

export function CandlestickChart({ symbol, height = 320 }: { symbol: string; height?: number }) {
  const [tf, setTf] = useState<TF>('1m')
  const [candles, setCandles] = useState<Candle[]>([])
  const [hover, setHover] = useState<{ x: number; c: Candle } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => { setCandles(generateHistory(symbol, tf, 60)) }, [symbol, tf])

  useEffect(() => {
    const id = setInterval(() => {
      setCandles((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        const now = Date.now()
        const intervalMs = tf === '1m' ? 60_000 : tf === '5m' ? 300_000 : 3_600_000
        if (now - last.time > intervalMs) return [...prev.slice(-59), { ...last, open: last.close, high: last.close, low: last.close, close: last.close, time: last.time + intervalMs }]
        const price = getPrice(symbol)
        const updated = [...prev]
        const cur = { ...updated[updated.length - 1] }
        cur.close = price
        cur.high = Math.max(cur.high, price)
        cur.low = Math.min(cur.low, price)
        updated[updated.length - 1] = cur
        return updated
      })
    }, 1200)
    return () => clearInterval(id)
  }, [symbol, tf])

  const layout = useMemo(() => {
    const W = 800, H = height, padL = 8, padR = 64, padT = 12, padB = 24
    const plotW = W - padL - padR, plotH = H - padT - padB
    const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low)
    const max = Math.max(...highs, 0), min = Math.min(...lows, Number.MAX_SAFE_INTEGER)
    const range = max - min || 1, pad = range * 0.1
    const yMax = max + pad, yMin = min - pad, yRange = yMax - yMin
    const cw = plotW / candles.length, bodyW = cw * 0.6
    const x = (i: number) => padL + i * cw + cw / 2
    const y = (v: number) => padT + (1 - (v - yMin) / yRange) * plotH
    return { W, H, padL, padR, padT, padB, plotW, plotH, yMax, yMin, yRange, cw, bodyW, x, y }
  }, [candles, height])

  const lastPrice = candles.length ? candles[candles.length - 1].close : 0
  const firstPrice = candles.length ? candles[0].open : 0
  const up = lastPrice >= firstPrice

  const gridLines = useMemo(() => {
    const lines = []
    for (let i = 0; i <= 4; i++) {
      const v = layout.yMin + (layout.yRange * i) / 4
      lines.push({ y: layout.y(v), v })
    }
    return lines
  }, [layout])

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * layout.W
    const idx = Math.floor((px - layout.padL) / layout.cw)
    if (idx >= 0 && idx < candles.length) setHover({ x: px, c: candles[idx] })
    else setHover(null)
  }

  // If XAU/USD has no historical candles, show a clear empty state instead of fabricating data
  if (symbol === 'XAU/USD' && candles.length === 0) {
    const status = getMarketStatus('XAU/USD')
    const meta = getMarketMeta('XAU/USD')
    const price = getPrice('XAU/USD')
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">{symbol}</h3>
            <div className="mt-1 font-mono text-2xl font-bold text-white">${price ? (price < 1 ? price.toFixed(4) : price.toFixed(2)) : '--'}</div>
            <div className="mt-2 text-sm text-slate-400">Historical chart data unavailable for XAU/USD. Showing live mark when available.</div>
          </div>
          <div className="text-right text-sm text-slate-400">
            <div>Source: {meta.source ?? 'GoldAPI'}</div>
            <div className="mt-2"><StatusBadge status={status} /></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-white">{symbol}</h3>
          <span className="font-mono text-2xl font-bold text-white">${lastPrice.toLocaleString(undefined, { maximumFractionDigits: lastPrice < 1 ? 4 : 2 })}</span>
          <span className={`text-sm font-semibold ${up ? 'text-bull' : 'text-bear'}`}>{up ? '+' : ''}{firstPrice ? (((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2) : '0.00'}%</span>
        </div>
        <div className="flex gap-1 rounded-lg border border-ink-600 bg-ink-900 p-1">
          {(['1m', '5m', '1h'] as TF[]).map((t) => (
            <button key={t} onClick={() => setTf(t)} className={`rounded-md px-3 py-1 text-xs font-semibold transition ${tf === t ? 'bg-ocean-500 text-ink-950' : 'text-slate-400 hover:text-white'}`}>{t}</button>
          ))}
        </div>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${layout.W} ${layout.H}`} className="w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <rect x={0} y={0} width={layout.W} height={layout.H} fill="#0b0f1a" rx={12} />
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={layout.padL} y1={g.y} x2={layout.W - layout.padR} y2={g.y} stroke="#1a2236" strokeWidth={1} />
            <text x={layout.W - layout.padR + 6} y={g.y + 3} fill="#64748b" fontSize={10} fontFamily="monospace">{g.v < 1 ? g.v.toFixed(4) : g.v.toFixed(2)}</text>
          </g>
        ))}
        {candles.map((c, i) => {
          const cx = layout.x(i)
          const isUp = c.close >= c.open
          const color = isUp ? '#22c55e' : '#ef4444'
          const bodyTop = layout.y(Math.max(c.open, c.close))
          const bodyBottom = layout.y(Math.min(c.open, c.close))
          return (
            <g key={i}>
              <line x1={cx} y1={layout.y(c.high)} x2={cx} y2={layout.y(c.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - layout.bodyW / 2} y={bodyTop} width={layout.bodyW} height={Math.max(1, bodyBottom - bodyTop)} fill={color} opacity={0.9} />
            </g>
          )
        })}
        <line x1={layout.padL} y1={layout.y(lastPrice)} x2={layout.W - layout.padR} y2={layout.y(lastPrice)} stroke={up ? '#22c55e' : '#ef4444'} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        {hover && (
          <g>
            <line x1={hover.x} y1={layout.padT} x2={hover.x} y2={layout.H - layout.padB} stroke="#36415c" strokeWidth={1} strokeDasharray="3 3" />
            <rect x={layout.W - layout.padR + 2} y={layout.y(hover.c.close) - 9} width={56} height={18} rx={4} fill={hover.c.close >= hover.c.open ? '#22c55e' : '#ef4444'} />
            <text x={layout.W - layout.padR + 6} y={layout.y(hover.c.close) + 3} fill="#0b0f1a" fontSize={10} fontWeight={700} fontFamily="monospace">{hover.c.close < 1 ? hover.c.close.toFixed(4) : hover.c.close.toFixed(2)}</text>
          </g>
        )}
      </svg>
      {hover && (
        <div className="absolute top-12 left-2 rounded-lg border border-ink-600 bg-ink-800/95 px-3 py-2 text-xs font-mono shadow-xl pointer-events-none">
          <div className="text-slate-400">O {hover.c.open.toFixed(2)}  H {hover.c.high.toFixed(2)}</div>
          <div className="text-slate-400">C {hover.c.close.toFixed(2)}  L {hover.c.low.toFixed(2)}</div>
        </div>
      )}
    </div>
  )
}

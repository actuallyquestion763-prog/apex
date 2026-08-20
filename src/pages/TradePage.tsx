import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePositions, useOrders, submitOrder, computePositionPnl, useCashBalance, useMarketConfigs, useExecutionStatus, useAssetBalances } from '../store/useStore'
import { getPrice, getMarketStatus, getStats24h, SYMBOLS } from '../store/priceFeed'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import { CandlestickChart } from '../components/CandlestickChart'
import { AssetIcon } from '../components/AssetIcon'
import { StatusBadge } from '../components/StatusBadge'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { PositionCard } from '../components/PositionCard'
import { SpotHoldings } from '../components/SpotHoldings'
import { Inbox, History, ChevronRight, AlertTriangle } from 'lucide-react'

function useQuery() { return new URLSearchParams(useLocation().search) }

export default function TradePage() {
  const q = useQuery()
  const defaultSymbol = q.get('symbol') ?? 'BTC/USDT'
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [size, setSize] = useState('100')
  const [activePositionId, setActivePositionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [, setTick] = useState(0)

  const { positions, refetch: refetchPositions } = usePositions()
  const { orders, refetch: refetchOrders } = useOrders()
  const { markets } = useMarketConfigs()
  const { status: executionStatus } = useExecutionStatus()
  const { assets, loading: assetsLoading, refetch: refetchAssets } = useAssetBalances()
  const { push } = useToast()

  useEffect(() => { setSymbol(defaultSymbol) }, [defaultSymbol])

  // The market's own spend/quote asset (e.g. USDT for BTC/USDT) — resolved
  // from real backend config, never hardcoded. Falls back to 'USD' only
  // while the market list hasn't loaded yet (never a guess once it has).
  const quoteAsset = markets.find((m) => m.symbol === symbol)?.quoteAsset || 'USD'
  const { balance, refetch: refetchBalance } = useCashBalance(quoteAsset)

  // Keep the price ticker live while this page is open. Positions/orders
  // themselves only ever change via a real backend call, not this timer.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const current = getPrice(symbol)
  const status = getMarketStatus(symbol)
  const xauBlocked = symbol === 'XAU/USD' && status !== 'live'
  const openPositions = positions.filter(p => p.status === 'OPEN')
  const openPositionForSymbol = openPositions.find(p => p.symbol === symbol)
  const availableBalance = balance ? Number(balance.cash) : 0
  const enteredAmount = parseFloat(size) || 0
  const insufficientBalance = enteredAmount > 0 && enteredAmount > availableBalance

  async function submit(orderSide: 'BUY' | 'SELL') {
    const s = parseFloat(size)
    if (!Number.isFinite(s) || s <= 0) { push('error', 'Enter valid size'); return }
    setSubmitting(true)
    const res = await submitOrder({ symbol, side: orderSide, quantity: s })
    setSubmitting(false)
    if (res.ok) {
      const order = res.data
      if (order.status === 'REJECTED') {
        push('error', order.rejectionReason || 'Order was rejected.')
      } else {
        push('success', `Order ${order.status.toLowerCase()}.`)
      }
      refetchOrders()
      refetchPositions()
      refetchBalance()
      refetchAssets()
    } else {
      push('error', res.error)
    }
  }

  const positionsWithPnl = useMemo(() => openPositions.map(p => ({ p, pnl: computePositionPnl(p) })), [openPositions])
  const activeEntry = activePositionId ? positionsWithPnl.find(x => x.p.id === activePositionId) : undefined

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade"
        subtitle="Trade with your account balance."
        right={<div className="flex items-center gap-2 text-sm text-slate-400">{symbol} <span className="font-mono text-white">${current.toFixed(current < 1 ? 4 : 2)}</span> <StatusBadge status={status} /></div>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chart */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden p-4">
            <CandlestickChart symbol={symbol} height={360} />
          </div>
          <Stats24hRow symbol={symbol} />
        </div>

        {/* Order panel */}
        <div className="card p-4">
          <div className="mb-4 flex items-center gap-3">
            <AssetIcon symbol={symbol} size={36} />
            <div className="min-w-0 flex-1">
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input bg-ink-800 py-1.5 text-sm text-white">
                {SYMBOLS.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>)}
              </select>
            </div>
          </div>

          {openPositionForSymbol && (
            <button
              onClick={() => setActivePositionId(openPositionForSymbol.id)}
              className="mb-4 flex w-full items-center justify-between rounded-lg border border-ocean-500/30 bg-ocean-500/10 px-3 py-2.5 text-left transition hover:bg-ocean-500/15"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ocean-300">Open Position</p>
                <p className="text-sm text-white">{openPositionForSymbol.side} {symbol}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <PriceChange value={computePositionPnl(openPositionForSymbol)} mode="usd" className="text-sm" />
                <ChevronRight className="h-4 w-4 text-ocean-400" />
              </div>
            </button>
          )}

          <div className="mb-4 flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2.5 text-xs">
            <span className="text-slate-500">Available balance</span>
            <span className="font-mono font-semibold text-white">{availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quoteAsset}</span>
          </div>

          <label className="label">Amount ({quoteAsset})</label>
          <input className="input mb-3" type="number" min="0" value={size} onChange={(e) => setSize(e.target.value)} />

          <div className="mb-4 flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2.5 text-xs">
            <span className="text-slate-500">Entry price</span>
            <span className="font-mono text-white">${current.toFixed(current < 1 ? 4 : 2)}</span>
          </div>

          {insufficientBalance && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2.5 text-xs text-bear">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Insufficient balance: {enteredAmount.toLocaleString()} {quoteAsset} required, {availableBalance.toLocaleString()} {quoteAsset} available.</span>
            </div>
          )}

          {xauBlocked && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              XAU/USD trading is unavailable while the market is {status}.
            </div>
          )}

          <div className="space-y-3">
            <button disabled={xauBlocked || insufficientBalance || submitting} onClick={() => submit('BUY')} className="w-full rounded-xl bg-bull py-3 font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">BUY</button>
            <button disabled={xauBlocked || insufficientBalance || submitting} onClick={() => submit('SELL')} className="w-full rounded-xl bg-bear py-3 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">SELL</button>
          </div>
        </div>
      </div>

      {/* Spot Holdings — real, non-zero ledger balances by currency. Not a
          database Position: no price, no avgEntryPrice, no unrealized P&L.
          Distinct from "Open Positions" below, which tracks a different
          (currently unused) derivative-style concept. */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Spot Holdings</h3></div>
        <SpotHoldings assets={assets} loading={assetsLoading} executionStatus={executionStatus} />
      </div>

      {/* Open positions & order history below */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Open Positions</h3></div>
          {positionsWithPnl.length === 0 ? (
            <EmptyState icon={Inbox} title="No open positions" hint="A filled spot trade is not lost — see Spot Holdings above for your actual balances." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-slate-500">
                    <th className="px-4 py-2 text-left">Symbol</th>
                    <th className="px-4 py-2 text-right">Quantity</th>
                    <th className="px-4 py-2 text-right">Entry</th>
                    <th className="px-4 py-2 text-right">Mark</th>
                    <th className="px-4 py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {positionsWithPnl.map(({ p, pnl }) => (
                    <tr key={p.id} className="cursor-pointer border-t border-ink-700/40 hover:bg-ink-800/40" onClick={() => setActivePositionId(p.id)}>
                      <td className="px-4 py-2.5 font-medium text-white">{p.symbol}</td>
                      <td className="px-4 py-2.5 text-right font-mono">${Number(p.quantity).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">${Number(p.avgEntryPrice).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{p.currentPrice != null ? `$${Number(p.currentPrice).toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right"><PriceChange value={pnl} mode="usd" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Order History</h3></div>
          {orders.length === 0 ? (
            <EmptyState icon={History} title="Your order attempts will appear here" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase text-slate-500"><th className="px-4 py-2 text-left">Time</th><th className="px-4 py-2 text-left">Order</th><th className="px-4 py-2 text-left">Status</th></tr></thead>
                <tbody>
                  {orders.slice(0, 20).map(o => (
                    <tr key={o.id} className="border-t border-ink-700/40">
                      <td className="px-4 py-2.5 text-slate-400">{new Date(o.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-medium text-white">{o.side} {o.symbol} — ${Number(o.quantity).toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`chip ${o.status === 'REJECTED' ? 'border-bear/30 text-bear' : 'border-gold-500/30 text-gold-300'}`} title={o.rejectionReason ?? undefined}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {activeEntry && (
        <PositionCard
          position={activeEntry.p}
          pnl={activeEntry.pnl}
          marketStatus={getMarketStatus(activeEntry.p.symbol)}
          onDismiss={() => setActivePositionId(null)}
        />
      )}
    </div>
  )
}

// Real 24h stats (Phase 6C, Part 10/16) — only ever renders fields the
// provider actually supplied (Binance does for its pairs; nothing else
// does yet), never a placeholder or computed value. Renders nothing at all
// if none are available, rather than a row of dashes.
function Stats24hRow({ symbol }: { symbol: string }) {
  const stats = getStats24h(symbol)
  const hasAny = stats.highPrice != null || stats.lowPrice != null || stats.volume != null || stats.priceChangePercent != null
  if (!hasAny) return null
  const fmt = (n: number | null) => (n == null ? null : n < 1 ? n.toFixed(4) : n.toLocaleString(undefined, { maximumFractionDigits: 2 }))
  return (
    <div className="mt-3 flex flex-wrap gap-4 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3 text-sm">
      {stats.priceChangePercent != null && (
        <div><span className="text-slate-500">24h Change </span><span className={`font-mono font-semibold ${stats.priceChangePercent >= 0 ? 'text-bull' : 'text-bear'}`}>{stats.priceChangePercent >= 0 ? '+' : ''}{stats.priceChangePercent.toFixed(2)}%</span></div>
      )}
      {stats.highPrice != null && <div><span className="text-slate-500">24h High </span><span className="font-mono text-white">${fmt(stats.highPrice)}</span></div>}
      {stats.lowPrice != null && <div><span className="text-slate-500">24h Low </span><span className="font-mono text-white">${fmt(stats.lowPrice)}</span></div>}
      {stats.volume != null && <div><span className="text-slate-500">24h Volume </span><span className="font-mono text-white">{fmt(stats.volume)}</span></div>}
    </div>
  )
}

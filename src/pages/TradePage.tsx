import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAccountSummary, usePositions, useOrders, submitOrder, computePositionPnl } from '../store/useStore'
import { getPrice, getMarketStatus, SYMBOLS } from '../store/priceFeed'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import { CandlestickChart } from '../components/CandlestickChart'
import { AssetIcon } from '../components/AssetIcon'
import { StatusBadge } from '../components/StatusBadge'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { PositionCard } from '../components/PositionCard'
import { Inbox, History, ChevronRight } from 'lucide-react'

function useQuery() { return new URLSearchParams(useLocation().search) }

export default function TradePage() {
  const q = useQuery()
  const defaultSymbol = q.get('symbol') ?? 'BTC/USDT'
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [size, setSize] = useState('100')
  const [activePositionId, setActivePositionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [, setTick] = useState(0)

  const { summary } = useAccountSummary()
  const { positions, refetch: refetchPositions } = usePositions()
  const { orders, refetch: refetchOrders } = useOrders()
  const { push } = useToast()

  useEffect(() => { setSymbol(defaultSymbol) }, [defaultSymbol])

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
  const cash = summary ? Number(summary.cash) : 0

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
        subtitle="Trade with your account balance — no real funds are involved"
        right={<div className="flex items-center gap-2 text-sm text-slate-400">{symbol} <span className="font-mono text-white">${current.toFixed(current < 1 ? 4 : 2)}</span> <StatusBadge status={status} /></div>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chart */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden p-4">
            <CandlestickChart symbol={symbol} height={360} />
          </div>
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
            <span className="font-mono font-semibold text-white">${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <label className="label">Amount (USD)</label>
          <input className="input mb-3" type="number" min="0" value={size} onChange={(e) => setSize(e.target.value)} />

          <div className="mb-4 flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2.5 text-xs">
            <span className="text-slate-500">Entry price</span>
            <span className="font-mono text-white">${current.toFixed(current < 1 ? 4 : 2)}</span>
          </div>

          {xauBlocked && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              XAU/USD trading is unavailable while the market is {status}.
            </div>
          )}

          <div className="mb-4 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs text-slate-500">
            This platform is not yet connected to a broker/exchange. Orders are validated and reserved against your balance for real, then honestly rejected — they will not result in a filled position.
          </div>

          <div className="space-y-3">
            <button disabled={xauBlocked || submitting} onClick={() => submit('BUY')} className="w-full rounded-xl bg-bull py-3 font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">BUY</button>
            <button disabled={xauBlocked || submitting} onClick={() => submit('SELL')} className="w-full rounded-xl bg-bear py-3 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">SELL</button>
          </div>

          <div className="mt-4 text-xs text-slate-500">No real funds are used — this account is not connected to a real broker or exchange.</div>
        </div>
      </div>

      {/* Open positions & order history below */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Open Positions</h3></div>
          {positionsWithPnl.length === 0 ? (
            <EmptyState icon={Inbox} title="No open positions" hint="Not connected to a broker/exchange yet — orders cannot result in a filled position." />
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

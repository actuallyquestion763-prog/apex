import { Link } from 'react-router-dom'
import { useAccountSummary, usePositions } from '../store/useStore'
import PageHeader from '../components/PageHeader'
import { AssetIcon } from '../components/AssetIcon'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { PieChart } from 'lucide-react'

export default function AssetsPage() {
  const { summary, loading } = useAccountSummary()
  const { positions } = usePositions()

  const openPositions = positions.filter((p) => p.status === 'OPEN')
  const cash = summary ? Number(summary.cash) : 0
  const positionsValue = openPositions.reduce((sum, p) => sum + Number(p.currentPrice ?? p.avgEntryPrice) * Number(p.quantity), 0)
  const totalValue = cash + positionsValue

  return (
    <div className="space-y-6">
      <PageHeader title="Assets" subtitle="Portfolio overview" />

      {/* Total assets hero */}
      <div className="rounded-2xl border border-ocean-500/20 bg-gradient-to-br from-ocean-600/20 via-ink-850 to-ink-850 p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-ocean-300">Total Assets</p>
        <p className="mt-2 font-mono text-3xl font-bold text-white">{loading ? '—' : `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
        <p className="mt-1 text-xs text-slate-400">Balance ${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + open positions ${positionsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-5 py-4"><h3 className="font-bold text-white">Holdings</h3></div>
        {openPositions.length === 0 ? (
          <EmptyState icon={PieChart} title="No assets yet" hint="This platform is not yet connected to a broker/exchange, so orders cannot result in a held position." />
        ) : openPositions.map((p) => {
          const price = Number(p.currentPrice ?? p.avgEntryPrice)
          const qty = Number(p.quantity)
          const value = price * qty
          const pnl = (price - Number(p.avgEntryPrice)) * qty * (p.side === 'BUY' ? 1 : -1)
          return (
            <div key={p.id} className="flex items-center gap-3 border-b border-ink-700/40 px-5 py-3.5 last:border-b-0">
              <AssetIcon symbol={p.symbol} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{p.symbol}</p>
                <p className="text-xs text-slate-500">{qty.toFixed(4)} @ avg ${Number(p.avgEntryPrice).toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold text-white">${value.toFixed(2)}</p>
                <PriceChange value={pnl} mode="usd" className="text-xs" />
              </div>
            </div>
          )
        })}
      </div>

      <Link to="/wallet" className="card flex items-center justify-between p-4 transition hover:border-ocean-500/40">
        <div>
          <h3 className="font-bold text-white">Transactions</h3>
          <p className="mt-0.5 text-sm text-slate-400">View your full ledger history</p>
        </div>
        <span className="text-sm text-ocean-400">View wallet →</span>
      </Link>
    </div>
  )
}

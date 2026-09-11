import { Link } from 'react-router-dom'
import { useAccountSummary, useAssetBalances, useExecutionStatus, useCashBalance } from '../store/useStore'
import PageHeader from '../components/PageHeader'
import { SpotHoldings } from '../components/SpotHoldings'

export default function AssetsPage() {
  const { summary, loading } = useAccountSummary()
  const { assets, loading: assetsLoading } = useAssetBalances()
  const { status: executionStatus } = useExecutionStatus()
  // Spot Balance — the primary crypto/spot funding currency, read from its
  // own real USDT ledger balance (never derived/relabeled from USD below).
  const { balance: usdtBalance, loading: usdtLoading } = useCashBalance('USDT')

  const cash = summary ? Number(summary.cash) : 0
  const usdtCash = usdtBalance ? Number(usdtBalance.cash) : 0

  return (
    <div className="space-y-6">
      <PageHeader title="Assets" subtitle="Portfolio overview" />

      {/* Spot Balance hero — the primary crypto/spot funding currency. */}
      <div className="rounded-2xl border border-ocean-500/20 bg-gradient-to-br from-ocean-600/20 via-ink-850 to-ink-850 p-6 shadow-glow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ocean-300">Spot Balance</p>
        <p className="mt-2 font-mono text-3xl font-bold text-white">{usdtLoading ? '—' : `${usdtCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}</p>
        <p className="mt-1 text-xs text-slate-500">The funding currency for BTC/USDT, ETH/USDT, and other crypto/spot trades.</p>
      </div>

      {/* USD balance — a separate, secondary balance; the only figure with a
          real USD value. Other currencies are shown as raw ledger quantities
          below (Part 9: never fabricate a market price to compute a
          combined USD total). */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">USD Balance</p>
        <p className="mt-1.5 font-mono text-xl font-bold text-white">{loading ? '—' : `$${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-5 py-4"><h3 className="font-bold text-white">Holdings</h3></div>
        <SpotHoldings assets={assets} loading={assetsLoading} executionStatus={executionStatus} />
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

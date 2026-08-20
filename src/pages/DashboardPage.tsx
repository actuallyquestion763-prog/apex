import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useAccountSummary, usePositions, computePositionPnl, useCashBalance, useAssetBalances, useExecutionStatus } from '../store/useStore'
import MarketPrice from '../components/MarketPrice'
import MarketOverview from '../components/MarketOverview'
import { SpotHoldings } from '../components/SpotHoldings'
import { getPrice } from '../store/priceFeed'
import { useToast } from '../components/Toast'
import { AssetIcon } from '../components/AssetIcon'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { ArrowDownToLine, ArrowUpFromLine, Repeat, BarChart2, Copy, Gift, ChevronRight, Inbox } from 'lucide-react'

const TRENDING = ['BTC/USDT', 'ETH/USDT', 'XAU/USD', 'SOL/USDT']

export function DashboardPage() {
  const { user } = useAuth()
  const { summary, loading, error } = useAccountSummary()
  // Spot Balance — the primary crypto/spot funding currency, read from its
  // own real USDT ledger balance. Never derived from the USD summary below
  // (Part 2: showing USD as USDT here would be financially incorrect).
  const { balance: usdtBalance, loading: usdtLoading } = useCashBalance('USDT')
  const { assets, loading: assetsLoading } = useAssetBalances()
  const { status: executionStatus } = useExecutionStatus()
  const { positions } = usePositions()
  const { push } = useToast()

  const openPositions = positions.filter((p) => p.status === 'OPEN')
  const cash = summary ? Number(summary.cash) : 0
  const equity = summary ? Number(summary.equity) : 0
  const unrealizedPnl = summary ? Number(summary.unrealizedPnl) : 0
  const usdtCash = usdtBalance ? Number(usdtBalance.cash) : 0

  const referralCode = user?.referralCode ?? ''

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-ink-700 bg-gradient-to-r from-ocean-900/20 via-ink-850 to-ink-850 px-6 py-4">
        <h2 className="text-base font-bold text-white">Your trading account</h2>
        <p className="mt-1 text-sm text-slate-400">This account is not connected to a real broker or exchange. No real money is involved.</p>
      </div>

      {user && user.status !== 'ACTIVE' && (
        <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-3 text-sm text-gold-300">
          Your account status is {user.status.replace('_', ' ').toLowerCase()}. Some features may be restricted.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-bear/30 bg-bear/5 px-4 py-3 text-sm text-bear">{error}</div>
      )}

      {/* Spot Balance — primary crypto/spot funding currency (USDT) */}
      <div className="rounded-2xl border border-ocean-500/20 bg-gradient-to-br from-ocean-600/20 via-ink-850 to-ink-850 p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-ocean-300">Spot Balance</p>
        <p className="mt-2 font-mono text-3xl font-bold text-white">{usdtLoading ? '—' : `${usdtCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}</p>
        <p className="mt-1 text-xs text-slate-500">The funding currency for BTC/USDT, ETH/USDT, and other crypto/spot trades.</p>
      </div>

      {/* USD account summary — a separate balance from Spot Balance above;
          not used for crypto/spot trading. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="USD Balance" value={cash} loading={loading} />
        <SummaryCard label="USD Equity" value={equity} hint="Balance + unrealized P&L" loading={loading} />
        <SummaryCard label="USD Available Balance" value={cash} loading={loading} />
        <SummaryCard label="Unrealized P&L (USD)" value={unrealizedPnl} signed loading={loading} />
      </div>

      {/* Spot Holdings — ledger-derived, same component/architecture as
          TradePage/AssetsPage (Part 2: reuse, never duplicate). */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-5 py-4"><h3 className="font-bold text-white">Spot Holdings</h3></div>
        <SpotHoldings assets={assets} loading={assetsLoading} executionStatus={executionStatus} />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        <QuickAction to="/deposit" label="Deposit" icon={ArrowDownToLine} />
        <QuickAction to="/withdraw" label="Withdraw" icon={ArrowUpFromLine} />
        <QuickAction to="/trade" label="Trade" icon={Repeat} />
        <QuickAction to="/markets" label="Markets" icon={BarChart2} />
      </div>

      {/* Open positions preview */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <h3 className="font-bold text-white">Open Positions ({openPositions.length})</h3>
          <Link to="/trade" className="text-sm text-ocean-400 hover:text-ocean-300">View →</Link>
        </div>
        {openPositions.length === 0 ? (
          <EmptyState icon={Inbox} title="No open positions" hint="This platform is not yet connected to a broker/exchange, so orders cannot result in a filled position." />
        ) : openPositions.slice(0, 3).map((p) => {
          const pnl = computePositionPnl(p)
          return (
            <Link key={p.id} to={`/trade?symbol=${encodeURIComponent(p.symbol)}`} className="flex items-center gap-3 border-b border-ink-700/40 px-5 py-3 transition last:border-b-0 hover:bg-ink-800/40">
              <AssetIcon symbol={p.symbol} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{p.symbol}</p>
                <p className={`text-xs ${p.side === 'BUY' ? 'text-bull' : 'text-bear'}`}>{p.side}</p>
              </div>
              <PriceChange value={pnl} mode="usd" />
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </Link>
          )
        })}
      </div>

      {/* Featured market */}
      <MarketPrice />

      {/* Market overview */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white">Markets</h3>
            <p className="text-sm text-slate-400">Tap a market to trade.</p>
          </div>
          <Link to="/markets" className="btn-ghost text-sm">View all</Link>
        </div>
        <MarketOverview symbols={['BTC/USDT', 'ETH/USDT', 'XAU/USD', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT']} />
      </div>

      {/* Trending */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-5 py-4">
          <h3 className="font-bold text-white">Trending</h3>
        </div>
        {TRENDING.map((symbol) => {
          const price = getPrice(symbol)
          return (
            <Link key={symbol} to={`/trade?symbol=${encodeURIComponent(symbol)}`} className="flex items-center gap-3 border-b border-ink-700/40 px-5 py-3 transition last:border-b-0 hover:bg-ink-800/40">
              <AssetIcon symbol={symbol} size={28} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{symbol}</p>
              </div>
              <p className="font-mono text-sm font-semibold text-white">${price.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 4 : 2 })}</p>
            </Link>
          )
        })}
      </div>

      {/* Referral card */}
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <Gift className="h-5 w-5 text-gold-400" />
          <h3 className="font-bold text-white">Your referral link</h3>
        </div>
        <p className="mt-2 text-sm text-slate-400">Earn 10% commission on every trade made by users you refer.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-4 py-2.5 font-mono text-sm text-ocean-300">
            https://trust.io/r/{referralCode}
          </div>
          <button
            onClick={() => {
              try { navigator.clipboard?.writeText(`https://trust.io/r/${referralCode}`); push('info', 'Referral link copied.') }
              catch { push('error', 'Unable to copy referral link.') }
            }}
            className="btn-ghost"
          >
            <Copy className="h-4 w-4" /> Copy link
          </button>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, hint, signed, loading }: { label: string; value: number; hint?: string; signed?: boolean; loading?: boolean }) {
  const color = signed ? (value >= 0 ? 'text-bull' : 'text-bear') : 'text-white'
  const sign = signed ? (value >= 0 ? '+' : '-') : ''
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1.5 font-mono text-xl font-bold ${color}`}>
        {loading ? '—' : `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </p>
      {hint && <p className="mt-1 text-[11px] text-slate-600">{hint}</p>}
    </div>
  )
}

function QuickAction({ to, label, icon: Icon }: { to: string; label: string; icon: typeof ArrowDownToLine }) {
  return (
    <Link to={to} className="card flex flex-col items-center gap-2 p-4 text-center transition hover:border-ocean-500/40">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ocean-500/15 text-ocean-400">
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-xs font-medium text-slate-300">{label}</span>
    </Link>
  )
}

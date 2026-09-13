import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useAccountSummary, useCashBalance, useMarketConfigs } from '../store/useStore'
import MarketPrice from '../components/MarketPrice'
import MarketOverview from '../components/MarketOverview'
import { getPrice } from '../store/priceFeed'
import { useToast } from '../components/Toast'
import { AssetIcon } from '../components/AssetIcon'
import { Copy, Gift } from 'lucide-react'

const TRENDING = ['BTC/USDT', 'ETH/USDT', 'XAU/USD', 'SOL/USDT']

export function DashboardPage() {
  const { user } = useAuth()
  const { error } = useAccountSummary()
  // Spot Balance — the primary crypto/spot funding currency, read from its
  // own real USDT ledger balance. Never derived from the USD summary below
  // (Part 2: showing USD as USDT here would be financially incorrect).
  const { balance: usdtBalance, loading: usdtLoading } = useCashBalance('USDT')
  const { markets } = useMarketConfigs()
  const { push } = useToast()

  const usdtCash = usdtBalance ? Number(usdtBalance.cash) : 0

  const referralCode = user?.referralCode ?? ''
  // Derived from the real origin this page is served from — never a
  // hardcoded domain, which would silently point every user's copied link
  // at the wrong site on any deployment other than the one it was typed for.
  const referralLink = `${window.location.origin}/r/${referralCode}`

  return (
    <div className="space-y-6">
      {user && user.status !== 'ACTIVE' && (
        <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-3 text-sm text-gold-300">
          Your account status is {user.status.replace('_', ' ').toLowerCase()}. Some features may be restricted.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-bear/30 bg-bear/5 px-4 py-3 text-sm text-bear">{error}</div>
      )}

      {/* Spot Balance — primary crypto/spot funding currency (USDT) */}
      <div className="rounded-2xl border border-ocean-500/20 bg-gradient-to-br from-ocean-600/20 via-ink-850 to-ink-850 p-6 shadow-glow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ocean-300">Spot Balance</p>
        <p className="mt-2 font-mono text-3xl font-bold text-white">{usdtLoading ? '—' : `${usdtCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}</p>
        <p className="mt-1 text-xs text-slate-500">The funding currency for BTC/USDT, ETH/USDT, and other crypto/spot trades.</p>
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
          const quoteAsset = markets.find((m) => m.symbol === symbol)?.quoteAsset || 'USD'
          return (
            <Link key={symbol} to={`/trade?symbol=${encodeURIComponent(symbol)}`} className="flex items-center gap-3 border-b border-ink-700/40 px-5 py-3 transition last:border-b-0 hover:bg-ink-800/40">
              <AssetIcon symbol={symbol} size={28} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{symbol}</p>
              </div>
              <p className="font-mono text-sm font-semibold text-white">{price.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 4 : 2 })} {quoteAsset}</p>
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
        <p className="mt-2 text-sm text-slate-400">Share this link with others.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-4 py-2.5 font-mono text-sm text-ocean-300">
            {referralLink}
          </div>
          <button
            onClick={() => {
              try { navigator.clipboard?.writeText(referralLink); push('info', 'Referral link copied.') }
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

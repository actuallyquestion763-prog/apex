import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { snapshot, getMarketStatus } from '../store/priceFeed'
import { useMarketConfigs } from '../store/useStore'
import PageHeader from '../components/PageHeader'
import { AssetIcon } from '../components/AssetIcon'
import { StatusBadge } from '../components/StatusBadge'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { Search, RefreshCw } from 'lucide-react'

export default function MarketsPage() {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'crypto' | 'metals'>('all')
  const [, setTick] = useState(0)
  const nav = useNavigate()
  const { markets } = useMarketConfigs()

  // Keep prices/status fresh while this page is open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500)
    return () => clearInterval(id)
  }, [])

  const rows = useMemo(() => snapshot().filter(r => {
    if (tab === 'crypto' && r.symbol.includes('XAU')) return false
    if (tab === 'metals' && !r.symbol.includes('XAU')) return false
    return r.symbol.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [q, tab])

  return (
    <div className="space-y-4">
      <PageHeader title="Markets" subtitle="Browse market prices and trade." />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input placeholder="Search market..." className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button onClick={() => setTick((t) => t + 1)} aria-label="Refresh markets" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800/60 text-slate-400 transition hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {(['all', 'crypto', 'metals'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${tab === t ? 'bg-ocean-500/15 text-ocean-300' : 'text-slate-400 hover:text-white'}`}>{t}</button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Search} title="No markets found" hint="Try a different search term." />
        ) : (
          <>
            {/* Binance-style table header — labels the three columns every row below fills. */}
            <div className="flex items-center gap-3 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <div className="w-[30px] shrink-0" />
              <div className="min-w-0 flex-1">Asset</div>
              <div className="shrink-0 text-right">Last Price</div>
              <div className="w-20 shrink-0 text-right">24h Chg%</div>
            </div>
            {rows.map((r) => {
              const status = getMarketStatus(r.symbol)
              const quoteAsset = markets.find((m) => m.symbol === r.symbol)?.quoteAsset || 'USD'
              return (
                <button
                  key={r.symbol}
                  onClick={() => nav(`/trade?symbol=${encodeURIComponent(r.symbol)}`)}
                  className="flex w-full items-center gap-3 border-b border-ink-700/40 px-4 py-3 text-left transition last:border-b-0 hover:bg-ink-800/40"
                >
                  <AssetIcon symbol={r.symbol} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{r.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-slate-500">{r.symbol.replace('/', '')}</span>
                      {/* 'live' is the expected default and stays quiet — only an exceptional
                          status (simulated/stale/unavailable/loading) surfaces here, so
                          'simulated' still never looks identical to 'live' (StatusBadge's
                          invariant) without a permanent badge column crowding every row. */}
                      {status !== 'live' && <StatusBadge status={status} className="shrink-0" />}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm font-semibold text-white">
                    {r.price.toLocaleString(undefined, { minimumFractionDigits: r.price < 1 ? 4 : 2, maximumFractionDigits: r.price < 1 ? 4 : 2 })} {quoteAsset}
                  </div>
                  <div className="flex w-20 shrink-0 justify-end"><PriceChange value={r.changePct} /></div>
                </button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

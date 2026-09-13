import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { snapshot, getMarketStatus } from '../store/priceFeed'
import { useMarketConfigs } from '../store/useStore'
import PageHeader from '../components/PageHeader'
import { AssetIcon } from '../components/AssetIcon'
import { StatusBadge } from '../components/StatusBadge'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { Search, RefreshCw, TrendingUp, TrendingDown, Flame, ListOrdered } from 'lucide-react'
import type { TickerPrice } from '../types'

// Five tabs, each a genuinely different view over the same real price
// data — no fabricated "hot" score or fake volume ranking:
//   LIVE     — only markets whose current data source is actually 'live'
//              (real provider quotes), matching StatusBadge's existing
//              live/simulated/stale/unavailable honesty distinction.
//   HOT      — every configured market, ranked by |24h % change| (the
//              biggest movers, either direction).
//   24H LIST — every configured market, unfiltered, alphabetical — the
//              full roster (this was the page's entire previous behavior).
//   RISE     — gainers only (changePct > 0), biggest gain first.
//   LOSS     — losers only (changePct < 0), biggest loss first.
type MarketTab = 'live' | 'hot' | '24h' | 'rise' | 'loss'

const TABS: { id: MarketTab; label: string }[] = [
  { id: 'live', label: 'LIVE' },
  { id: 'hot', label: 'HOT' },
  { id: '24h', label: '24H LIST' },
  { id: 'rise', label: 'RISE' },
  { id: 'loss', label: 'LOSS' },
]

const EMPTY_COPY: Record<MarketTab, { title: string; hint: string }> = {
  live: { title: 'No markets are live right now', hint: 'Simulated/stale markets are hidden on this tab — try 24H List to see everything.' },
  hot: { title: 'No market activity yet', hint: 'Check back once prices start moving.' },
  '24h': { title: 'No markets found', hint: 'Try a different search term.' },
  rise: { title: 'Nothing is up right now', hint: 'No market has a positive 24h change at the moment.' },
  loss: { title: 'Nothing is down right now', hint: 'No market has a negative 24h change at the moment.' },
}

function sortForTab(rows: TickerPrice[], tab: MarketTab): TickerPrice[] {
  switch (tab) {
    case 'live':
      return rows.filter((r) => getMarketStatus(r.symbol) === 'live')
    case 'hot':
      return [...rows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    case 'rise':
      return rows.filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct)
    case 'loss':
      return rows.filter((r) => r.changePct < 0).sort((a, b) => a.changePct - b.changePct)
    case '24h':
    default:
      return [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol))
  }
}

export default function MarketsPage() {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<MarketTab>('live')
  const [, setTick] = useState(0)
  const nav = useNavigate()
  const { markets } = useMarketConfigs()

  // Keep prices/status fresh while this page is open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500)
    return () => clearInterval(id)
  }, [])

  const rows = useMemo(() => {
    const filtered = snapshot().filter((r) => r.symbol.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase()))
    return sortForTab(filtered, tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab])

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

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide transition ${
                active ? 'bg-ocean-500/15 text-ocean-300 ring-1 ring-ocean-500/40' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.id === 'live' && <span className={`h-1.5 w-1.5 rounded-full bg-ocean-400 ${active ? 'animate-pulse' : ''}`} aria-hidden="true" />}
              {t.id === 'hot' && <Flame className="h-3.5 w-3.5" />}
              {t.id === '24h' && <ListOrdered className="h-3.5 w-3.5" />}
              {t.id === 'rise' && <TrendingUp className="h-3.5 w-3.5" />}
              {t.id === 'loss' && <TrendingDown className="h-3.5 w-3.5" />}
              {t.label}
            </button>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={Search} title={EMPTY_COPY[tab].title} hint={EMPTY_COPY[tab].hint} />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const status = getMarketStatus(r.symbol)
            const quoteAsset = markets.find((m) => m.symbol === r.symbol)?.quoteAsset || 'USD'
            return (
              <button
                key={r.symbol}
                onClick={() => nav(`/trade?symbol=${encodeURIComponent(r.symbol)}`)}
                className="card flex w-full items-center justify-between gap-3 p-3.5 text-left transition hover:border-ocean-500/40"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <AssetIcon symbol={r.symbol} size={34} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">{r.symbol}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] uppercase tracking-wide text-slate-500">{r.name}</span>
                      {status !== 'live' && <StatusBadge status={status} className="shrink-0" />}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-bold text-white">
                    {r.price.toLocaleString(undefined, { minimumFractionDigits: r.price < 1 ? 4 : 2, maximumFractionDigits: r.price < 1 ? 4 : 2 })} {quoteAsset}
                  </div>
                  <div className="mt-1 flex justify-end"><PriceChange value={r.changePct} pill /></div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

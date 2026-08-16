import { getPrice, getMarketStatus, getMarketMeta } from '../store/priceFeed'
import { AssetIcon } from './AssetIcon'
import { StatusBadge } from './StatusBadge'

function formatNumber(n: number | null) {
  if (n == null) return '--'
  return n < 1 ? n.toFixed(4) : n.toFixed(2)
}

export function MarketPrice() {
  const price = getPrice('XAU/USD')
  const status = getMarketStatus('XAU/USD')
  const meta = getMarketMeta('XAU/USD')

  const age = meta.timestamp ? Math.max(0, Math.floor((Date.now() - meta.timestamp) / 1000)) : null

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <AssetIcon symbol="XAU/USD" size={28} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-300">Gold</span>
                <StatusBadge status={status} />
              </div>
              <h4 className="mt-1 font-mono text-2xl font-bold text-white">${price ? (price < 1 ? price.toFixed(4) : price.toFixed(2)) : '--'}</h4>
            </div>
          </div>
          <div className="mt-2 flex gap-4 text-sm text-slate-400">
            <div>Bid: <span className="ml-1 font-mono text-white">${formatNumber(meta.bid)}</span></div>
            <div>Ask: <span className="ml-1 font-mono text-white">${formatNumber(meta.ask)}</span></div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Source</div>
          <div className="mt-1 text-sm font-medium text-white">{meta.source ?? 'GoldAPI'}</div>
          <div className="mt-2 text-xs text-slate-500">{age == null ? '—' : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}</div>
        </div>
      </div>
      {status === 'loading' && (
        <div className="mt-3 h-2 w-1/2 animate-pulse rounded bg-ink-800" />
      )}
      {status === 'unavailable' && (
        <div className="mt-3 text-sm text-slate-400">Market data unavailable. The market server may be offline or not configured.</div>
      )}
      {status === 'stale' && (
        <div className="mt-3 text-sm text-amber-300">Price delayed — showing last known price.</div>
      )}
    </div>
  )
}

export default MarketPrice

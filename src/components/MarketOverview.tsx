import { snapshot, getMarketStatus } from '../store/priceFeed'
import { useNavigate } from 'react-router-dom'
import { AssetIcon } from './AssetIcon'
import { StatusBadge } from './StatusBadge'
import { PriceChange } from './PriceChange'

export default function MarketOverview({ symbols }: { symbols: string[] }) {
  const nav = useNavigate()
  const rows = snapshot().filter(r => symbols.includes(r.symbol))
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6">
      {rows.map(r => {
        const status = getMarketStatus(r.symbol)
        return (
          <div key={r.symbol} className="card min-w-[150px] flex-1 cursor-pointer p-3.5 transition hover:border-ocean-500/40 sm:min-w-0" onClick={() => nav(`/trade?symbol=${encodeURIComponent(r.symbol)}`)}>
            <div className="flex items-center gap-2">
              <AssetIcon symbol={r.symbol} size={24} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{r.symbol.split('/')[0]}</div>
                <div className="truncate text-[11px] text-slate-500">{r.name}</div>
              </div>
            </div>
            <div className="mt-2.5 font-mono text-base font-bold text-white">${r.price.toLocaleString(undefined, { maximumFractionDigits: r.price < 1 ? 4 : 2 })}</div>
            <div className="mt-1.5 flex items-center justify-between">
              <PriceChange value={r.changePct} />
              <StatusBadge status={status} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

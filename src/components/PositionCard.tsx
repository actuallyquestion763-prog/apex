import type { ReactNode } from 'react'
import { Info, X } from 'lucide-react'
import type { Position } from '../types'
import type { MarketStatus } from '../store/priceFeed'
import { AssetIcon } from './AssetIcon'
import { StatusBadge } from './StatusBadge'

// Represents a real, price-driven position as reported by the backend — not
// a timed/random-payout bet, and not a client-side fabrication. No close
// action: the backend has no "close position" endpoint yet (see
// backend/src/positions/positions.service.ts), so this is read-only.
export function PositionCard({
  position, pnl, marketStatus, onDismiss,
}: {
  position: Position
  pnl: number
  marketStatus: MarketStatus
  onDismiss: () => void
}) {
  const isBuy = position.side === 'BUY'
  const mark = position.currentPrice != null ? Number(position.currentPrice) : null
  const entry = Number(position.avgEntryPrice)
  const qty = Number(position.quantity)

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onDismiss}>
      <div className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-700/60 bg-ink-850 px-5 py-4">
          <div className="flex items-center gap-3">
            <AssetIcon symbol={position.symbol} size={36} />
            <div>
              <p className="font-bold text-white">{position.symbol}</p>
              <p className="text-xs text-slate-500">Trading Position</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${isBuy ? 'bg-bull/20 text-bull' : 'bg-bear/20 text-bear'}`}>
              {position.side}
            </span>
            <button onClick={onDismiss} aria-label="Dismiss" className="text-slate-500 transition hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Live status + P&L focus */}
        <div className="flex flex-col items-center gap-2 px-5 py-6">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-bull" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-bull">Position Open</span>
            <StatusBadge status={marketStatus} />
          </div>
          {mark != null ? (
            <>
              <p className={`mt-2 font-mono text-4xl font-bold ${pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-slate-500">Unrealized P&L</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Not yet marked to market</p>
          )}
        </div>

        {/* Details — every value read directly from the position object the backend returned */}
        <div className="border-t border-ink-700/60 px-5">
          <Row label="Market" value={position.symbol} />
          <Row label="Direction" value={<span className={isBuy ? 'text-bull' : 'text-bear'}>{isBuy ? 'BUY ↑' : 'SELL ↓'}</span>} />
          <Row label="Quantity" value={`${qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          <Row label="Entry Price" value={`$${entry.toFixed(entry < 1 ? 4 : 2)}`} />
          <Row label="Current Price" value={mark != null ? `$${mark.toFixed(mark < 1 ? 4 : 2)}` : '—'} />
          <Row label="Opened" value={new Date(position.openedAt).toLocaleString()} />
        </div>

        <div className="flex items-start gap-2 border-t border-ink-700/60 p-5 text-xs text-slate-500">
          <Info className="h-4 w-4 shrink-0 text-slate-500" />
          <p>Closing positions isn't available yet — this platform is not connected to a broker/exchange.</p>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-800 py-2.5 text-sm last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-medium text-white">{value}</span>
    </div>
  )
}

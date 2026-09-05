import { Info } from 'lucide-react'
import type { OptionTrade } from '../../types'

// Renders exactly what the backend recorded — never re-derives or
// second-guesses the result. Every value shown here is a real field off the
// settled trade; "Orders" is the trade's own id (shortened for display),
// never a fabricated sequence number the backend doesn't actually track.
export function OptionsResult({ trade, onDismiss }: { trade: OptionTrade; onDismiss: () => void }) {
  const result = trade.result
  const profit = trade.profitAmount != null ? Number(trade.profitAmount) : null
  const amountColor = result === 'WIN' ? 'text-bull' : result === 'LOSS' ? 'text-bear' : 'text-gold-400'
  const sign = profit != null && profit > 0 ? '+' : ''

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onDismiss}>
      <div className="card w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <Info className="mx-auto h-8 w-8 text-slate-500" />
        <h3 className="mt-4 text-lg font-bold text-white">Transaction Details</h3>

        <p className={`mt-3 text-3xl font-extrabold ${amountColor}`}>
          {sign}{trade.profitAmount ?? '0'}<span className="ml-1 text-base font-semibold">{trade.currency}</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">Transaction Completed</p>

        <div className="mt-5 divide-y divide-ink-700/60 border-t border-ink-700/60 text-left text-sm">
          <Row label="Market" value={trade.symbol.replace('/', '')} />
          <Row label="Direction" value={trade.direction} bold />
          <Row label="Investment" value={`${trade.investment} ${trade.currency}`} bold />
          <Row label="Profit / Loss" value={`${sign}${trade.profitAmount ?? '0'}`} valueClass={amountColor} bold />
          <Row label="Payout" value={`${trade.returnAmount ?? '0'} ${trade.currency}`} valueClass="text-ocean-300" bold />
          <Row label="Duration" value={`${trade.durationSeconds}s`} bold />
          <Row label="Open Time" value={formatDateTime(trade.createdAt)} bold />
          <Row label="Close Time" value={trade.settledAt ? formatDateTime(trade.settledAt) : '—'} bold />
          <Row label="Orders" value={`#${trade.id.slice(-6).toUpperCase()}`} bold />
        </div>

        <button onClick={onDismiss} className="btn-ghost mt-5 w-full py-2.5 text-sm">Close</button>
      </div>
    </div>
  )
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const date = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${date}, ${time}`
}

function Row({ label, value, valueClass, bold }: { label: string; value: string; valueClass?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-slate-500">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${valueClass ?? 'text-white'}`}>{value}</span>
    </div>
  )
}

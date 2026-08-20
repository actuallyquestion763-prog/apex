import { Trophy, TrendingDown, Minus } from 'lucide-react'
import type { OptionTrade } from '../../types'

// Renders exactly what the backend recorded — never re-derives or
// second-guesses the result, and always shows entry/expiry prices
// alongside it so the outcome is independently checkable (Part 21: "do not
// misrepresent the result").
export function OptionsResult({ trade, onDismiss }: { trade: OptionTrade; onDismiss: () => void }) {
  const result = trade.result
  const config = {
    WIN: { icon: Trophy, label: 'You Won', color: 'text-bull', bg: 'bg-bull/10 border-bull/30' },
    LOSS: { icon: TrendingDown, label: 'Trade Lost', color: 'text-bear', bg: 'bg-bear/10 border-bear/30' },
    DRAW: { icon: Minus, label: 'Trade Draw', color: 'text-gold-400', bg: 'bg-gold-500/10 border-gold-500/30' },
  }[result ?? 'DRAW']

  const Icon = config.icon

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onDismiss}>
    <div className={`card w-full max-w-sm space-y-5 border p-6 text-center ${config.bg}`} onClick={(e) => e.stopPropagation()}>
      <div>
        <Icon className={`mx-auto h-10 w-10 ${config.color}`} />
        <h3 className={`mt-3 text-xl font-bold ${config.color}`}>{config.label}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{trade.symbol} · {trade.direction}</p>
      </div>

      <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900/60 p-4 text-left text-sm">
        <Row label="Investment" value={`${trade.investment} ${trade.currency}`} />
        {result === 'WIN' && <Row label="Profit" value={`+${trade.profitAmount} ${trade.currency}`} valueClass="text-bull" />}
        {result === 'WIN' && <Row label="Total Return" value={`${trade.returnAmount} ${trade.currency}`} bold />}
        {result === 'LOSS' && <Row label="Loss" value={`${trade.investment} ${trade.currency}`} valueClass="text-bear" />}
        {result === 'DRAW' && <Row label="Investment Returned" value={`${trade.returnAmount} ${trade.currency}`} bold />}
        <div className="my-1 border-t border-ink-700/60" />
        <Row label="Entry price" value={trade.entryPrice} mono />
        <Row label="Expiry price" value={trade.expiryPrice ?? '—'} mono />
      </div>

      <button onClick={onDismiss} className="btn-ghost w-full py-2.5 text-sm">Close</button>
    </div>
    </div>
  )
}

function Row({ label, value, valueClass, bold, mono }: { label: string; value: string; valueClass?: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${bold ? 'text-base font-bold text-white' : 'font-medium'} ${valueClass ?? 'text-white'}`}>{value}</span>
    </div>
  )
}

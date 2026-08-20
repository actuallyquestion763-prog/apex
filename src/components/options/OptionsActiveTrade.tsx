import { ArrowUp, ArrowDown } from 'lucide-react'
import type { OptionTrade } from '../../types'
import { OptionsCountdown } from './OptionsCountdown'

export function OptionsActiveTrade({ trade }: { trade: OptionTrade }) {
  const isBuy = trade.direction === 'BUY'
  return (
    <div className="card space-y-5 p-6 text-center">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{trade.symbol}</p>
        <p className="mt-0.5 text-sm text-slate-400">Trading Position</p>
        <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${isBuy ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear'}`}>
          {isBuy ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          {trade.direction}
        </div>
      </div>

      <div className="flex justify-center">
        <OptionsCountdown expiryAt={trade.expiryAt} size={144} />
      </div>

      <div className="grid grid-cols-2 gap-y-3 rounded-xl border border-ink-700 bg-ink-900/60 p-4 text-left text-sm">
        <span className="text-slate-500">Market</span>
        <span className="text-right font-medium text-white">{trade.symbol}</span>
        <span className="text-slate-500">Direction</span>
        <span className={`text-right font-semibold ${isBuy ? 'text-bull' : 'text-bear'}`}>{trade.direction} {isBuy ? '↑' : '↓'}</span>
        <span className="text-slate-500">Investment</span>
        <span className="text-right font-mono text-white">{trade.investment} {trade.currency}</span>
        <span className="text-slate-500">Profit</span>
        <span className="text-right font-mono text-bull">{trade.payoutPercentSnapshot}%</span>
        <span className="text-slate-500">Duration</span>
        <span className="text-right font-mono text-white">{trade.durationSeconds}s</span>
        <span className="text-slate-500">Entry price</span>
        <span className="text-right font-mono text-white">{trade.entryPrice}</span>
      </div>

      <p className="text-xs text-slate-500">Please wait while your trade is being settled…</p>
    </div>
  )
}

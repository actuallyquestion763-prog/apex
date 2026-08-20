import { useState } from 'react'
import { History } from 'lucide-react'
import { useOptionTradeHistory } from '../../store/useOptions'
import { EmptyState } from '../EmptyState'

const RESULT_FILTERS = ['ALL', 'WIN', 'LOSS', 'DRAW'] as const
type ResultFilter = (typeof RESULT_FILTERS)[number]

export function OptionsHistory({ symbols }: { symbols: string[] }) {
  const [resultFilter, setResultFilter] = useState<ResultFilter>('ALL')
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL')
  const [scope, setScope] = useState<'all' | 'active' | 'completed'>('all')

  const { trades, loading } = useOptionTradeHistory({
    result: resultFilter === 'ALL' ? undefined : resultFilter,
    symbol: symbolFilter === 'ALL' ? undefined : symbolFilter,
    active: scope === 'active',
    completed: scope === 'completed',
  })

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-3">
        <h3 className="font-bold text-white">Options History</h3>
        <div className="flex flex-wrap gap-2">
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="input bg-ink-800 py-1.5 text-xs text-white">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as ResultFilter)} className="input bg-ink-800 py-1.5 text-xs text-white">
            {RESULT_FILTERS.map((r) => <option key={r} value={r}>{r === 'ALL' ? 'All results' : r}</option>)}
          </select>
          {symbols.length > 0 && (
            <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} className="input bg-ink-800 py-1.5 text-xs text-white">
              <option value="ALL">All assets</option>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      ) : trades.length === 0 ? (
        <EmptyState icon={History} title="No option trades yet" hint="Your trade history will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500">
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-4 py-2 text-left">Asset</th>
                <th className="px-4 py-2 text-left">Direction</th>
                <th className="px-4 py-2 text-right">Investment</th>
                <th className="px-4 py-2 text-right">Duration</th>
                <th className="px-4 py-2 text-right">Entry</th>
                <th className="px-4 py-2 text-right">Expiry</th>
                <th className="px-4 py-2 text-right">P/L</th>
                <th className="px-4 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-ink-700/40">
                  <td className="px-4 py-2.5 text-slate-400">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-medium text-white">{t.symbol}</td>
                  <td className={`px-4 py-2.5 font-semibold ${t.direction === 'BUY' ? 'text-bull' : 'text-bear'}`}>{t.direction}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{t.investment} {t.currency}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">{t.durationSeconds}s</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">{t.entryPrice}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">{t.expiryPrice ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {t.result === 'WIN' && <span className="text-bull">+{t.profitAmount} {t.currency}</span>}
                    {t.result === 'LOSS' && <span className="text-bear">{t.profitAmount} {t.currency}</span>}
                    {t.result === 'DRAW' && <span className="text-gold-400">0 {t.currency}</span>}
                    {!t.result && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`chip ${
                      t.status === 'ACTIVE' ? 'border-ocean-500/30 text-ocean-300'
                      : t.status === 'UNRESOLVED' ? 'border-gold-500/30 text-gold-300'
                      : t.result === 'WIN' ? 'border-bull/30 text-bull'
                      : t.result === 'LOSS' ? 'border-bear/30 text-bear'
                      : 'border-ink-600 text-slate-400'
                    }`}>
                      {t.status === 'SETTLED' ? t.result : t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

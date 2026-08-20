import { AssetIcon } from './AssetIcon'
import { EmptyState } from './EmptyState'
import { PieChart } from 'lucide-react'
import { holdingsEmptyMessage } from '../lib/executionStatusCopy'
import type { AssetBalance, ExecutionStatus } from '../types'

// Spot Holdings Visibility checkpoint — a plain list of the user's real,
// non-zero ledger balances by currency. Deliberately shows ONLY a quantity
// per currency: no price, no USD value, no unrealized P&L, no avgEntryPrice
// — none of that is safely derivable from a ledger balance alone, and this
// checkpoint's whole point is to never fabricate it. This is NOT a
// database Position and is never labeled as one.
export function SpotHoldings({ assets, loading, executionStatus }: { assets: AssetBalance[]; loading: boolean; executionStatus: ExecutionStatus | null }) {
  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
  if (assets.length === 0) {
    return <EmptyState icon={PieChart} title="No holdings yet" hint={holdingsEmptyMessage(executionStatus)} />
  }
  return (
    <div>
      {assets.map((a) => (
        <div key={a.currency} className="flex items-center gap-3 border-b border-ink-700/40 px-5 py-3.5 last:border-b-0">
          <AssetIcon symbol={`${a.currency}/USDT`} size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{a.currency}</p>
            {Number(a.reserved) !== 0 && (
              <p className="text-xs text-slate-500">{a.reserved} reserved</p>
            )}
          </div>
          <p className="font-mono text-sm font-semibold text-white">{a.total} {a.currency}</p>
        </div>
      ))}
    </div>
  )
}

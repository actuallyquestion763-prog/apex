import { useAccountSummary, useLedgerHistory } from '../store/useStore'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Wallet as WalletIcon, TrendingUp } from 'lucide-react'

export function WalletPage() {
  const { summary, loading: summaryLoading } = useAccountSummary()
  const { entries, loading, error } = useLedgerHistory(200)

  const totalDeposited = entries.filter((e) => e.entryType === 'DEPOSIT' && e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amount), 0)
  const totalWithdrawn = entries.filter((e) => e.entryType === 'WITHDRAWAL' && e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amount), 0)
  const totalPnL = entries.reduce((s, e) => {
    if (e.entryType === 'REALIZED_PROFIT' && e.direction === 'CREDIT') return s + Number(e.amount)
    if (e.entryType === 'REALIZED_LOSS' && e.direction === 'DEBIT') return s - Number(e.amount)
    return s
  }, 0)

  const cash = summary ? Number(summary.cash) : 0

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-slate-400">Total balance</p>
            <p className="mt-1 font-mono text-4xl font-bold text-white">{summaryLoading ? '—' : `$${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
          </div>
          <div className="flex gap-3">
            <Link to="/deposit" className="btn-gold"><ArrowDownToLine className="h-4 w-4" /> Deposit</Link>
            <Link to="/withdraw" className="btn-ghost"><ArrowUpFromLine className="h-4 w-4" /> Withdraw</Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <div className="flex items-center gap-2"><ArrowDownToLine className="h-4 w-4 text-bull" /><p className="text-sm text-slate-400">Total deposited</p></div>
          <p className="mt-2 font-mono text-xl font-bold text-white">${totalDeposited.toFixed(2)}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-bear" /><p className="text-sm text-slate-400">Total withdrawn</p></div>
          <p className="mt-2 font-mono text-xl font-bold text-white">${totalWithdrawn.toFixed(2)}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-gold-400" /><p className="text-sm text-slate-400">Realized P&L</p></div>
          <p className={`mt-2 font-mono text-xl font-bold ${totalPnL >= 0 ? 'text-bull' : 'text-bear'}`}>{totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700 px-5 py-4 flex items-center gap-2">
          <WalletIcon className="h-5 w-5 text-ocean-400" />
          <h3 className="font-bold text-white">Transaction history</h3>
        </div>
        {error && <p className="px-5 py-4 text-sm text-bear">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
                <th className="px-5 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {!loading && entries.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">No transactions yet.</td></tr>
              ) : (
                entries.map((e) => {
                  const signed = e.direction === 'CREDIT' ? Number(e.amount) : -Number(e.amount)
                  return (
                    <tr key={e.id} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                      <td className="px-5 py-3 text-slate-400">{new Date(e.createdAt).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <span className="chip border-ocean-500/30 text-ocean-300">{e.entryType.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-400">{e.ledgerAccount}</td>
                      <td className={`px-5 py-3 text-right font-mono font-semibold ${signed >= 0 ? 'text-bull' : 'text-bear'}`}>{signed >= 0 ? '+' : ''}${signed.toFixed(2)}</td>
                      <td className="px-5 py-3 text-slate-500 max-w-xs truncate">{e.description || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

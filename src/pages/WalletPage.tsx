import { useAccountSummary, useLedgerHistory } from '../store/useStore'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Wallet as WalletIcon, TrendingUp } from 'lucide-react'
import type { LedgerEntry } from '../types'

// Stablecoins/fiat display like money (2 decimals); every other currency is
// a crypto asset and gets full precision (8 decimals) rather than silently
// truncating a real BTC/ETH quantity. No conversion, no rate — just how
// many decimals to show.
const TWO_DECIMAL_CURRENCIES = new Set(['USD', 'USDT', 'USDC'])

function formatLedgerAmount(signed: number, currency: string, showSign = true): string {
  const sign = showSign && signed >= 0 ? '+' : ''
  const decimals = TWO_DECIMAL_CURRENCIES.has(currency) ? 2 : 8
  const formatted = signed.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return currency === 'USD' ? `${sign}$${formatted} USD` : `${sign}${formatted} ${currency}`
}

// Sums entries matching `predicate` PER CURRENCY — never across currencies
// (Wallet Currency Display checkpoint: summing USD + USDT + BTC as if they
// were the same unit would be financially meaningless; this is the same
// entryType/direction filtering as before, just grouped by the entry's own
// real currency instead of blindly combined).
function sumByCurrency(entries: LedgerEntry[], predicate: (e: LedgerEntry) => number | null): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of entries) {
    const delta = predicate(e)
    if (delta === null) continue
    totals.set(e.currency, (totals.get(e.currency) ?? 0) + delta)
  }
  return totals
}

function CurrencyTotals({ totals, showSign = false }: { totals: Map<string, number>; showSign?: boolean }) {
  if (totals.size === 0) return <p className="mt-2 font-mono text-xl font-bold text-white">{formatLedgerAmount(0, 'USD', showSign)}</p>
  return (
    <div className="mt-2 space-y-1">
      {[...totals.entries()].map(([currency, value]) => (
        <p key={currency} className={`font-mono text-xl font-bold ${showSign ? (value >= 0 ? 'text-bull' : 'text-bear') : 'text-white'}`}>
          {formatLedgerAmount(value, currency, showSign)}
        </p>
      ))}
    </div>
  )
}

export function WalletPage() {
  const { summary, loading: summaryLoading } = useAccountSummary()
  const { entries, loading, error } = useLedgerHistory(200)

  const totalDeposited = sumByCurrency(entries, (e) => (e.entryType === 'DEPOSIT' && e.direction === 'CREDIT' ? Number(e.amount) : null))
  const totalWithdrawn = sumByCurrency(entries, (e) => (e.entryType === 'WITHDRAWAL' && e.direction === 'DEBIT' ? Number(e.amount) : null))
  const totalPnL = sumByCurrency(entries, (e) => {
    if (e.entryType === 'REALIZED_PROFIT' && e.direction === 'CREDIT') return Number(e.amount)
    if (e.entryType === 'REALIZED_LOSS' && e.direction === 'DEBIT') return -Number(e.amount)
    return null
  })

  const cash = summary ? Number(summary.cash) : 0

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ocean-500/20 bg-gradient-to-br from-ocean-600/20 via-ink-850 to-ink-850 p-6 shadow-glow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-ocean-300">USD Balance</p>
            <p className="mt-1 font-mono text-4xl font-bold text-white">{summaryLoading ? '—' : `$${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`}</p>
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
          <CurrencyTotals totals={totalDeposited} />
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-bear" /><p className="text-sm text-slate-400">Total withdrawn</p></div>
          <CurrencyTotals totals={totalWithdrawn} />
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-gold-400" /><p className="text-sm text-slate-400">Realized P&L</p></div>
          <CurrencyTotals totals={totalPnL} showSign />
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
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">Loading transactions…</td></tr>
              ) : entries.length === 0 ? (
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
                      <td className={`px-5 py-3 text-right font-mono font-semibold ${signed >= 0 ? 'text-bull' : 'text-bear'}`}>{formatLedgerAmount(signed, e.currency)}</td>
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

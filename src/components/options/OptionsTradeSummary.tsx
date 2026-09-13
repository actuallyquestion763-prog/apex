// Trade Summary — shown once a valid amount and its resolved duration/ROI
// are both known. Potential Profit and Total Return are computed here for
// DISPLAY only, using the exact same formula the backend uses
// (computeProfit/computeReturn in options/option-math.ts): profit =
// investment * payoutPercent / 100, return = investment + profit. Never
// authoritative — the backend independently recomputes both from the
// snapshotted payoutPercent at settlement time, never trusting this or any
// other client-side figure.
export function OptionsTradeSummary({
  investment, currency, payoutPercent,
}: {
  investment: number
  currency: string
  payoutPercent: string | null
}) {
  const payout = payoutPercent != null ? parseFloat(payoutPercent) : null
  const profit = payout != null && Number.isFinite(investment) ? (investment * payout) / 100 : null
  const totalReturn = profit != null ? investment + profit : null

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Trade Summary</p>
      <div className="mt-2 space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Investment</span>
          <span className="font-mono font-bold text-white">{Number.isFinite(investment) ? `${fmt(investment)} ${currency}` : '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Potential Profit</span>
          <span className="font-mono font-bold text-bull">{profit != null ? `+${fmt(profit)} ${currency}` : '—'}</span>
        </div>
        <div className="flex items-center justify-between border-t border-ink-700/60 pt-1.5">
          <span className="text-slate-400">Total Return</span>
          <span className="font-mono text-base font-extrabold text-ocean-300">{totalReturn != null ? `${fmt(totalReturn)} ${currency}` : '—'}</span>
        </div>
      </div>
    </div>
  )
}

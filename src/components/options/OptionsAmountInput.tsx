// Live investment/profit/return preview — display math only, matching the
// EXACT formula the backend uses (profit = investment * payoutPercent /
// 100), so the number shown here always agrees with what the backend will
// actually compute. This is never authoritative: the backend independently
// re-derives and enforces everything at trade-creation time.
export function OptionsAmountInput({
  value, onChange, currency, payoutPercent, min, max, availableBalance,
}: {
  value: string
  onChange: (v: string) => void
  currency: string
  payoutPercent: string | null
  min: string
  max: string | null
  availableBalance: number | null
}) {
  const investment = parseFloat(value)
  const valid = Number.isFinite(investment) && investment > 0
  const payout = payoutPercent ? parseFloat(payoutPercent) : null
  const profit = valid && payout != null ? (investment * payout) / 100 : null
  const potentialReturn = valid && profit != null ? investment + profit : null

  const belowMin = valid && investment < parseFloat(min)
  const aboveMax = valid && max != null && investment > parseFloat(max)
  const insufficientBalance = availableBalance != null && valid && investment > availableBalance

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="option-amount-input" className="label">Investment ({currency})</label>
        <input
          id="option-amount-input"
          className="input font-mono text-lg"
          type="number"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="option-amount-hint"
          aria-invalid={belowMin || aboveMax || insufficientBalance}
        />
        <p id="option-amount-hint" className="mt-1 text-[11px] text-slate-500">Min {min} {currency}{max ? ` · Max ${max} ${currency}` : ''}</p>
      </div>

      <div role="status">
        {belowMin && <p className="rounded-lg bg-bear/10 px-3 py-2 text-xs text-bear">Minimum investment is {min} {currency}.</p>}
        {aboveMax && <p className="rounded-lg bg-bear/10 px-3 py-2 text-xs text-bear">Maximum investment is {max} {currency}.</p>}
        {insufficientBalance && (
          <div className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
            <p className="font-semibold">Insufficient balance</p>
            <p className="mt-0.5">Available: {availableBalance?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency} · Required: {investment.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-ink-700 bg-ink-900/60 p-3 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Payout</p>
          <p className="font-mono font-semibold text-bull">{payout != null ? `${payout}%` : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Potential Profit</p>
          <p className="font-mono font-semibold text-bull">{profit != null ? `${profit.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}` : '—'}</p>
        </div>
        <div className="col-span-2 border-t border-ink-700/60 pt-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Potential Return</p>
          <p className="font-mono text-lg font-bold text-white">{potentialReturn != null ? `${potentialReturn.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}` : '—'}</p>
        </div>
      </div>
    </div>
  )
}

export function isOptionAmountValid(value: string, min: string, max: string | null, availableBalance: number | null): boolean {
  const investment = parseFloat(value)
  if (!Number.isFinite(investment) || investment <= 0) return false
  if (investment < parseFloat(min)) return false
  if (max != null && investment > parseFloat(max)) return false
  if (availableBalance != null && investment > availableBalance) return false
  return true
}

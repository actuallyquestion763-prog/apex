// Amount entry + a live Duration/Profit preview — display only, matching
// the EXACT values the backend will use (payoutPercent is read verbatim
// from the selected OptionDuration; the profit % is never computed from the
// investment amount, and the duration is never free-typed — both are
// derived entirely from which duration button is selected, the ONLY thing
// this input's own value can ever change is how much is invested). This is
// never authoritative: the backend independently re-derives and enforces
// everything at trade-creation time.
export function OptionsAmountInput({
  value, onChange, currency, payoutPercent, durationSeconds, min, max, availableBalance,
}: {
  value: string
  onChange: (v: string) => void
  currency: string
  payoutPercent: string | null
  durationSeconds: number | null
  min: string
  max: string | null
  availableBalance: number | null
}) {
  const investment = parseFloat(value)
  const valid = Number.isFinite(investment) && investment > 0
  const payout = payoutPercent ? parseFloat(payoutPercent) : null

  const belowMin = valid && investment < parseFloat(min)
  const aboveMax = valid && max != null && investment > parseFloat(max)
  const insufficientBalance = availableBalance != null && valid && investment > availableBalance

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="option-amount-input" className="sr-only">Investment ({currency})</label>
        <input
          id="option-amount-input"
          className="input font-mono text-base"
          type="number"
          min="0"
          inputMode="decimal"
          placeholder={`Amount ${currency}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="option-amount-hint"
          aria-invalid={belowMin || aboveMax || insufficientBalance}
        />
      </div>

      <div role="status" id="option-amount-hint">
        {belowMin && <p className="rounded-lg bg-bear/10 px-3 py-2 text-xs text-bear">Minimum investment is {min} {currency}.</p>}
        {aboveMax && <p className="rounded-lg bg-bear/10 px-3 py-2 text-xs text-bear">Maximum investment is {max} {currency}.</p>}
        {insufficientBalance && (
          <div className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
            <p className="font-semibold">Insufficient balance</p>
            <p className="mt-0.5">Available: {availableBalance?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency} · Required: {investment.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Duration</p>
          <p className="mt-1 font-mono text-lg font-bold text-ocean-300">{durationSeconds != null ? `${durationSeconds}s` : '—'}</p>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Profit</p>
          <p className="mt-1 font-mono text-lg font-bold text-ocean-300">{payout != null ? `${payout}%` : '—'}</p>
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

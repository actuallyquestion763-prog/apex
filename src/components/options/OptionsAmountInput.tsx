// Amount entry for the amount-tier trading ticket (seven-tier system) —
// display only: this component never decides duration/payout itself (see
// OptionsDurationSelector for the read-only tier ladder, and
// OptionsTradeSummary for the Investment/Profit/Return breakdown). The
// backend independently re-derives and enforces everything at
// trade-creation time; nothing here is authoritative.
const QUICK_AMOUNTS = [500, 1_000, 5_000, 10_000, 50_000, 100_000]

function formatQuickLabel(amount: number): string {
  if (amount >= 1000) return `$${amount / 1000}K`
  return `$${amount}`
}

export function OptionsAmountInput({
  value, onChange, currency, min, max, availableBalance,
}: {
  value: string
  onChange: (v: string) => void
  currency: string
  min: string
  max: string | null
  availableBalance: number | null
}) {
  const investment = parseFloat(value)
  const valid = Number.isFinite(investment) && investment > 0

  const belowMin = valid && investment < parseFloat(min)
  const aboveMax = valid && max != null && investment > parseFloat(max)
  const insufficientBalance = availableBalance != null && valid && investment > availableBalance

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="option-amount-input" className="sr-only">Investment ({currency})</label>
        <input
          id="option-amount-input"
          className="input font-mono text-lg font-bold"
          type="number"
          min="0"
          inputMode="decimal"
          placeholder={
            min && max
              ? `Enter amount ($${Number(min).toLocaleString()} – $${Number(max).toLocaleString()})`
              : min
                ? `Enter amount ($${Number(min).toLocaleString()} and above)`
                : `Amount ${currency}`
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="option-amount-hint"
          aria-invalid={belowMin || aboveMax || insufficientBalance}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onChange(String(amount))}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              value === String(amount)
                ? 'bg-gold-500 text-ink-950'
                : 'border border-ink-600 bg-ink-800 text-slate-300 hover:border-gold-500/50 hover:text-white'
            }`}
          >
            {formatQuickLabel(amount)}
          </button>
        ))}
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

import type { OptionDurationConfig } from '../../types'
import { tierUpperBound } from './optionAmountTier'

// Full amount-tier ladder — read-only cards, never clickable. Duration and
// payout are NEVER manually picked by the user; they're resolved entirely
// from the amount entered (see optionAmountTier.ts's resolveDurationForAmount,
// re-enforced independently by the backend at trade-creation time). This
// shows every configured tier (Duration / ROI / Allowed amount range) so
// the user can see the whole rule at a glance, with whichever tier the
// CURRENT amount qualifies for highlighted — never the other way around.
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} Second${seconds === 1 ? '' : 's'}`
  const minutes = seconds / 60
  return `${minutes} Minute${minutes === 1 ? '' : 's'}`
}

// Always in "K" notation, even below $1,000 — matches the spec's own
// example exactly ("$0.5K–$1.0K" for the $500–$1,000 tier), not a
// threshold this component invented.
function formatCompactUsd(amount: number): string {
  return `$${(amount / 1000).toFixed(1)}K`
}

export function OptionsDurationSelector({
  durations, activeDurationSeconds, marketMaxInvestment,
}: {
  durations: OptionDurationConfig[]
  activeDurationSeconds: number | null
  marketMaxInvestment: string | null
}) {
  if (durations.length === 0) {
    return <p className="text-xs text-slate-500">No durations are currently configured for this asset.</p>
  }
  // Display order follows minAmount ascending — the natural tier ladder —
  // regardless of whatever order the API returned them in.
  const sorted = [...durations].sort((a, b) => parseFloat(a.minAmount) - parseFloat(b.minAmount))

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {sorted.map((d) => {
        const upper = tierUpperBound(sorted, d, marketMaxInvestment)
        const rangeLabel = upper != null
          ? `${formatCompactUsd(parseFloat(d.minAmount))}–${formatCompactUsd(upper)}`
          : `${formatCompactUsd(parseFloat(d.minAmount))}+`
        const active = activeDurationSeconds === d.durationSeconds
        return (
          <div
            key={d.durationSeconds}
            aria-current={active}
            title={`${d.minAmount}+ -> ${d.durationSeconds}s -> ${d.payoutPercent}%`}
            className={`rounded-xl px-3 py-2.5 text-left transition ${
              active
                ? 'bg-bull text-white shadow-glow-sm'
                : 'border border-ink-600 bg-ink-800 text-slate-400'
            }`}
          >
            <p className="text-sm font-extrabold">{formatDuration(d.durationSeconds)}</p>
            <p className={`text-xs font-bold ${active ? 'text-white/90' : 'text-ocean-300'}`}>ROI: {d.payoutPercent}%</p>
            <p className={`mt-0.5 text-[11px] ${active ? 'text-white/70' : 'text-slate-500'}`}>{rangeLabel}</p>
          </div>
        )
      })}
    </div>
  )
}

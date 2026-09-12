import type { OptionDurationConfig } from '../../types'

// Read-only tier ladder — duration and payout are NEVER manually
// clicked/typed by the user; they're resolved automatically from the
// amount entered (see optionAmountTier.ts). This just shows which tiers
// exist and highlights whichever one the current amount currently
// qualifies for, so the user can see the rule ($X -> duration -> payout%)
// rather than guess at it. Durations come entirely from backend
// configuration (never hardcoded) — see OptionMarketConfig.durations,
// sourced from GET /options/markets.
export function OptionsDurationSelector({
  durations, activeDurationSeconds,
}: {
  durations: OptionDurationConfig[]
  activeDurationSeconds: number | null
}) {
  if (durations.length === 0) {
    return <p className="text-xs text-slate-500">No durations are currently configured for this asset.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {durations.map((d) => (
        <div
          key={d.durationSeconds}
          aria-current={activeDurationSeconds === d.durationSeconds}
          title={`$${d.minAmount}+ -> ${d.durationSeconds}s -> ${d.payoutPercent}%`}
          className={`rounded-xl px-4 py-3 text-base font-extrabold transition ${
            activeDurationSeconds === d.durationSeconds
              ? 'bg-bull text-white shadow-glow-sm'
              : 'border border-ink-600 bg-ink-800 text-slate-400'
          }`}
        >
          {d.durationSeconds}s
        </div>
      ))}
    </div>
  )
}

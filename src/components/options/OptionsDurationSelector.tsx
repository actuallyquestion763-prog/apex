import type { OptionDurationConfig } from '../../types'

// Durations come entirely from backend configuration (never hardcoded) —
// see OptionMarketConfig.durations, sourced from GET /options/markets.
export function OptionsDurationSelector({
  durations, selected, onSelect,
}: {
  durations: OptionDurationConfig[]
  selected: number | null
  onSelect: (durationSeconds: number) => void
}) {
  if (durations.length === 0) {
    return <p className="text-xs text-slate-500">No durations are currently configured for this asset.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {durations.map((d) => (
        <button
          key={d.durationSeconds}
          onClick={() => onSelect(d.durationSeconds)}
          aria-pressed={selected === d.durationSeconds}
          aria-label={`${d.durationSeconds} second duration, payout ${d.payoutPercent}%`}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
            selected === d.durationSeconds
              ? 'border-ocean-400 bg-ocean-500/15 text-ocean-300'
              : 'border-ink-600 bg-ink-800 text-slate-300 hover:border-ink-500 hover:text-white'
          }`}
        >
          {d.durationSeconds}s
        </button>
      ))}
    </div>
  )
}
